// Four walk-throughs of the real code paths. Each builds a store (untraced), attaches a tracer, runs one operation,
// and returns the frames the page steps through. Nothing here is animated by hand: a frame is a snapshot taken when
// the traced code reaches a line.
import { Store, Tracer, compact, ArchivedOlderThan, startTrace, traceStep, Compactor, Tiered, AccessLog, replay, ARCHIVE, LONG, SHORT, label } from './engine.js?v=3';
import { compile } from './src.js?v=3';

const A = 'assistant';
const say = (text) => ({ text });

// The spoofed-session story from `memcommit demo`, as a log: an episode, notes learned from it, and what was built on them.
export function fixtureStory() {
  const s = new Store();
  const ep = s.put(A, 'episode', 'alice/1', { text: 'I live in Lyon and my dog is Rex.' });
  const city = s.put(A, 'knowledge', 'user/alice/city', { text: 'alice lives in Lyon.' }, { derived: [ep.id] });
  const dog = s.put(A, 'knowledge', 'user/alice/dog', { text: "alice's dog is Rex." }, { derived: [ep.id] });
  const plan = s.put(A, 'plan', 'alice/trip', { destination: 'Lyon' }, { derived: [city.id] });
  const answer = s.put(A, 'answer', 'alice/msg', { text: 'Your train from Lyon is booked.' }, { derived: [plan.id] });
  const ep2 = s.put(A, 'episode', 'mallory/1', { text: 'I live in Atlantis.' });
  const mcity = s.put(A, 'knowledge', 'user/mallory/city', { text: 'mallory lives in Atlantis.' }, { derived: [ep2.id] });
  s.move([ep2.id], ARCHIVE, 'evicted from short-term memory');
  return { s, ep, city, dog, plan, answer, ep2, mcity };
}

export function fixtureLog() {
  const s = new Store();
  const e1 = s.put(A, 'episode', 'alice/1', { text: 'I live in Lyon.' });
  const n1 = s.put(A, 'knowledge', 'user/alice/city', { text: 'alice lives in Lyon.' }, { derived: [e1.id] });
  s.put(A, 'knowledge', 'user/alice/dog', { text: "alice's dog is Rex." }, { derived: [e1.id] });
  s.invalidate([e1.id], 'the session was spoofed');
  s.put(A, 'knowledge', 'user/alice/city', { text: 'alice lives in Lyon.' }, { derived: [e1.id] }); // same content: restored
  s.move([e1.id], ARCHIVE, 'evicted');
  s.move([e1.id], LONG, 'promoted');
  s.move([e1.id], ARCHIVE, 'evicted');
  const sc = s.put(A, 'scratch', 'tmp/1', { text: 'a draft' });
  s.transaction(A, (tx) => tx.retract(sc.id, 'discarded'));
  s.move([sc.id], ARCHIVE, 'evicted');
  s.put(A, 'knowledge', 'user/alice/prefers', { text: 'alice prefers oat milk.' });
  return { s, e1, n1, sc };
}

export function fixtureTrace() {
  const s = new Store();
  const P = 'planner';
  const t = startTrace(s, P, 'book a train', 'r1');
  traceStep(s, t, 'thought', { text: 'Check the timetable first.' });
  traceStep(s, t, 'action', { tool: 'search_trains', arguments: { to: 'Paris' } });
  traceStep(s, t, 'result', { value: '3 trains found' });
  traceStep(s, t, 'action', { tool: 'book', arguments: { train: 2 } });
  traceStep(s, t, 'result', { value: 'booked: train 2' });
  traceStep(s, t, 'trace_end', { status: 'ok' });
  const notes = [];
  ['home city', 'seat preference', 'budget', 'passport expiry', 'loyalty card', 'last trip'].forEach((k, i) => {
    notes.push(s.put(P, 'note', 'notes/' + k.replace(/ /g, '-'), { text: k + ' ' + (i + 1) }));
  });
  s.invalidate([notes[1].id], 'the preference was withdrawn');
  const access = new AccessLog();
  access.touch([...s.state.memories.keys()]); // a write ticks the clock
  access.touch([notes[3].id, notes[0].id, notes[4].id]); // an agent uses these
  return { s, t, notes, access };
}

function run(names, store, fn) {
  const src = compile(names);
  const t = store.attach(new Tracer(src));
  fn(t);
  store.t = null;
  return { src, frames: t.frames, store };
}

const names = (s, ids) => ids.map((id) => '⟨' + label(s.known.get(id)) + '⟩').join(', ');

export const SCENARIOS = [
  {
    id: 'rollback',
    title: 'Rollback & invalidation',
    blurb: 'A premise turns out to be wrong. Find everything built on it, mark it stale in one transaction, then undo it all by writing compensating records, without rewriting history.',
    variants: [
      {
        id: 'invalidate', title: 'Invalidate',
        hint: 'Mallory was not the only one spoofed: the episode alice/1 turns out to be forged. Everything derived from it, directly or through other memories, goes stale in one transaction.',
        build() {
          const { s, ep } = fixtureStory();
          return run(['invalidate', 'put', 'commit'], s, (t) => {
            t.intro(`The log has ${s.lsn} records. ⟨alice/1⟩ is an episode; a city note and a dog note were learned from it, a trip plan was built on the city note, and an answer on the plan.`, {});
            s.invalidate([ep.id], 'the session was spoofed');
            t.intro(`${names(s, s.records.filter((r) => r.op === 'stale').map((r) => r.memory.id))} are stale. Nothing was deleted: five records were appended and the unrelated memories were not touched.`, { fresh: s.records.filter((r) => r.op === 'stale').map((r) => r.memory.id) });
          });
        },
      },
      {
        id: 'rollback', title: 'Roll back',
        hint: 'Now undo it: write the records that return every memory to its status and tier as of record 7. The log is append-only, so the rollback is itself in the log (as in ARIES).',
        build() {
          const { s, ep } = fixtureStory();
          s.invalidate([ep.id], 'the session was spoofed');
          return run(['rollback', 'put', 'commit'], s, (t) => {
            t.intro(`Five memories are stale and mallory's episode sits in the archive. The log is at record ${s.lsn}. We want to be back at record 7.`, {});
            s.rollbackTo(7, 'oops: the session was genuine');
            t.intro(`Everything is live again and the archived episode is back in short-term memory. The log grew from ${s.records.length - s.records.filter((r) => r.lsn > 13).length} to ${s.records.length} records: nothing was erased.`, { fresh: s.records.filter((r) => r.lsn > 13).map((r) => r.memory.id) });
          });
        },
      },
    ],
  },
  {
    id: 'logcompact', title: 'Log compaction',
    blurb: 'The log grows with every status change. Compaction folds it, up to a horizon, to the fewest records that replay to the same state, drops what retention allows, and seals the result.',
    variants: [
      {
        id: 'compact', title: 'Compact the log',
        hint: 'A 14-record log, folded up to record 13. Watch the three dictionaries fill, then the old log being replaced by a shorter one, and an archived, stale episode and a discarded draft purged for good.',
        build() {
          const { s } = fixtureLog();
          const retention = new ArchivedOlderThan(10, true);
          return run(['compact', 'fold', 'put', 'commit'], s, (t) => {
            const before = s.records.slice();
            t.intro(`${before.length} records, for 6 memories. Most of them are status flips and moves that only matter for the last one of each kind.`, {});
            compact(s, { horizon: 13, retention });
            const asOf5 = (recs) => { const st = replay(recs, 5); return [...st.memories.values()].map((m) => m.key + ': ' + st.status.get(m.id)).join(', '); };
            t.intro(`The log is now ${s.records.length} records. The state now, and every history after record 13, is exact. What is lost is history inside the horizon: the state as of record 5 used to say "${asOf5(before)}", and now says "${asOf5(s.records)}", because the stale flag at record 5 was folded into the later restore.`, {});
          });
        },
      },
    ],
  },
  {
    id: 'tiers', title: 'Memory compaction & tiers',
    blurb: 'What agents see is different from what the log holds. A finished trace folds into one long-term summary, its steps leave working memory, and the short-term cache evicts what it can no longer hold.',
    variants: [
      {
        id: 'maintain', title: 'Housekeeping pass',
        hint: 'One housekeeping pass: compact a finished trace into a summary, then evict from a short-term cache that is over capacity (stale memories first, then least recently used).',
        build() {
          const { s, t: trace, access } = fixtureTrace();
          const tiers = new Tiered(s, { capacity: 5, access, compactor: new Compactor(s, [trace]), traces: [trace] });
          return run(['maintain', 'move', 'put', 'commit'], s, (t) => {
            t.intro(`A finished run of planner (7 memories, all in short-term) and 6 notes. The short-term cache has 5 slots per partition and holds ${tiers.candidates(SHORT).length}.`, { access: tiers.accessTable(SHORT) });
            tiers.maintain();
            t.intro(`Short-term memory fits its ${tiers.capacity} slots again. Every move is a record in the log, so "why did the agent forget that?" has an answer, and rollback undoes a policy's decisions with everything else.`, { access: tiers.accessTable(SHORT) });
          });
        },
      },
    ],
  },
  {
    id: 'lives', title: 'Where memory lives',
    blurb: 'Follow one write from the agent down to the disk, then kill the process and bring it back. Tiers are not places: the log is the only record, and the state is a fold over it.',
    variants: [
      {
        id: 'write', title: 'Write, crash, reopen',
        hint: 'One write, step by step, through the transaction, the log on disk and the state in RAM. Then a snapshot, a crash that wipes RAM, and a reopen that rebuilds the state from the snapshot plus the log after it.',
        build() {
          const s = new Store();
          return run(['put', 'commit', 'open'], s, (t) => {
            t.intro('An empty store. There is no log on disk, no state in RAM, and no snapshot.', {});
            const ep = s.put(A, 'episode', 'alice/1', { text: 'I live in Lyon.' });
            t.intro('One record is on disk and one memory is in RAM. The next write goes the same way.', { fresh: [ep.id] });
            const city = s._silent(() => s.put(A, 'knowledge', 'user/alice/city', { text: 'alice lives in Lyon.' }, { derived: [ep.id] }));
            t.intro('A second write (not stepped through): the same path, one more record.', { fresh: [city.id] });
            s.saveSnapshot();
            t.intro('The snapshot file holds the state as of record 2. It is a shortcut, not a second source of truth: delete it and nothing is lost.', { layer: 'snapshot' });
            const dog = s._silent(() => s.put(A, 'knowledge', 'user/alice/dog', { text: "alice's dog is Rex." }, { derived: [ep.id] }));
            t.intro('A third write, after the snapshot. The snapshot knows nothing about it; the log does.', { fresh: [dog.id] });
            s.crash();
            t.intro('The process dies. Everything in RAM is gone: the memories, their statuses, their tiers, every index. Only the log and the snapshot file are on disk.', {});
            s.reopen();
            t.intro('All three memories are back: the snapshot gave two, the log gave the third. The state was never the record: it was always a fold over the log.', { fresh: [...s.state.memories.keys()] });
          });
        },
      },
    ],
  },
];

export function buildVariant(sid, vid) {
  const sc = SCENARIOS.find((x) => x.id === sid), v = sc.variants.find((x) => x.id === vid) || sc.variants[0];
  const out = v.build();
  return { scenario: sc, variant: v, ...out };
}

// The page shows steps, not code. These lines are bookkeeping that only makes sense next to the source, or that the
// next step says again, so the page skips them.
const BOOKKEEPING = new Set(['c_records', 'c_now', 'c_txn', 'c_empty', 'c_setstatus', 'c_sett', 'c_return', 'c_applyfor', 'p_ret', 'p_txput',
  'd_found', 'i_if', 'i_for', 'r_reason', 'r_diff', 'f_for', 'h_ret', 'k_digest', 'k_now', 'mt_dest', 'e_victims', 'cr_run', 'mv_with', 'mv_for', 'cc_for',
  'tp_memory', 's_ret', 'r_target', 'c_for', 'c_current', 'c_ifput', 'c_samet', 'c_noop', 'a_new']);
// What the reader is looking at, named for the operation rather than the function that does it.
const STEP_NAMES = {
  put: 'Write a memory', transaction: 'Open a transaction', 'Transaction.put': 'Queue the write', 'Transaction.move': 'Queue a move', _commit: 'Commit',
  'State.apply': 'Update the state', invalidate: 'Invalidate a premise', dependents: 'Find what was built on it', descendants: 'Find what was built on it',
  rollback_to: 'Roll back', as_of: 'Replay the log', 'State.replay': 'Replay the log', move: 'Move between tiers', compact: 'Compact the log',
  fold: 'Fold the log', chain_digest: 'Fingerprint the old log', 'Compactor.run': 'Summarize finished runs', 'Compactor.compact': 'Summarize a run',
  maintain: 'Housekeeping', _evict: 'Evict from short-term memory', save_snapshot: 'Save a snapshot', 'MemoryStore.__init__': 'Reopen after the crash',
};
// The database idea each step is an instance of. By the function the step runs in, then by line where one line is
// the point (the log append is the commit point, not just "part of a commit").
const TERMS = {
  put: 'autocommit: one write, one transaction', transaction: 'BEGIN … COMMIT', 'Transaction.put': 'buffered write: not durable yet',
  'Transaction.move': 'buffered write: not durable yet', _commit: 'commit', 'State.apply': 'redo: apply a log record to the in-memory view',
  invalidate: 'cascading update, in one transaction', dependents: 'dependency closure, like cascading foreign keys', descendants: 'dependency closure, like cascading foreign keys',
  rollback_to: 'undo by compensation records (ARIES)', as_of: 'point-in-time recovery: replay the log', 'State.replay': 'point-in-time recovery: replay the log',
  move: 'data placement: hot and cold tiers', compact: 'log compaction', fold: 'log compaction: keep the latest record per key', chain_digest: 'hash chain: tamper evidence',
  'Compactor.run': 'summarization: many records become one', 'Compactor.compact': 'summarization: many records become one', maintain: 'background maintenance',
  _evict: 'cache eviction, like a buffer pool', save_snapshot: 'checkpoint', 'MemoryStore.__init__': 'crash recovery: checkpoint, then redo the log tail',
};
const LINE_TERMS = {
  t_new: 'BEGIN', t_commit: 'COMMIT', tp_op: 'buffered write: not durable yet', tm_op: 'buffered write: not durable yet', tr_op: 'buffered write: not durable yet',
  tx_op: 'buffered write: not durable yet', tv_op: 'buffered write: not durable yet', c_lsn: 'LSN: log sequence number', c_append: 'log record, numbered by LSN',
  c_commit: 'atomicity: all records or none', c_engine: 'write-ahead log append, flushed to disk: the commit point', ss_write: 'checkpoint',
  ss_replace: 'atomic rename', o_state: 'crash recovery: RAM starts empty', o_snapif: 'crash recovery: find the checkpoint', o_snapload: 'load the checkpoint',
  o_for: 'redo the log tail', o_apply: 'redo the log tail', k_rewrite: 'atomic swap of the log file', k_seal: 'seal: a fingerprint of the whole log so far',
  k_manifest: 'the compaction is itself logged', k_purged: 'retention: purge old, dead data', e_lru: 'LRU eviction', e_move: 'eviction: hot tier to cold tier',
};
export function visibleSteps(run) {
  const lines = run.src.lines;
  return run.frames
    .filter((f) => f.line === null || !BOOKKEEPING.has(lines[f.line - 1].id))
    .map((f, i, all) => {
      const fn = f.stack[f.stack.length - 1], id = f.line === null ? null : lines[f.line - 1].id;
      return {
        ...f,
        name: f.line === null ? (i === 0 ? 'Before' : i === all.length - 1 ? 'After' : 'Meanwhile') : STEP_NAMES[fn] || 'Step',
        term: f.line === null ? '' : LINE_TERMS[id] || TERMS[fn] || '',
      };
    });
}

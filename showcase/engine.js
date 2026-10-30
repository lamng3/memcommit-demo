var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function utf8(str) { return new TextEncoder().encode(str); }
export function sha256hex(str) {
  var bytes = utf8(str), l = bytes.length, bitLen = l * 8, padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[l] = 0x80;
  var view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000)); view.setUint32(padded.length - 4, bitLen >>> 0);
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64);
  var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  for (var off = 0; off < padded.length; off += 64) {
    for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (i = 16; i < 64; i++) { var s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >>> 3), s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >>> 10); w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0; }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), maj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(function (x) { return ("00000000" + x.toString(16)).slice(-8); }).join("");
}
// Byte-stable JSON, as memcommit.records.canonical: sorted keys, no spaces, non-ASCII kept
export function canonical(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canonical(v[k]); }).join(",") + "}";
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------------------------------------------
// A traced port of memcommit's store: memories, the log, the state, rollback, compaction, tiers.
// Every method that has a Python counterpart calls this._at(<line id>, <what happens>, <locals>, <highlights>) where the
// Python runs a line worth showing. With no tracer set, _at does nothing, so the same code is the plain port the
// tests compare with the Python library.
// ---------------------------------------------------------------------------------------------------------------

export const SYSTEM = 'memcommit';
export const OPS = { put: 'live', restore: 'live', stale: 'stale', retract: 'retracted', move: null };
export const SHORT = 'short', MID = 'mid', LONG = 'long', ARCHIVE = 'archive';
export const TIERS = [SHORT, MID, LONG, ARCHIVE];

export function label(m) { return m.kind === 'seal' || m.kind === 'compaction' ? m.kind + ' ' + m.key : m.key; }

export function makeMemory(agent, kind, key, body, o = {}) {
  const derived = Array.from(new Set(o.derived || [])).sort();
  const scope = o.scope || 'shared', importance = o.importance || 0;
  const content = [kind, key, body, agent, scope, derived];
  if (importance) content.push(importance);
  const m = { kind, key, body, source: agent, scope, derived_from: derived, importance };
  m.canonical = canonical(content);
  m.id = 'm:' + sha256hex(m.canonical).slice(0, 16);
  return m;
}

function memoryJson(m) {
  const d = { id: m.id, kind: m.kind, key: m.key, body: m.body, source: m.source, scope: m.scope, derived_from: m.derived_from };
  if (m.importance) d.importance = m.importance;
  return d;
}
export function recordJson(r) {
  const d = { lsn: r.lsn, txn: r.txn, op: r.op, agent: r.agent, reason: r.reason, memory: memoryJson(r.memory) };
  if (r.tier) d.tier = r.tier;
  if (r.time) d.time = r.time;
  return d;
}

export function newState() {
  return { lsn: 0, memories: new Map(), status: new Map(), tier: new Map(), first: new Map(), last: new Map(), children: new Map() };
}
export function applyRecord(state, r) {
  const m = r.memory;
  if (!state.memories.has(m.id)) {
    state.memories.set(m.id, m); state.first.set(m.id, r); state.tier.set(m.id, r.tier || SHORT);
    m.derived_from.forEach((ref) => { if (!state.children.has(ref)) state.children.set(ref, new Set()); state.children.get(ref).add(m.id); });
  }
  if (r.op === 'move') state.tier.set(m.id, r.tier); else state.status.set(m.id, OPS[r.op]);
  state.last.set(m.id, r); state.lsn = r.lsn;
}
export function replay(records, until) {
  const s = newState();
  for (const r of records) { if (until !== undefined && r.lsn > until) break; applyRecord(s, r); }
  return s;
}
export function stateToJson(s) {
  return { lsn: s.lsn, memories: [...s.memories.keys()].sort((a, b) => s.first.get(a).lsn - s.first.get(b).lsn).map((id) => ({ first: s.first.get(id), last: s.last.get(id), status: s.status.get(id), tier: s.tier.get(id) })) };
}
export function stateFromJson(d) {
  const s = newState(); s.lsn = d.lsn;
  for (const e of d.memories) {
    const m = e.first.memory;
    s.memories.set(m.id, m); s.first.set(m.id, e.first); s.last.set(m.id, e.last); s.status.set(m.id, e.status); s.tier.set(m.id, e.tier);
    m.derived_from.forEach((ref) => { if (!s.children.has(ref)) s.children.set(ref, new Set()); s.children.get(ref).add(m.id); });
  }
  return s;
}

export function chainLinks(records, until) {
  const links = []; let digest = '';
  for (const r of records) { if (r.lsn > until) break; digest = sha256hex(digest + canonical(recordJson(r))); links.push(digest); }
  return links;
}
export function chainDigest(records, until) { const l = chainLinks(records, until); return l.length ? l[l.length - 1] : ''; }

// ---- retention and eviction policies ----
export class KeepAll { purge() { return false; } }
export class ArchivedOlderThan {
  constructor(seconds, deadOnly = false) { this.seconds = seconds; this.deadOnly = deadOnly; }
  purge(memory, state, now) {
    if (state.tier.get(memory.id) !== ARCHIVE || now - state.last.get(memory.id).time < this.seconds) return false;
    return !this.deadOnly || state.status.get(memory.id) !== 'live';
  }
}

// ---- formatting values the way the locals table shows them (Python-flavoured) ----
export function fmt(v, store, depth = 0) {
  if (v === undefined) return '—';
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') { const m = store && store.known.get(v); return m ? '⟨' + label(m) + '⟩' : JSON.stringify(v); }
  if (Array.isArray(v)) { const it = v.slice(0, 6).map((x) => fmt(x, store, depth + 1)); return '[' + it.join(', ') + (v.length > 6 ? ', …+' + (v.length - 6) : '') + ']'; }
  if (v instanceof Set) { const a = [...v]; return a.length ? '{' + a.slice(0, 6).map((x) => fmt(x, store, depth + 1)).join(', ') + (a.length > 6 ? ', …' : '') + '}' : 'set()'; }
  if (v instanceof Map) { const a = [...v]; return a.length ? '{' + a.slice(0, 5).map(([k, x]) => fmt(k, store, depth + 1) + ': ' + fmt(x, store, depth + 1)).join(', ') + (a.length > 5 ? ', …' : '') + '}' : '{}'; }
  if (typeof v === 'object') {
    if (v.lsn !== undefined && v.op !== undefined && v.memory) return '#' + v.lsn + ' ' + v.op + ' ⟨' + label(v.memory) + '⟩';
    if (v.kind !== undefined && v.key !== undefined && v.id) return '⟨' + label(v) + '⟩';
    if (v.raw !== undefined) return String(v.raw);
    const keys = Object.keys(v);
    const s = '{' + keys.map((k) => JSON.stringify(k) + ': ' + (depth > 1 ? '…' : fmt(v[k], store, depth + 1))).join(', ') + '}';
    return s.length > 90 ? s.slice(0, 88) + '…}' : s;
  }
  return String(v);
}

export class Tracer {
  constructor(src) { this.src = src; this.frames = []; this.store = null; this.scopes = [{ fn: 'module', vars: new Map() }]; }
  intro(say, hl) { this.frames.push({ line: null, say, fn: 'module', locals: [], stack: [], view: this.store.view(hl || {}) }); }
  call(fn, args) { this.scopes.push({ fn, vars: new Map(Object.entries(args || {})) }); }
  ret() { this.scopes.pop(); }
  set(vars) { const top = this.scopes[this.scopes.length - 1]; for (const k of Object.keys(vars)) top.vars.set(k, vars[k]); }
  at(id, say, vars, hl) {
    const line = this.src.at[id];
    if (!line) throw new Error('unknown line id ' + id);
    if (vars) this.set(vars);
    const top = this.scopes[this.scopes.length - 1];
    this.frames.push({
      line, say,
      fn: top.fn,
      locals: [...top.vars].map(([k, v]) => [k, fmt(v, this.store)]),
      stack: this.scopes.slice(1).map((s) => s.fn),
      view: this.store.view(hl || {}),
    });
  }
}

// ---- the store ----
class Tx {
  constructor(store, agent) { this.store = store; this.agent = agent; this.ops = []; this.committed = null; }
  _existing(id) {
    const m = this.store.state.memories.get(id) || (this.ops.find((o) => o[0] === 'put' && o[1].id === id) || [])[1];
    if (!m) throw new Error('no memory ' + id);
    return m;
  }
  put(kind, key, body, o = {}) {
    const store = this.store, t = store.t;
    store._at('tp_memory', `Build the memory in memory: its id is a hash of kind, key, body, author, scope and what it is derived from.`, { kind, key, body: { raw: JSON.stringify(body) } });
    const m = makeMemory(this.agent, kind, key, body, o);
    store.known.set(m.id, m);
    if (t) t.set({ memory: m });
    store._at('tp_op', `Nothing is written yet: the operation is only added to this transaction's list.`, null, { hot: [m.id], layer: 'tx', buffer: this.ops.concat([['put', m, '', o.tier || SHORT]]).map(bufOp) });
    this.ops.push(['put', m, '', o.tier || SHORT]);
    return m;
  }
  _op(op, id, reason, tier, lineId, say) {
    const m = this._existing(id), store = this.store;
    this.ops.push([op, m, reason, tier || '']);
    store._at(lineId, typeof say === 'function' ? say(m) : say, null, { hot: [m.id], layer: 'tx', buffer: this.ops.map(bufOp) });
    return m;
  }
  markStale(id, reason) { return this._op('stale', id, reason, '', 'tm_op', (m) => `Queue ⟨${label(m)}⟩ to be marked stale. It is not in the log yet.`); }
  restore(id, reason) { return this._op('restore', id, reason, '', 'tr_op', (m) => `Queue ⟨${label(m)}⟩ to be restored. It is not in the log yet.`); }
  retract(id, reason) { return this._op('retract', id, reason, '', 'tx_op', (m) => `Queue ⟨${label(m)}⟩ to be retracted. It is not in the log yet.`); }
  move(id, tier, reason) { return this._op('move', id, reason, tier, 'tv_op', (m) => `Queue a move of ⟨${label(m)}⟩ to the ${tier} tier. Its status does not change.`); }
}
function bufOp(o) { return { op: o[0], label: label(o[1]), id: o[1].id, tier: o[3] || '' }; }
function rj(r) { return { lsn: r.lsn, txn: r.txn, op: r.op, id: r.memory.id, label: label(r.memory), kind: r.memory.kind, reason: r.reason, tier: r.tier || '', agent: r.agent, time: r.time }; }

export class Store {
  constructor() {
    this.records = []; this.state = newState(); this.txn = 0; this.t = null;
    this.known = new Map(); this.snap = null; this.ramUp = true; this.clockFn = null;
  }
  get lsn() { return this.state.lsn; }
  clock() { return this.clockFn ? this.clockFn() : (this.state.lsn + 1) * 10; }
  attach(tracer) { this.t = tracer; tracer.store = this; return tracer; }
  _at(id, say, vars, hl) { if (this.t) this.t.at(id, say, vars, hl); }
  _call(fn, args) { if (this.t) this.t.call(fn, args); }
  _ret() { if (this.t) this.t.ret(); }

  view(hl) {
    const s = this.state, up = this.ramUp;
    const mems = !up ? [] : [...s.memories.values()].sort((a, b) => s.first.get(a.id).lsn - s.first.get(b.id).lsn).map((m) => ({
      id: m.id, label: label(m), kind: m.kind, status: s.status.get(m.id), tier: s.tier.get(m.id),
      from: m.derived_from.filter((r) => s.memories.has(r)), lsn: s.first.get(m.id).lsn,
    }));
    return {
      lsn: up ? s.lsn : null, txn: this.txn, mems, ramUp: up,
      log: this.records.map(rj), pending: (hl.pending || []).map(rj), buffer: hl.buffer || [],
      hot: hl.hot || [], fresh: hl.fresh || [], bad: hl.bad || [], layer: hl.layer || '',
      shadow: hl.shadow || null, tape: hl.tape || null, snapshot: this.snap ? { lsn: this.snap.state.lsn, txn: this.snap.txn } : null,
      access: hl.access || null, extra: hl.extra || null,
    };
  }

  transaction(agent, fn) {
    this._call('transaction', { agent });
    const tx = new Tx(this, agent);
    this._at('t_new', `Open a transaction: a list of operations. Nothing reaches the log until it is committed.`, { tx: { raw: 'Transaction(agent=' + JSON.stringify(agent) + ')' } }, { layer: 'tx' });
    fn(tx);
    this._at('t_commit', `The agent's work finished without an error, so the transaction is committed.`, null, { layer: 'tx', buffer: tx.ops.map(bufOp) });
    tx.committed = this.commit(tx);
    this._ret();
    return tx;
  }
  put(agent, kind, key, body, o = {}) {
    this._call('put', { agent, kind, key, body: { raw: JSON.stringify(body) } });
    this._at('p_def', `The agent writes one memory. It gets its own transaction.`, null, { layer: 'agent' });
    let m;
    this._at('p_with', `Open a transaction for ${agent}.`, null, { layer: 'agent' });
    this.transaction(agent, (tx) => { this._call('Transaction.put', { kind, key }); m = tx.put(kind, key, body, o); this._ret(); this._at('p_txput', `Back in put: the memory is ⟨${key}⟩, id ${m.id}.`, { memory: m }, { hot: [m.id], layer: 'tx', buffer: tx.ops.map(bufOp) }); });
    this._at('p_ret', `put returns the memory.`, null, { hot: [m.id], layer: 'agent' });
    this._ret();
    return m;
  }

  commit(tx) {
    this._call('_commit', { tx: { raw: 'Transaction(' + tx.ops.length + ' ops)' } });
    const s = this.state, recs = [], statuses = new Map(), tiers = new Map();
    this._at('c_records', `Start an empty list of log records. The commit builds all of them before writing any.`, { records: recs }, { layer: 'tx', buffer: tx.ops.map(bufOp) });
    let lsn = s.lsn; const now = this.clock();
    this._at('c_lsn', `The log is at position ${lsn}. The next record will be number ${lsn + 1}.`, { lsn }, { layer: 'tx' });
    this._at('c_now', `The clock is read once: every record in this transaction shares the time ${now}.`, { now }, { layer: 'tx' });
    const pend = () => recs.slice();
    for (const [op0, memory, reason, tier0] of tx.ops) {
      let op = op0, tier = tier0;
      this._at('c_for', `Next buffered operation: ${op} on ⟨${label(memory)}⟩.`, { op, memory, reason, tier }, { hot: [memory.id], layer: 'tx', pending: pend() });
      const current = statuses.has(memory.id) ? statuses.get(memory.id) : s.status.get(memory.id);
      this._at('c_current', current === undefined ? `⟨${label(memory)}⟩ has never been written: it has no status yet.` : `⟨${label(memory)}⟩ is ${current} right now.`, { current: current === undefined ? null : current }, { hot: [memory.id], layer: 'state', pending: pend() });
      if (op === 'move') {
        const have = tiers.has(memory.id) ? tiers.get(memory.id) : s.tier.get(memory.id);
        const same = have === tier;
        this._at('c_samet', same ? `Already in the ${tier} tier: nothing to write, skip.` : `It is in the ${have} tier and the move wants ${tier}, so a record is needed.`, null, { hot: [memory.id], layer: 'state', pending: pend() });
        if (same) continue;
        tiers.set(memory.id, tier);
        this._at('c_sett', `Remember that this memory is now going to ${tier}, in case the same transaction touches it again.`, null, { hot: [memory.id], layer: 'tx', pending: pend() });
      } else {
        if (op === 'put') {
          const again = current !== undefined;
          this._at('c_ifput', again ? `A put of a memory that already exists, with the same content and so the same id. It becomes a "restore".` : `A new memory: stays a "put".`, { op: again ? 'restore' : 'put' }, { hot: [memory.id], layer: 'state', pending: pend() });
          if (again) { op = 'restore'; tier = ''; }
        }
        const noop = OPS[op] === current;
        this._at('c_noop', noop ? `It is already ${current}: writing the record would change nothing, so skip it.` : `${current === undefined ? 'new' : current} → ${OPS[op]}: a real change, so it gets a record.`, null, { hot: [memory.id], layer: 'state', pending: pend() });
        if (noop) continue;
        statuses.set(memory.id, OPS[op]);
        this._at('c_setstatus', `Note the new status inside this commit, so later operations on the same memory see it.`, null, { hot: [memory.id], layer: 'tx', pending: pend() });
        if (op === 'put') tiers.set(memory.id, tier);
      }
      lsn += 1;
      const rec = { lsn, txn: this.txn + 1, op, memory, agent: tx.agent, reason, tier, time: now };
      recs.push(rec);
      this._at('c_append', `Record #${lsn}, ${op} ⟨${label(memory)}⟩, is built. It is not on disk yet.`, { lsn, records: recs.slice() }, { hot: [memory.id], layer: 'tx', pending: pend() });
    }
    this._at('c_empty', recs.length ? `${recs.length} record${recs.length > 1 ? 's' : ''} to write.` : `Every operation was a no-op, so there is nothing to write.`, null, { layer: 'tx', pending: pend() });
    if (!recs.length) { this._ret(); return null; }
    const commit = { txn: this.txn + 1, agent: tx.agent, records: recs };
    this._at('c_commit', `The records form transaction ${commit.txn}: all of them are written, or none.`, { commit: { raw: 'Commit(txn=' + commit.txn + ', ' + recs.length + ' records)' } }, { layer: 'tx', pending: pend() });
    this.records.push(...recs);
    this._at('c_engine', `The records are appended to the log on disk and flushed. This is the commit point: from here the transaction survives a crash, even though the in-memory view has not changed yet. That order, log first, is what write-ahead means.`, null, { layer: 'engine', fresh: recs.map((r) => r.memory.id), hot: [] });
    this.txn += 1;
    this._at('c_txn', `The transaction counter moves to ${this.txn}.`, null, { layer: 'engine' });
    for (const r of recs) {
      this._at('c_applyfor', `Apply #${r.lsn} to the in-memory state.`, { record: r }, { layer: 'state', hot: [r.memory.id] });
      this._call('State.apply', { record: r });
      const isNew = !s.memories.has(r.memory.id);
      applyRecord(s, r);
      if (isNew) this._at('a_new', `A memory the state has not seen: store it, remember its first record, index what it was derived from.`, { memory: r.memory }, { layer: 'state', hot: [r.memory.id], fresh: [r.memory.id] });
      this._at(r.op === 'move' ? 'a_tier' : 'a_status', (isNew ? `⟨${label(r.memory)}⟩ is new to the state. ` : '') + (r.op === 'move' ? `The record moves ⟨${label(r.memory)}⟩ to the ${r.tier} tier. Its status stays ${s.status.get(r.memory.id)}.` : `The record sets ⟨${label(r.memory)}⟩ to ${s.status.get(r.memory.id)}.`), null, { layer: 'state', hot: [r.memory.id] });
      this._ret();
    }
    this._at('c_return', `Done: the log and the state agree again.`, null, { layer: 'agent' });
    this._ret();
    return commit;
  }

  // ---- reads ----
  asOf(lsn, narrate) {
    if (!narrate || !this.t) return replay(this.records, lsn);
    this._call('as_of', { lsn });
    this._at('as_of', `To see the past, replay the log from the beginning into a fresh state, stopping after record ${lsn}.`, null, { layer: 'engine' });
    this._call('State.replay', { until: lsn });
    const sh = newState();
    const shadow = () => ({ lsn: sh.lsn, until: lsn, mems: [...sh.memories.values()].sort((a, b) => sh.first.get(a.id).lsn - sh.first.get(b.id).lsn).map((m) => ({ id: m.id, label: label(m), status: sh.status.get(m.id), tier: sh.tier.get(m.id), from: m.derived_from.filter((r) => sh.memories.has(r)) })) });
    this._at('s_state', `An empty state: nothing is known yet.`, { state: { raw: 'State()' } }, { layer: 'state', shadow: shadow() });
    for (const r of this.records) {
      if (r.lsn > lsn) { this._at('s_until', `#${r.lsn} is after record ${lsn}: stop. Everything later is ignored, which is the whole of time travel.`, { record: r }, { layer: 'engine', shadow: shadow() }); break; }
      applyRecord(sh, r);
      this._at('s_apply', `Apply #${r.lsn} ${r.op} ⟨${label(r.memory)}⟩ to the replayed state.`, { record: r }, { layer: 'engine', shadow: shadow(), hot: [] , extra: { replayLsn: r.lsn } });
    }
    this._at('s_ret', `The state as of record ${lsn}.`, null, { layer: 'state', shadow: shadow() });
    this._ret(); this._ret();
    return sh;
  }
  dependents(refs) {
    const s = this.state;
    const found = this.descendants(refs);
    const out = [...found].filter((m) => s.status.get(m) === 'live').sort((a, b) => s.last.get(a).lsn - s.last.get(b).lsn);
    this._at('dep_ret', `Keep the live ones, in log order: ${out.length} memor${out.length === 1 ? 'y' : 'ies'}.`, { dependents: out }, { layer: 'state', fresh: out });
    return out;
  }
  descendants(refs) {
    const s = this.state;
    this._call('descendants', { refs });
    const found = new Set();
    this._at('d_found', `Start a list of everything reached so far: empty.`, { found }, { layer: 'state' });
    const frontier = refs.slice();
    this._at('d_frontier', `Start a work list with the memory that went bad.`, { frontier: frontier.slice() }, { layer: 'state', hot: frontier.slice() });
    while (frontier.length) {
      const cur = frontier.pop();
      const kids = [...(s.children.get(cur) || [])];
      this._at('d_for', `Take ⟨${(s.memories.get(cur) || { key: cur }).key}⟩ off the work list. ${kids.length ? 'Built directly on it: ' + kids.map((k) => '⟨' + s.memories.get(k).key + '⟩').join(', ') + '.' : 'Nothing was built on it.'}`, { frontier: frontier.slice(), child: kids.length ? kids[0] : null }, { layer: 'state', hot: [cur], fresh: [...found] });
      for (const child of kids) {
        if (found.has(child)) { this._at('d_if', `⟨${label(s.memories.get(child))}⟩ was already reached: skip.`, { child }, { layer: 'state', hot: [child], fresh: [...found] }); continue; }
        found.add(child); frontier.push(child);
        this._at('d_add', `⟨${label(s.memories.get(child))}⟩ is reached for the first time. Add it, and queue it so what was built on it is found too.`, { child, found, frontier: frontier.slice() }, { layer: 'state', hot: [child], fresh: [...found] });
      }
    }
    this._ret();
    return found;
  }

  // ---- writes that other writes are built from ----
  invalidate(refs, reason, agent = SYSTEM) {
    this._call('invalidate', { refs: refs.slice(), reason, agent });
    this._at('i_refs', `Start from the memories that went bad: ${refs.map((r) => '⟨' + (this.state.memories.get(r) || { key: r }).key + '⟩').join(', ')}.`, null, { layer: 'agent', hot: refs.slice(), bad: refs.slice() });
    const s = this.state;
    let targets = refs.filter((r) => s.status.get(r) === 'live');
    this._at('i_targets', `The premise itself is live, so it is marked stale too.`, { targets: targets.slice() }, { layer: 'state', hot: targets.slice() });
    this._call('dependents', { refs: refs.slice() });
    const deps = this.dependents(refs);
    this._ret();
    targets = targets.concat(deps.filter((m) => !targets.includes(m)));
    this._at('i_deps', `Add everything live that was built on them, directly or through other memories.`, { targets: targets.slice() }, { layer: 'state', fresh: targets.slice() });
    let moved = [];
    this._at('i_if', targets.length ? `${targets.length} memories to mark stale.` : `Nothing live to invalidate: write nothing.`, null, { layer: 'agent' });
    if (targets.length) {
      this._at('i_with', `One transaction for the whole cascade, so it is all-or-nothing.`, null, { layer: 'agent' });
      this.transaction(agent, (tx) => {
        for (const id of targets) {
          this._at('i_for', `Mark ⟨${label(this.known.get(id))}⟩ stale.`, { memory_id: id }, { layer: 'agent', hot: [id] });
          tx.markStale(id, reason);
        }
      });
    }
    this._at('i_ret', `${targets.length} memories marked stale.`, null, { layer: 'agent', fresh: targets.slice() });
    this._ret();
    return targets;
  }

  rollbackTo(lsn, reason, agent = SYSTEM) {
    this._call('rollback_to', { lsn, reason: reason || '', agent });
    this._at('r_if', lsn >= this.lsn ? `Already at record ${this.lsn}: nothing to undo.` : `The log is at record ${this.lsn}; we want record ${lsn}. The log is not rewound: the difference will be written as new records.`, null, { layer: 'agent' });
    if (lsn >= this.lsn) { this._ret(); return []; }
    const target = this.asOf(lsn, true);
    this._at('r_target', `The state as it was at record ${lsn}: ${target.memories.size} memories.`, { target: { raw: 'State(lsn=' + target.lsn + ', ' + target.memories.size + ' memories)' } }, { layer: 'state', shadow: this._shadowOf(target, lsn) });
    reason = reason || `rollback to lsn ${lsn}`;
    this._at('r_reason', `Every compensating record will say why.`, { reason }, { layer: 'agent', shadow: this._shadowOf(target, lsn) });
    const s = this.state; let written = [];
    this._at('r_with', `One transaction: the rollback is all-or-nothing too.`, null, { layer: 'agent', shadow: this._shadowOf(target, lsn) });
    const tx = new Tx(this, agent);
    for (const [id, status] of [...s.status]) {
      const wanted = target.status.has(id) ? target.status.get(id) : 'retracted';
      const tier = target.tier.get(id), nowTier = s.tier.get(id);
      const sdiff = wanted !== status, tdiff = tier !== undefined && tier !== nowTier;
      const m = this.known.get(id);
      this._at('r_wanted', `⟨${label(m)}⟩: then ${wanted}${target.status.has(id) ? '' : ' (did not exist yet)'}, now ${status}. ${sdiff || tdiff ? 'Different: it needs a compensating record.' : 'Same: nothing to do.'}`, { memory_id: id, status, wanted, tier: tier === undefined ? null : tier }, { layer: 'state', hot: [id], shadow: this._shadowOf(target, lsn), buffer: tx.ops.map(bufOp), bad: sdiff || tdiff ? [id] : [] });
      if (sdiff) {
        this._at('r_diff', `${status} ≠ ${wanted}.`, null, { layer: 'state', hot: [id], shadow: this._shadowOf(target, lsn), buffer: tx.ops.map(bufOp) });
        if (wanted === 'live') tx._op('restore', id, reason, '', 'r_restore', `Queue a restore: ⟨${label(m)}⟩ was live then.`);
        else if (wanted === 'stale') tx._op('stale', id, reason, '', 'r_stale', `Queue a stale mark.`);
        else tx._op('retract', id, reason, '', 'r_retract', `Queue a retract: ${target.status.has(id) ? 'it was retracted then' : 'it did not exist then'}.`);
      }
      if (tdiff) {
        this._at('r_tier', `Its tier was ${tier} then and is ${nowTier} now.`, { tier }, { layer: 'state', hot: [id], shadow: this._shadowOf(target, lsn) });
        tx._op('move', id, reason, tier, 'r_move', `Queue a move back to the ${tier} tier.`);
        tx.ops[tx.ops.length - 1][3] = tier;
      }
    }
    this._at('t_commit', `Commit the ${tx.ops.length} queued operation${tx.ops.length === 1 ? '' : 's'}.`, null, { layer: 'tx', buffer: tx.ops.map(bufOp), shadow: this._shadowOf(target, lsn) });
    tx.committed = this.commit(tx);
    written = tx.committed ? tx.committed.records : [];
    this._at('r_ret', `${written.length} record${written.length === 1 ? '' : 's'} written. The old records are all still there: history was added to, not erased.`, { written }, { layer: 'agent', fresh: written.map((r) => r.memory.id) });
    this._ret();
    return written;
  }
  _shadowOf(sh, lsn) {
    return { lsn: sh.lsn, until: lsn, done: true, mems: [...sh.memories.values()].sort((a, b) => sh.first.get(a.id).lsn - sh.first.get(b.id).lsn).map((m) => ({ id: m.id, label: label(m), status: sh.status.get(m.id), tier: sh.tier.get(m.id), from: m.derived_from.filter((r) => sh.memories.has(r)) })) };
  }

  move(ids, tier, reason, agent = SYSTEM) {
    this._call('move', { memory_ids: ids.slice(), tier, reason, agent });
    const moved = ids.filter((m) => this.state.tier.has(m) && this.state.tier.get(m) !== tier);
    this._at('mv_moved', `${moved.length} of ${ids.length} are not already in the ${tier} tier.`, { moved }, { layer: 'state', hot: moved.slice() });
    if (moved.length) {
      this._at('mv_with', `Move them all in one transaction.`, null, { layer: 'agent' });
      this.transaction(agent, (tx) => { for (const id of moved) { this._at('mv_for', `Move ⟨${label(this.known.get(id))}⟩.`, { memory_id: id }, { layer: 'agent', hot: [id] }); tx.move(id, tier, reason); } });
    }
    this._ret();
    return moved;
  }

  // ---- the process dies; the log and the snapshot file survive ----
  saveSnapshot() {
    this._call('save_snapshot', {});
    const data = { txn: this.txn, state: stateToJson(this.state) };
    this._at('ss_write', `The whole state is written to a temporary file: the newest record of every memory, so it is smaller than the log.`, { txn: this.txn, lsn: this.state.lsn }, { layer: 'state' });
    this.snap = { txn: data.txn, state: { lsn: this.state.lsn, memories: data.state.memories.slice() } };
    this._at('ss_replace', `The new file replaces the old one in a single atomic step: a crash leaves the old snapshot or the new one, never half of one.`, null, { layer: 'snapshot' });
    this._ret();
  }
  crash() { this.state = newState(); this.ramUp = false; this.txn = 0; }
  reopen() {
    this._call('MemoryStore.__init__', {});
    this.ramUp = true;
    this.state = newState(); this.txn = 0;
    this._at('o_state', `A fresh process starts with an empty state in RAM: only the log on disk (and the snapshot file, if any) survived.`, { 'self.state': { raw: 'State()' } }, { layer: 'state' });
    const hasSnap = !!this.snap;
    this._at('o_snapif', hasSnap ? `There is a snapshot file: use it as the starting point.` : `No snapshot: the whole log has to be replayed.`, null, { layer: 'snapshot' });
    if (hasSnap) {
      this.state = stateFromJson(this.snap.state); this.txn = this.snap.txn;
      this._at('o_snapload', `Load the snapshot: ${this.state.memories.size} memories are back in RAM as of record ${this.state.lsn}, without reading those log records.`, { 'self.state': { raw: 'State(lsn=' + this.state.lsn + ')' } }, { layer: 'snapshot' });
    }
    const after = this.records.filter((r) => r.lsn > this.state.lsn);
    this._at('o_for', after.length ? `${after.length} record${after.length > 1 ? 's' : ''} after record ${this.state.lsn} still to replay.` : `The snapshot is current: nothing to replay.`, { records: after }, { layer: 'engine' });
    for (const r of after) {
      applyRecord(this.state, r); this.txn = Math.max(this.txn, r.txn);
      this._at('o_apply', `Replay #${r.lsn} ${r.op} ⟨${label(r.memory)}⟩. This is the same apply that ran during the commit.`, { record: r }, { layer: 'state', hot: [r.memory.id], fresh: [r.memory.id] });
    }
    this._ret();
  }

  // ---- log compaction ----
  fold(records, horizon) {
    this._call('fold', { records: { raw: records.length + ' records' }, horizon });
    const put = new Map(), status = new Map(), move = new Map();
    const tape = (cur, kept) => this._tape(records, horizon, { put, status, move, cur, kept });
    this._at('f_init', `For each memory, track three things: its first write, its latest status change, its latest move.`, { put, status, move }, { layer: 'engine', tape: tape(null) });
    for (const r of records) {
      this._at('f_for', `Next record: #${r.lsn} ${r.op} ⟨${label(r.memory)}⟩.`, { r }, { layer: 'engine', tape: tape(r.lsn) });
      if (r.lsn > horizon) { this._at('f_break', `#${r.lsn} is past the horizon (${horizon}): stop folding. Later records are copied through untouched.`, null, { layer: 'engine', tape: tape(r.lsn) }); break; }
      const id = r.memory.id;
      if (r.op === 'put' && !put.has(id)) { put.set(id, r); this._at('f_put', `The first put of ⟨${label(r.memory)}⟩: remember it. Only this one is ever needed.`, { put }, { layer: 'engine', tape: tape(r.lsn), hot: [id] }); }
      else if (r.op === 'move') { move.set(id, r); this._at('f_move', `A move: only the latest per memory matters, so this replaces any earlier one.`, { move }, { layer: 'engine', tape: tape(r.lsn), hot: [id] }); }
      else { status.set(id, r); this._at('f_status', `A status change (${r.op}): the latest one wins, replacing any earlier one.`, { status }, { layer: 'engine', tape: tape(r.lsn), hot: [id] }); }
    }
    let kept = [...put.values()];
    this._at('f_kept', `Every put is kept: ${kept.length} records.`, { kept }, { layer: 'engine', tape: tape(null, kept) });
    kept = kept.concat([...status.values()].filter((r) => OPS[r.op] !== 'live'));
    this._at('f_status_kept', `Keep a memory's last status record unless it leaves the memory live: a put already says live.`, { kept }, { layer: 'engine', tape: tape(null, kept) });
    kept = kept.concat([...move.entries()].filter(([id, r]) => r.tier !== (put.get(id).tier || SHORT)).map(([, r]) => r));
    this._at('f_move_kept', `Keep a memory's last move unless it ended where its put placed it.`, { kept }, { layer: 'engine', tape: tape(null, kept) });
    kept.sort((a, b) => a.lsn - b.lsn);
    this._at('f_ret', `${kept.length} records replay to the same state as the ${records.filter((r) => r.lsn <= horizon).length} they replace, with their original numbers, authors and reasons.`, { kept }, { layer: 'engine', tape: tape(null, kept) });
    this._ret();
    return kept;
  }
  _tape(records, horizon, o) {
    const keptSet = o.kept ? new Set(o.kept.map((r) => r.lsn)) : null;
    return {
      horizon, cur: o.cur,
      before: records.map((r) => ({ ...rj(r), zone: r.lsn <= horizon ? 'fold' : 'later', keep: keptSet ? keptSet.has(r.lsn) : null, gone: o.gone ? o.gone.has(r.memory.id) : false })),
      folding: o.put ? { put: [...o.put.values()].map((r) => r.lsn), status: [...o.status.values()].map((r) => r.lsn), move: [...o.move.values()].map((r) => r.lsn) } : null,
      after: o.after ? o.after.map(rj) : null,
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Log compaction (storage.compact), trace compaction (Compactor), and tier eviction (TieredMemory._evict)
// ---------------------------------------------------------------------------------------------------------------

Store.prototype._silent = function (fn) { const t = this.t; this.t = null; try { return fn(); } finally { this.t = t; } };

export const COMPACTION = 'compaction', SEAL = 'seal';

export function compact(store, { horizon, retention, agent = SYSTEM } = {}) {
  store._call('compact', { horizon: horizon === undefined ? null : horizon });
  const records = store.records.slice();
  store._at('k_records', `Read the whole log: ${records.length} records.`, { records: { raw: records.length + ' records' } }, { layer: 'engine', tape: store._tape(records, store.lsn, {}) });
  horizon = horizon === undefined ? store.lsn : Math.min(horizon, store.lsn);
  store._at('k_horizon', `Fold everything up to record ${horizon}.`, { horizon }, { layer: 'engine', tape: store._tape(records, horizon, {}) });
  retention = retention || new KeepAll();
  const later = records.filter((r) => r.lsn > horizon);
  store._at('k_later', `${later.length} record${later.length === 1 ? '' : 's'} after the horizon will be copied as they are.`, { later: { raw: later.length + ' records' } }, { layer: 'engine', tape: store._tape(records, horizon, {}) });
  const touchedLater = new Set(later.map((r) => r.memory.id));
  store._at('k_touched', `A memory written to after the horizon is still in use: it cannot be purged.`, { touched_later: touchedLater }, { layer: 'engine', hot: [...touchedLater], tape: store._tape(records, horizon, {}) });
  const atHorizon = replay(records, horizon);
  store._at('k_at', `Rebuild the state as of record ${horizon}, to judge each memory as it was then.`, { at_horizon: { raw: 'State(lsn=' + atHorizon.lsn + ')' } }, { layer: 'state', shadow: store._shadowOf(atHorizon, horizon), tape: store._tape(records, horizon, {}) });
  const now = store.clock();
  store._at('k_now', `The store's clock says ${now}.`, { now }, { layer: 'engine', tape: store._tape(records, horizon, {}) });
  const rows = [];
  const purged = [];
  for (const [id, memory] of atHorizon.memories) {
    const eligible = !touchedLater.has(id) && memory.kind !== COMPACTION && memory.kind !== SEAL;
    const verdict = eligible && retention.purge(memory, atHorizon, now);
    rows.push({ label: label(memory), tier: atHorizon.tier.get(id), status: atHorizon.status.get(id), age: now - atHorizon.last.get(id).time, verdict: verdict ? 'purge' : eligible ? 'keep' : touchedLater.has(id) ? 'in use' : 'system' });
    if (verdict) purged.push(id);
  }
  store._at('k_purged', purged.length ? `The retention policy drops ${purged.length}: archived, no longer holding, and old enough. A purged memory leaves no record at all.` : `The retention policy purges nothing.`, { purged }, { layer: 'engine', bad: purged.slice(), extra: { title: 'Retention check', rows }, tape: store._tape(records, horizon, { gone: new Set(purged) }) });
  const gone = new Set(purged);
  const folded0 = store.fold(records, horizon);
  const folded = folded0.filter((r) => !gone.has(r.memory.id));
  store._at('k_folded', gone.size ? `Fold, then drop what was purged: ${folded0.length} − ${folded0.length - folded.length} = ${folded.length} records.` : `${folded.length} records after folding.`, { folded: { raw: folded.length + ' records' } }, { layer: 'engine', bad: purged.slice(), tape: store._tape(records, horizon, { gone, kept: folded }) });
  const links = chainLinks(records, horizon);
  const oldDigest = links.length ? links[links.length - 1] : '';
  store._call('chain_digest', { until: horizon });
  store._at('h_init', `A hash chain starts empty. It will fingerprint the old log, so an auditor can later show what was folded.`, { digest: '' }, { layer: 'engine', tape: store._tape(records, horizon, { gone, kept: folded }) });
  const show = Math.min(3, links.length);
  for (let i = 0; i < show; i++) store._at('h_link', `Link ${i + 1}: sha256(previous link + record #${records[i].lsn}) = ${links[i].slice(0, 10)}…`, { digest: links[i].slice(0, 12) + '…' }, { layer: 'engine', extra: { title: 'Hash chain', chain: links.slice(0, i + 1).map((h) => h.slice(0, 8)) }, tape: store._tape(records, horizon, { gone, kept: folded }) });
  if (links.length > show) store._at('h_link', `…and so on through #${horizon}. Each link depends on every record before it: change one old record and every later link changes.`, { digest: oldDigest.slice(0, 12) + '…' }, { layer: 'engine', extra: { title: 'Hash chain', chain: links.map((h) => h.slice(0, 8)) }, tape: store._tape(records, horizon, { gone, kept: folded }) });
  store._at('h_ret', `The digest of the old log up to #${horizon}.`, { digest: oldDigest.slice(0, 12) + '…' }, { layer: 'engine' });
  store._ret();
  store._at('k_digest', `Keep that digest: it goes into the compaction record.`, { old_digest: oldDigest.slice(0, 12) + '…' }, { layer: 'engine' });
  const newLog = folded.concat(later);
  store._at('k_rewrite', `The new, shorter log replaces the old one in a single atomic step: ${records.length} records → ${newLog.length}.`, null, { layer: 'engine', tape: store._tape(records, horizon, { gone, kept: folded, after: newLog }) });
  store.records = newLog.slice();
  const before = store.state;
  store.state = replay(store.records);
  store._at('k_replay', `Replay the new log into a fresh state. It must equal the old state, except that purged memories are gone.`, { 'store.state': { raw: 'State(lsn=' + store.state.lsn + ', ' + store.state.memories.size + ' memories)' } }, { layer: 'state', bad: purged.slice(), tape: store._tape(records, horizon, { gone, kept: folded, after: newLog }) });
  const body = { horizon, before: records.length, after: newLog.length, purged, digest: oldDigest };
  store._at('k_body', `The compaction record says what was done: horizon ${horizon}, ${body.before} → ${body.after} records, ${purged.length} purged, and the old chain's digest.`, { body }, { layer: 'engine' });
  const manifest = store._silent(() => store.put(agent, COMPACTION, `lsn:${horizon}`, body, { tier: ARCHIVE }));
  store._at('k_manifest', `A compaction memory is written to the archive, as an ordinary memory. Compaction is itself in the log.`, { manifest }, { layer: 'engine', fresh: [manifest.id], hot: [manifest.id] });
  const lsn = store.lsn;
  const sealBody = { lsn, digest: chainDigest(store.records, lsn) };
  const sealMem = store._silent(() => store.put(agent, SEAL, `lsn:${lsn}`, sealBody, { tier: ARCHIVE }));
  store._at('k_seal', `A new seal fingerprints the compacted log as it is now (archive tier, for auditors).`, { seal: sealMem }, { layer: 'engine', fresh: [sealMem.id], hot: [sealMem.id] });
  store._ret();
  return { horizon, before: records.length, after: body.after, purged, manifest, seal: sealMem };
}

// ---- traces and the compactor ----
export function startTrace(store, agent, task, run) {
  const root = store.put(agent, 'trace', `${agent}:${run}`, { agent, task, run, inputs: null });
  return { id: root.id, root, steps: [], agent };
}
export function traceStep(store, t, kind, body, tier = SHORT) {
  const parent = t.steps.length ? t.steps[t.steps.length - 1].id : t.root.id;
  const content = Object.assign({}, body, { trace: t.root.id, step: t.steps.length, parent });
  const m = store.put(t.agent, kind, `${t.root.key}#${t.steps.length}`, content, { derived: [t.root.id, parent], tier });
  t.steps.push(m);
  return m;
}
export function outline(t) {
  const counts = {};
  t.steps.forEach((m) => { counts[m.kind] = (counts[m.kind] || 0) + 1; });
  const ends = t.steps.filter((m) => m.kind === 'trace_end');
  return {
    agent: t.agent, task: t.root.body.task, run: t.root.body.run, status: ends.length ? ends[ends.length - 1].body.status : null,
    tools: t.steps.filter((m) => m.kind === 'action').map((m) => m.body.tool),
    results: t.steps.filter((m) => m.kind === 'result').map((m) => m.body.value),
    errors: t.steps.filter((m) => m.kind === 'error' || m.body.error).map((m) => m.body.error),
    steps: counts,
  };
}
export class Compactor {
  constructor(store, traces, agent = SYSTEM) { this.store = store; this.traces = traces; this.agent = agent; }
  compact(t) {
    const store = this.store;
    store._call('Compactor.compact', { t: { raw: 'Trace(' + t.root.key + ')' } });
    const body0 = outline(t);
    store._at('cc_body', `The summarizer reads the trace's steps and writes an outline: the task, the outcome, the tools called, the results, the errors. No model is needed.`, { body: body0 }, { layer: 'agent', hot: t.steps.map((m) => m.id).concat([t.id]) });
    const body = Object.assign({}, body0, { trace: t.id });
    const liveSteps = t.steps.filter((m) => store.state.status.get(m.id) === 'live');
    store._at('cc_live', `${liveSteps.length} of ${t.steps.length} steps are live. The summary will be derived from the trace and each of them.`, { live_steps: liveSteps }, { layer: 'state', fresh: liveSteps.map((m) => m.id) });
    let summary;
    store._at('cc_with', `One transaction: the summary appears and the steps leave working memory together, or neither happens.`, null, { layer: 'agent' });
    store.transaction(this.agent, (tx) => {
      store._call('Transaction.put', { kind: 'summary', key: t.root.key });
      summary = tx.put('summary', t.root.key, body, { scope: t.root.scope, derived: [t.id].concat(liveSteps.map((m) => m.id)), tier: LONG });
      store._ret();
      store._at('cc_put', `Buffer the summary, in the long-term tier, derived from the trace and its steps. If a step is later found wrong, the summary goes stale with it.`, { summary }, { layer: 'tx', hot: [summary.id], buffer: [] });
      for (const m of t.steps) {
        store._at('cc_for', `Archive step ⟨${m.key}⟩.`, { m }, { layer: 'tx', hot: [m.id] });
        store._call('Transaction.move', { memory_id: m.id, tier: ARCHIVE });
        tx.move(m.id, ARCHIVE, `compacted into ${summary.id}`);
        store._ret();
        store._at('cc_move', `Buffered: ⟨${m.key}⟩ → archive. It is not deleted; it leaves the working set.`, null, { layer: 'tx', hot: [m.id] });
      }
    });
    store._at('cc_ret', `The summary is returned. The steps are still in the log and the archive.`, { summary }, { layer: 'agent', fresh: [summary.id] });
    store._ret();
    return summary;
  }
}

// ---- tiers: a logical access clock, LRU, and eviction ----
export class AccessLog {
  constructor() { this.now = 0; this.uses = new Map(); }
  touch(ids) { for (const id of ids) { this.now += 1; const u = this.uses.get(id); if (!u) this.uses.set(id, { first: this.now, last: this.now, count: 1 }); else { u.last = this.now; u.count += 1; } } }
  get(id) { return this.uses.get(id) || { first: 0, last: 0, count: 0 }; }
}
export class Tiered {
  constructor(store, { capacity, compactor, access, agent = SYSTEM, traces = [] }) { Object.assign(this, { store, capacity, compactor, access: access || new AccessLog(), agent, traces }); }
  candidates(tier) {
    const s = this.store.state;
    return [...s.tier].filter(([, t]) => t === tier).map(([id]) => ({ id, memory: s.memories.get(id), status: s.status.get(id), ...this.access.get(id) }));
  }
  accessTable(tier) { return this.candidates(tier).map((c) => ({ id: c.id, label: label(c.memory), status: c.status, written: c.first, last: c.last, count: c.count })); }
  maintain() {
    const store = this.store, s = store.state;
    store._call('maintain', {});
    store._at('mt_done', `The housekeeping pass runs three jobs: compact, promote, evict.`, { done: { raw: 'Maintenance()' } }, { layer: 'agent', access: this.accessTable(SHORT) });
    let compacted = [];
    if (this.compactor) {
      store._at('mt_compact', `1. Compact: every finished trace becomes one long-term summary.`, null, { layer: 'agent', access: this.accessTable(SHORT) });
      store._call('Compactor.run', {});
      store._at('cr_run', `${this.traces.length} finished trace${this.traces.length === 1 ? '' : 's'} to compact.`, null, { layer: 'agent' });
      compacted = this.traces.map((t) => this.compactor.compact(t).id);
      store._ret();
    }
    store._at('mt_promote', `2. Promote: the promotion policy picks short-term memories that earned long-term. This run uses Never, so none.`, { promoted: [] }, { layer: 'agent', access: this.accessTable(SHORT) });
    store._at('mt_dest', `The destination for evictions is the archive (there is no mid tier configured).`, { destination: ARCHIVE }, { layer: 'agent', access: this.accessTable(SHORT) });
    store._at('mt_evict', `3. Evict: short-term memory is a cache of ${this.capacity} slots per partition.`, null, { layer: 'agent', access: this.accessTable(SHORT) });
    const evicted = this._evict(SHORT, this.capacity, ARCHIVE);
    store._ret();
    return { compacted, evicted };
  }
  _evict(tier, capacity, destination) {
    const store = this.store;
    store._call('_evict', { tier, capacity, destination });
    const groups = new Map();
    for (const c of this.candidates(tier)) { const k = c.memory.scope; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    store._at('e_for', `Group the short-term memories by partition (their scope): ${[...groups].map(([k, g]) => k + ' has ' + g.length).join(', ') || 'none'}.`, { groups: { raw: [...groups].map(([k, g]) => k + ': ' + g.length).join(', ') } }, { layer: 'state', access: this.accessTable(tier) });
    let victims = [];
    store._at('e_victims', `No victims chosen yet.`, { victims }, { layer: 'state', access: this.accessTable(tier) });
    for (const [name, group] of groups) {
      const over = group.length - capacity;
      store._at('e_over', over > 0 ? `Partition "${name}": ${group.length} memories in ${capacity} slots, so ${over} too many.` : `Partition "${name}": ${group.length} memories fit in ${capacity} slots. Nothing to evict.`, { over }, { layer: 'state', access: this.accessTable(tier) });
      if (over <= 0) continue;
      let gone = group.filter((c) => c.status !== 'live').slice(0, over);
      store._at('e_gone', gone.length ? `Memories that no longer hold go first: ${gone.map((c) => '⟨' + label(c.memory) + '⟩').join(', ')}. Keeping them would waste a slot.` : `No stale or retracted memories to drop first.`, { gone: gone.map((c) => c.id) }, { layer: 'state', bad: gone.map((c) => c.id), access: this.accessTable(tier) });
      const live = group.filter((c) => c.status === 'live');
      if (over > gone.length) {
        const n = over - gone.length;
        const picked = live.slice().sort((a, b) => a.last - b.last || a.first - b.first).slice(0, n);
        gone = gone.concat(picked);
        store._at('e_lru', `LRU picks ${n} more from the live ones: the least recently used, by (last used, written): ${picked.map((c) => '⟨' + label(c.memory) + '⟩ last=' + c.last).join(', ')}.`, { gone: gone.map((c) => c.id) }, { layer: 'state', bad: gone.map((c) => c.id), access: this.accessTable(tier) });
      }
      victims = victims.concat(gone);
      store._at('e_add', `${victims.length} victim${victims.length === 1 ? '' : 's'} so far.`, { victims: victims.map((c) => c.id) }, { layer: 'state', bad: victims.map((c) => c.id), access: this.accessTable(tier) });
    }
    store._at('e_move', `Move the victims to the ${destination} tier. They are not deleted: they leave the working set, and search can still reach them on request.`, null, { layer: 'agent', bad: victims.map((c) => c.id) });
    const moved = store.move(victims.map((c) => c.id), destination, `evicted from ${tier}-term memory`, this.agent);
    store._at('e_ret', `Evicted: ${moved.length}.`, { moved }, { layer: 'agent', fresh: moved });
    store._ret();
    return moved;
  }
}

import { SCENARIOS, buildVariant, visibleSteps } from './scenarios.js?v=3';
import { TIERS } from './engine.js?v=3';

const $ = (s) => document.querySelector(s);
const short = (l) => { const p = l.split('/'); return p.length > 2 ? p.slice(-2).join('/') : l; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

/* ---------- keyed DOM updates, so elements persist across steps and CSS transitions run ---------- */
function sync(parent, items, key, make, update) {
  const have = new Map([...parent.children].map((e) => [e.dataset.k, e]));
  let prev = null;
  for (const it of items) {
    const k = String(key(it));
    let el = have.get(k);
    if (!el) { el = make(it); el.dataset.k = k; } else have.delete(k);
    update(el, it);
    const want = prev ? prev.nextSibling : parent.firstChild;
    if (el !== want) parent.insertBefore(el, want);
    prev = el;
  }
  have.forEach((e) => e.remove());
}

/* ---------- app state ---------- */
const S = { sc: SCENARIOS[0], vid: SCENARIOS[0].variants[0].id, run: null, steps: [], i: 0, timer: null, prevView: null };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function select(scId, vid, step) {
  stop();
  S.sc = SCENARIOS.find((x) => x.id === scId) || SCENARIOS[0];
  S.vid = (S.sc.variants.find((v) => v.id === vid) || S.sc.variants[0]).id;
  S.run = buildVariant(S.sc.id, S.vid);
  S.steps = visibleSteps(S.run);
  S.prevView = null;
  drawChrome();
  go(step === undefined ? 0 : step);
}

function drawChrome() {
  const tabs = $('#tabs'); tabs.replaceChildren();
  for (const sc of SCENARIOS) {
    const b = h('button', '', sc.title); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', sc.id === S.sc.id);
    b.onclick = () => select(sc.id); tabs.append(b);
  }
  $('#blurb').textContent = S.sc.blurb;
  const seg = $('#variants'); seg.replaceChildren();
  for (const v of S.sc.variants) { const b = h('button', '', v.title); b.setAttribute('aria-pressed', v.id === S.vid); b.onclick = () => select(S.sc.id, v.id); seg.append(b); }
  seg.hidden = S.sc.variants.length < 2;
  $('#hint').textContent = S.run.variant.hint;
  $('#scrub').max = S.steps.length - 1;
}

/* ---------- stepping ---------- */
function go(i) {
  const n = S.steps.length;
  S.i = Math.max(0, Math.min(n - 1, i));
  render();
  history.replaceState(null, '', `#${S.sc.id}/${S.vid}/${S.i + 1}`);
}
// the next step that belongs to a different part of the story
const over = () => {
  const f = S.steps;
  for (let j = S.i + 1; j < f.length; j++) if (f[j].name !== f[S.i].name) return j;
  return f.length - 1;
};
function play() {
  if (S.timer) return stop();
  if (S.i >= S.steps.length - 1) go(0);
  $('#play').textContent = '❚❚ Pause';
  const tick = () => { if (S.i >= S.steps.length - 1) return stop(); go(S.i + 1); S.timer = setTimeout(tick, +$('#speed').value); };
  S.timer = setTimeout(tick, 250);
}
function stop() { if (S.timer) { clearTimeout(S.timer); S.timer = null; } $('#play').textContent = '▶ Play'; }

/* ---------- drawing a frame ---------- */
function render() {
  const f = S.steps[S.i], v = f.view, N = S.steps.length;
  // controls and narration
  $('#scrub').value = S.i; $('#count').textContent = `step ${S.i + 1} / ${N}`;
  $('#first').disabled = $('#prev').disabled = S.i === 0; $('#next').disabled = $('#last').disabled = $('#over').disabled = S.i === N - 1;
  $('#say').textContent = f.say;
  $('#stepName').textContent = f.name;
  $('#stepTerm').textContent = f.term || ''; $('#stepTerm').hidden = !f.term;
  drawLayers(v);
  drawGraph(v);
  drawDetail(v);
  S.prevView = v;
}

function recCell(r, cls) {
  const e = h('div', 'rec ' + r.op + (cls ? ' ' + cls : ''));
  e.append(h('b', '', '#' + r.lsn + ' ' + r.op), h('span', '', r.label + (r.tier ? ' → ' + r.tier : '')));
  e.title = `log record ${r.lsn} (LSN) · transaction ${r.txn} · ${r.op} · ${r.label}${r.tier ? ' → ' + r.tier : ''}${r.reason ? ' · ' + r.reason : ''} · by ${r.agent}`;
  return e;
}

function drawLayers(v) {
  document.querySelectorAll('.box').forEach((b) => b.classList.toggle('active', b.dataset.layer === v.layer));
  const prevLen = S.prevView ? S.prevView.log.length : v.log.length;
  // transaction: buffered operations and records built but not yet written
  sync($('#txBuf'), v.buffer, (o) => o.op + o.id + o.tier, (o) => h('div', 'bufop'), (el, o) => { el.textContent = o.op + ' ⟨' + o.label + '⟩' + (o.tier ? ' → ' + o.tier : ''); });
  sync($('#txPend'), v.pending, (r) => 'p' + r.lsn, (r) => recCell(r, 'pending'), () => {});
  // the log on disk
  const tape = $('#tape');
  sync(tape, v.log, (r) => r.lsn, (r) => recCell(r), (el, r) => { const idx = v.log.indexOf(r); el.classList.toggle('now', idx >= prevLen && v.log.length > prevLen); });
  if (!S.prevView || v.log.length !== prevLen) tape.scrollTo({ left: tape.scrollWidth, behavior: reduced || !S.prevView ? 'auto' : 'smooth' });
  $('#engineSub').textContent = `${v.log.length} record${v.log.length === 1 ? '' : 's'}, append-only, on disk`;
  // state with its tier lanes
  const stateBox = $('#L-state');
  stateBox.classList.toggle('down', !v.ramUp);
  $('#stateSub').textContent = v.ramUp ? `${v.mems.length} memor${v.mems.length === 1 ? 'y' : 'ies'} · up to record ${v.lsn} · tiers are a column here, not separate storage` : 'the process is dead: nothing in RAM';
  // what the agent's recall can see: live memories outside the archive (recall searches short- and long-term by default)
  const seen = v.mems.filter((m) => m.status === 'live' && m.tier !== 'archive').length;
  $('#sees').textContent = v.ramUp ? `recall sees ${seen} of ${v.mems.length}` : '';
  $('#sees').classList.toggle('drop', !!S.prevView && v.ramUp && seen < S.prevView.mems.filter((m) => m.status === 'live' && m.tier !== 'archive').length);
  const lanes = $('#lanes');
  if (!lanes.children.length) TIERS.forEach((t) => { const l = h('div', 'lane ' + t); l.dataset.tier = t; const hd = h('h4'); hd.append(h('span', '', t), h('span', 'cnt')); l.append(hd, h('div', 'cs')); lanes.append(l); });
  const hot = new Set(v.hot), fresh = new Set(v.fresh), bad = new Set(v.bad);
  for (const l of lanes.children) {
    const mine = v.mems.filter((m) => m.tier === l.dataset.tier);
    l.querySelector('.cnt').textContent = mine.length || '';
    sync(l.querySelector('.cs'), mine, (m) => m.id, () => h('div', 'chip'), (el, m) => {
      el.textContent = short(m.label); el.title = `${m.label} · ${m.status} · ${m.tier}${m.status !== 'live' ? ' · hidden from recall' : m.tier === 'archive' ? ' · searched only when asked' : ' · recall returns it'}`;
      el.className = 'chip ' + m.status + (hot.has(m.id) ? ' hot' : '') + (fresh.has(m.id) ? ' fresh' : '') + (bad.has(m.id) ? ' bad' : '');
    });
  }
  const snap = $('#L-snapshot');
  snap.classList.toggle('has', !!v.snapshot);
  $('#snapSub').textContent = v.snapshot ? `the in-memory view as of record ${v.snapshot.lsn}` : 'none yet';
}

/* ---------- provenance graph ---------- */
const NW = 152, NH = 44, CG = 64, RG = 12;
function layoutGraph(mems) {
  const by = new Map(mems.map((m) => [m.id, m])), depth = new Map();
  const d = (m) => { if (depth.has(m.id)) return depth.get(m.id); depth.set(m.id, 0); const v = m.from.length ? 1 + Math.max(...m.from.map((p) => (by.has(p) ? d(by.get(p)) : -1))) : 0; depth.set(m.id, Math.max(0, v)); return Math.max(0, v); };
  mems.forEach(d);
  const cols = new Map();
  mems.forEach((m) => { const k = depth.get(m.id); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(m); });
  const pos = new Map(); let rows = 0, ncol = 0;
  [...cols.keys()].sort((a, b) => a - b).forEach((k) => {
    const list = cols.get(k);
    list.sort((a, b) => { const pa = a.from.length ? Math.min(...a.from.map((p) => (pos.has(p) ? pos.get(p).row : 1e9))) : 1e9, pb = b.from.length ? Math.min(...b.from.map((p) => (pos.has(p) ? pos.get(p).row : 1e9))) : 1e9; return pa - pb || a.lsn - b.lsn; });
    list.forEach((m, r) => pos.set(m.id, { col: k, row: r, x: k * (NW + CG), y: r * (NH + RG) }));
    rows = Math.max(rows, list.length); ncol = Math.max(ncol, k + 1);
  });
  return { pos, w: ncol * (NW + CG) - CG, h: rows * (NH + RG) - RG };
}
function drawGraph(v) {
  const g = $('#graph');
  if (!g.firstChild || !g.querySelector('.inner')) {
    g.replaceChildren();
    const inner = h('div', 'inner'); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'edges'); svg.id = 'edges';
    const nodesEl = h('div', 'nodes'); nodesEl.id = 'nodes'; inner.append(svg, nodesEl);
    const sizer = h('div', 'sizer'); sizer.append(inner); g.append(sizer, h('p', 'empty', 'No memories in RAM.'));
  }
  const inner = g.querySelector('.inner'), nodes = $('#nodes'), svg = $('#edges');
  g.querySelector('.empty').hidden = v.mems.length > 0;
  if (!v.mems.length) { sync(nodes, [], () => 0, () => 0, () => 0); svg.replaceChildren(); inner.style.height = '0'; const z = g.querySelector('.sizer'); z.style.width = z.style.height = '0'; return; }
  const L = layoutGraph(v.mems), hot = new Set(v.hot), fresh = new Set(v.fresh), bad = new Set(v.bad), by = new Map(v.mems.map((m) => [m.id, m]));
  inner.style.width = L.w + 'px'; inner.style.height = L.h + 'px';
  // shrink to fit, but not below 65%: on a phone a wider graph scrolls sideways instead of becoming unreadable
  const room = g.clientWidth - 28, k = L.w > room && room > 0 ? Math.max(0.65, room / L.w) : 1;
  inner.style.transform = k < 1 ? `scale(${k})` : '';
  const sizer = g.querySelector('.sizer'); sizer.style.width = Math.ceil(L.w * k) + 'px'; sizer.style.height = Math.ceil(L.h * k) + 'px';
  svg.setAttribute('width', L.w); svg.setAttribute('height', L.h);
  sync(nodes, v.mems, (m) => m.id, () => { const e = h('div', 'node'); e.append(h('b'), h('span')); return e; }, (el, m) => {
    const p = L.pos.get(m.id);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.className = 'node ' + m.status + (hot.has(m.id) ? ' hot' : '') + (fresh.has(m.id) ? ' fresh' : '') + (bad.has(m.id) ? ' bad' : '');
    el.firstChild.textContent = m.label; el.lastChild.textContent = `${m.status} · ${m.tier} · #${m.lsn}`;
    el.title = `${m.label}\nstatus ${m.status}, tier ${m.tier}, first written in record ${m.lsn}${m.from.length ? '\nderived from ' + m.from.map((id) => by.get(id).label).join(', ') : ''}`;
  });
  let html = '';
  for (const m of v.mems) for (const pid of m.from) {
    const a = L.pos.get(pid), b = L.pos.get(m.id); if (!a || !b) continue;
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(24, (x2 - x1) / 2);
    const cls = (m.status !== 'live' ? 'dead ' : '') + ((hot.has(m.id) || fresh.has(m.id)) && (hot.has(pid) || fresh.has(pid) || bad.has(pid)) ? 'hotedge' : '');
    html += `<g class="${cls}"><path class="e" d="M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}"/><path class="ah" d="M${x2} ${y2} l-8 -4.5 l0 9 z"/></g>`;
  }
  svg.innerHTML = html;
}

/* ---------- detail: time travel, compaction, retention, hash chain, LRU ---------- */
function drawDetail(v) {
  const pane = $('#detail'), body = $('#detailBody'); body.replaceChildren();
  const box = h('div', 'detail'); const parts = [];
  if (v.shadow) {
    const live = new Map(v.mems.map((m) => [m.id, m]));
    const sec = h('div'); sec.append(h('h4', '', `The state as of record ${v.shadow.until}, rebuilt by replaying the log${v.shadow.done ? '' : ' (so far: record ' + v.shadow.lsn + ')'}`));
    const grid = h('div', 'shadow');
    for (const m of v.shadow.mems) {
      const now = live.get(m.id), diff = v.shadow.done && (!now || now.status !== m.status || now.tier !== m.tier);
      const c = h('div', 'chip ' + m.status + (diff ? ' diff' : ''), `${m.label} · ${m.status} · ${m.tier}`);
      c.title = diff ? 'differs from now: rollback will write a record for it' : 'same as now';
      grid.append(c);
    }
    if (!v.shadow.mems.length) grid.append(h('p', 'empty', 'nothing yet'));
    sec.append(grid);
    if (v.shadow.done) sec.append(h('p', 'meta', 'Dashed outline: differs from the present, so rollback will write a compensating record for it.'));
    parts.push(['Time travel', sec]);
  }
  if (v.tape) {
    const t = v.tape, sec = h('div');
    sec.append(h('h4', '', t.after ? 'Before and after' : 'The log being folded'));
    const row = h('div', 'row'); let hz = false;
    t.before.forEach((r, i) => {
      if (!hz && r.zone === 'later') { row.append(h('div', 'hz')); hz = true; }
      const cls = [r.zone, r.keep === true ? 'kept' : r.keep === false && r.zone === 'fold' ? 'dropped' : '', r.gone && r.zone === 'fold' ? 'purged' : '', t.cur === r.lsn ? 'cursor' : '',
        t.folding && t.folding.put.includes(r.lsn) ? 'pickput' : '', t.folding && t.folding.status.includes(r.lsn) ? 'pickstatus' : '', t.folding && t.folding.move.includes(r.lsn) ? 'pickmove' : ''].filter(Boolean).join(' ');
      row.append(recCell(r, cls));
    });
    if (!hz) row.append(h('div', 'hz'));
    sec.append(row);
    if (t.folding) sec.append(h('p', 'meta', `put: ${t.folding.put.length} first puts · status: ${t.folding.status.length} latest status changes · move: ${t.folding.move.length} latest moves (underlined in green, amber and blue)`));
    if (t.before.some((r) => r.keep !== null)) sec.append(h('p', 'meta', `The vertical bar is the horizon, record ${t.horizon}. Green: kept. Struck through: folded away, because a later record says the same thing. Red: purged by retention, so it leaves no record at all.`));
    if (t.after) { sec.append(h('h4', '', `After: ${t.after.length} records, replayed to the same state`)); const r2 = h('div', 'row'); t.after.forEach((r) => r2.append(recCell(r))); sec.append(r2); }
    parts.push(['Compaction', sec]);
  }
  if (v.extra && v.extra.rows) {
    const sec = h('div'); sec.append(h('h4', '', v.extra.title));
    const tb = h('table'); tb.innerHTML = '<thead><tr><th>memory</th><th>tier</th><th>status</th><th>age</th><th>verdict</th></tr></thead>';
    const tbody = h('tbody');
    v.extra.rows.forEach((r) => { const tr = tbody.insertRow(); if (r.verdict === 'purge') tr.className = 'hit'; [r.label, r.tier, r.status, r.age, r.verdict].forEach((c, i) => { const td = tr.insertCell(); td.textContent = c; if (i === 4) td.className = 'v-' + c; }); });
    tb.append(tbody); sec.append(tb); sec.append(h('p', 'meta', 'ArchivedOlderThan(10, dead_only=True): archived, no longer live, and last written at least 10 ticks ago. Memories touched after the horizon are in use and are never purged.'));
    parts.push(['Retention', sec]);
  }
  if (v.extra && v.extra.chain) {
    const sec = h('div'); sec.append(h('h4', '', v.extra.title));
    const c = h('div', 'chain'); v.extra.chain.forEach((x, i) => { if (i) c.append(h('i', '', '→')); c.append(h('span', '', x)); });
    sec.append(c); parts.push(['Hash chain', sec]);
  }
  if (v.access) {
    const sec = h('div'); sec.append(h('h4', '', 'Short-term memory, with the access clock the policy reads'));
    const tb = h('table'); tb.innerHTML = '<thead><tr><th>memory</th><th>status</th><th>written</th><th>last used</th><th>uses</th></tr></thead>';
    const tbody = h('tbody'), bad = new Set(v.bad), hot = new Set(v.hot);
    v.access.forEach((r) => { const tr = tbody.insertRow(); if (bad.has(r.id)) tr.className = 'hit'; else if (hot.has(r.id)) tr.className = 'hot'; [r.label, r.status, r.written, r.last, r.count].forEach((c) => { tr.insertCell().textContent = c; }); });
    tb.append(tbody); sec.append(tb); sec.append(h('p', 'meta', 'The clock ticks on every write and every use. LRU evicts the smallest “last used”, after anything that no longer holds.'));
    parts.push(['Policy', sec]);
  }
  pane.hidden = !parts.length;
  if (!parts.length) return;
  $('#detailTitle').textContent = parts.map((p) => p[0]).join(' · ');
  $('#detailMeta').textContent = '';
  parts.forEach((p) => box.append(p[1]));
  body.append(box);
}

/* ---------- wiring ---------- */
$('#first').onclick = () => { stop(); go(0); };
$('#prev').onclick = () => { stop(); go(S.i - 1); };
$('#next').onclick = () => { stop(); go(S.i + 1); };
$('#over').onclick = () => { stop(); go(over()); };
$('#last').onclick = () => { stop(); go(S.steps.length - 1); };
$('#play').onclick = play;
$('#scrub').oninput = (e) => { stop(); go(+e.target.value); };
addEventListener('keydown', (e) => {
  const el = e.target instanceof Element ? e.target : null; // the document itself can be the target
  if ((el && el.matches('select, input[type="text"]')) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); stop(); go(e.shiftKey ? over() : S.i + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); go(S.i - 1); }
  else if (e.key === 'Home') { e.preventDefault(); stop(); go(0); }
  else if (e.key === 'End') { e.preventDefault(); stop(); go(S.steps.length - 1); }
  else if (e.key === ' ' && !(el && el.matches('button'))) { e.preventDefault(); play(); }
});
const [hs, hv, hn] = location.hash.slice(1).split('/');
select(hs, hv, hn ? +hn - 1 : 0);
window.__viz = S;

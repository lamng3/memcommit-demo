// The MemCommit playground: an append-only memory log you write to, in the browser.
// A port of the library's core (content-addressed memories, restore on rewrite, cascading invalidation, rollback by
// compensating records, as_of). The page's tests replay scenarios recorded from the Python library and compare every
// id and log record. Not ported: query references, guards, tiers beyond "short", and the other tiers' policies.
var ML = (function () {
  // ---- SHA-256 (synchronous, so ids can be computed as the library computes them) ----
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function utf8(str) { return new TextEncoder().encode(str); }
  function sha256hex(str) {
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
  function canonical(v) {
    if (v === null || v === undefined) return "null";
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canonical(v[k]); }).join(",") + "}";
    return JSON.stringify(v);
  }
  var OPS = { put: "live", restore: "live", stale: "stale", retract: "retracted", move: null };
  var SYSTEM = "memcommit";
  function memory(agent, kind, key, body, derived) {
    var d = Array.from(new Set(derived || [])).sort(), m = { kind: kind, key: key, body: body, source: agent, scope: "shared", derived_from: d, importance: 0 };
    m.id = "m:" + sha256hex(canonical([kind, key, body, agent, "shared", d])).slice(0, 16);
    return m;
  }
  function newState() { return { memories: new Map(), status: new Map(), tier: new Map(), first: new Map(), last: new Map(), children: new Map(), lsn: 0 }; }
  function apply(state, r) {
    var m = r.memory;
    if (!state.memories.has(m.id)) {
      state.memories.set(m.id, m); state.first.set(m.id, r); state.tier.set(m.id, r.tier || "short");
      m.derived_from.forEach(function (ref) { if (!state.children.has(ref)) state.children.set(ref, new Set()); state.children.get(ref).add(m.id); });
    }
    if (r.op === "move") state.tier.set(m.id, r.tier); else state.status.set(m.id, OPS[r.op]);
    state.last.set(m.id, r); state.lsn = r.lsn;
  }
  function replay(records, until) { var s = newState(); records.forEach(function (r) { if (until === undefined || r.lsn <= until) apply(s, r); }); return s; }
  function descendants(state, refs) {
    var found = new Set(), frontier = refs.slice();
    while (frontier.length) { (state.children.get(frontier.pop()) || new Set()).forEach(function (c) { if (!found.has(c)) { found.add(c); frontier.push(c); } }); }
    return found;
  }
  function Store() { this.records = []; this.state = newState(); this.txn = 0; }
  // ops: [op, memory, reason, tier], committed as one transaction, as MemoryStore._commit does
  Store.prototype.transaction = function (agent, ops) {
    var out = [], lsn = this.state.lsn, statuses = new Map(), tiers = new Map(), self = this;
    ops.forEach(function (o) {
      var op = o[0], mem = o[1], reason = o[2], tier = o[3], current = statuses.has(mem.id) ? statuses.get(mem.id) : self.state.status.get(mem.id);
      if (op === "move") { if ((tiers.has(mem.id) ? tiers.get(mem.id) : self.state.tier.get(mem.id)) === tier) return; tiers.set(mem.id, tier); }
      else {
        if (op === "put" && current !== undefined) { op = "restore"; tier = ""; }
        if (OPS[op] === current) return;
        statuses.set(mem.id, OPS[op]); if (op === "put") tiers.set(mem.id, tier);
      }
      lsn++; out.push({ lsn: lsn, txn: self.txn + 1, op: op, memory: mem, agent: agent, reason: reason, tier: tier });
    });
    // A live memory retracted withdraws itself as a premise: everything live built on it goes stale in the same transaction.
    var written = new Set(out.map(function (r) { return r.memory.id; }));
    out.slice().forEach(function (r) {
      if (r.op !== "retract" || self.state.status.get(r.memory.id) !== "live") return;
      var deps = Array.from(descendants(self.state, [r.memory.id])).filter(function (m) { return self.state.status.get(m) === "live"; }).sort(function (a, b) { return self.state.last.get(a).lsn - self.state.last.get(b).lsn; });
      deps.forEach(function (id) {
        if (written.has(id) || (statuses.has(id) ? statuses.get(id) : "live") !== "live") return;
        lsn++; out.push({ lsn: lsn, txn: self.txn + 1, op: "stale", memory: self.state.memories.get(id), agent: agent, reason: r.memory.kind + " '" + r.memory.key + "', which this was built on, was retracted", tier: "" });
        statuses.set(id, "stale");
      });
    });
    if (!out.length) return [];
    this.txn++; out.forEach(function (r) { apply(self.state, r); self.records.push(r); });
    return out;
  };
  Store.prototype.status = function (id) { return this.state.status.get(id); };
  Store.prototype.put = function (agent, kind, key, text, derived) { var m = memory(agent, kind, key, { text: text }, derived); this.transaction(agent, [["put", m, "", "short"]]); return m; };
  Store.prototype.retract = function (agent, id, reason) { return this.transaction(agent, [["retract", this.state.memories.get(id), reason || "", ""]]); };
  Store.prototype.invalidate = function (refs, reason, agent) {
    var s = this.state, targets = refs.filter(function (r) { return s.status.get(r) === "live"; });
    var deps = Array.from(descendants(s, refs)).filter(function (m) { return s.status.get(m) === "live"; }).sort(function (a, b) { return s.last.get(a).lsn - s.last.get(b).lsn; });
    deps.forEach(function (m) { if (targets.indexOf(m) < 0) targets.push(m); });
    var self = this;
    return this.transaction(agent || SYSTEM, targets.map(function (id) { return ["stale", self.state.memories.get(id), reason, ""]; }));
  };
  Store.prototype.rollbackTo = function (lsn, reason, agent) {
    if (lsn >= this.state.lsn) return [];
    var target = replay(this.records, lsn), ops = [], s = this.state;
    s.status.forEach(function (status, id) {
      var wanted = target.status.has(id) ? target.status.get(id) : "retracted", mem = s.memories.get(id);
      if (wanted !== status) ops.push([wanted === "live" ? "restore" : wanted === "stale" ? "stale" : "retract", mem, reason, ""]);
      var tier = target.tier.get(id); if (tier !== undefined && tier !== s.tier.get(id)) ops.push(["move", mem, reason, tier]);
    });
    return this.transaction(agent || SYSTEM, ops);
  };
  Store.prototype.asOf = function (lsn) { return replay(this.records, lsn); };
  // Run one recorded operation (the page's storage format and the tests' scenarios)
  Store.prototype.run = function (o) {
    if (o.op === "put") return this.put(o.agent, o.kind, o.key, o.text, o.derived);
    if (o.op === "retract") return this.retract(o.agent, o.id, o.reason);
    if (o.op === "invalidate") return this.invalidate(o.refs, o.reason);
    if (o.op === "rollback") return this.rollbackTo(o.lsn, o.reason);
  };
  return { Store: Store, memory: memory, sha256hex: sha256hex, canonical: canonical, replay: replay, descendants: descendants };
})();

(function () {
  var root = document.getElementById("mplay");
  if (!root) return;
  var h = PG.h, STORAGE = "memcommit-playground", ops = [], store = null, viewLsn = 0;
  var DEMO = [
    { op: "put", agent: "assistant", kind: "episode", key: "alice/1", text: "I live in Lyon and my dog is Rex.", derived: [] },
    { op: "put", agent: "assistant", kind: "knowledge", key: "user/alice/city", text: "Alice lives in Lyon.", derived: ["#0"] },
    { op: "put", agent: "assistant", kind: "knowledge", key: "user/alice/dog", text: "Alice's dog is named Rex.", derived: ["#0"] },
    { op: "put", agent: "assistant", kind: "plan", key: "alice/trip", text: "Book a train from Lyon.", derived: ["#1"] },
    { op: "put", agent: "assistant", kind: "answer", key: "alice/msg", text: "Your train from Lyon is booked.", derived: ["#3"] },
    { op: "put", agent: "assistant", kind: "episode", key: "mallory/1", text: "I live in Atlantis.", derived: [] },
  ];
  function persist() { try { localStorage.setItem(STORAGE, JSON.stringify(ops)); } catch (e) { /* storage may be off */ } }
  function rebuild() { store = new ML.Store(); ops.forEach(function (o) { store.run(o); }); viewLsn = store.state.lsn; }
  function load() { try { ops = JSON.parse(localStorage.getItem(STORAGE) || "null") || []; } catch (e) { ops = []; } rebuild(); }
  function commit(o) { var before = store.state.lsn; store.run(o); if (store.state.lsn !== before) ops.push(o); viewLsn = store.state.lsn; persist(); render(); return store.state.lsn !== before; }
  function demo() { ops = []; var made = []; DEMO.forEach(function (o) { var c = Object.assign({}, o); c.derived = (o.derived || []).map(function (d) { return /^#\d+$/.test(d) ? made[+d.slice(1)] : d; }); var s2 = new ML.Store(); ops.forEach(function (x) { s2.run(x); }); var m = s2.run(c); made.push(m.id); ops.push(c); }); rebuild(); persist(); render(); }

  var agent = h("select", { id: "mp-agent", "aria-label": "Agent" }, ["assistant", "researcher", "you"].map(function (a) { return h("option", { value: a, text: a }); }));
  var kind = h("select", { id: "mp-kind", "aria-label": "Kind" }, ["fact", "knowledge", "episode", "plan", "answer"].map(function (a) { return h("option", { value: a, text: a }); }));
  var key = h("input", { type: "text", id: "mp-key", placeholder: "key, e.g. user/alice/city", value: "alice/city", autocomplete: "off", "aria-label": "Key" });
  var text = h("input", { type: "text", id: "mp-text", class: "grow", placeholder: "what the memory says", value: "Alice lives in Lyon.", autocomplete: "off", "aria-label": "Text" });
  var derivedBox = h("div", { class: "mp-derived", id: "mp-derived" });
  var note = h("p", { class: "pg-note", id: "mp-note" });
  var list = h("div", { class: "mp-list", id: "mp-list" }), logBox = h("div", { id: "mp-log" });
  var slider = h("input", { type: "range", id: "mp-lsn", min: 0, max: 0, value: 0, "aria-label": "Log position" }), sliderOut = h("output", { for: "mp-lsn", id: "mp-lsn-out" });
  slider.addEventListener("input", function () { viewLsn = +slider.value; render(); });

  function label(m) { return m.kind + " · " + m.key; }
  function write() {
    var picked = Array.from(derivedBox.querySelectorAll("input:checked")).map(function (i) { return i.value; });
    var o = { op: "put", agent: agent.value, kind: kind.value, key: key.value.trim(), text: text.value, derived: picked };
    if (!o.key) { note.textContent = "A memory needs a key."; return; }
    var before = store.state.lsn, id = ML.memory(o.agent, o.kind, o.key, { text: o.text }, picked).id, status = store.status(id);
    var changed = commit(o);
    note.textContent = changed ? (status === undefined ? "Written as " + id + "." : "Rewrote a " + status + " memory with the same content, so it was restored: " + id + ".") : "Nothing changed: a live memory with exactly this content already exists (" + id + ").";
  }
  function act(o) { commit(o); note.textContent = ""; }

  function render() {
    var s = store.state, past = viewLsn < s.lsn, view = store.asOf(viewLsn);
    slider.max = s.lsn; slider.value = viewLsn; sliderOut.textContent = "lsn " + viewLsn + " of " + s.lsn;
    // derived-from choices: live memories now
    derivedBox.replaceChildren.apply(derivedBox, [h("span", { class: "pg-status", text: "Derived from:" })].concat(Array.from(s.memories.keys()).filter(function (id) { return s.status.get(id) === "live"; }).map(function (id) {
      var m = s.memories.get(id); return h("label", { class: "mp-pick" }, h("input", { type: "checkbox", value: id }), label(m)); })));
    if (!s.memories.size) derivedBox.append(h("span", { class: "pg-status", text: "none yet" }));
    var cards = Array.from(view.memories.keys()).filter(function (id) { return view.status.has(id); }).map(function (id) {
      var m = view.memories.get(id), st = view.status.get(id), from = m.derived_from.map(function (d) { var x = view.memories.get(d); return x ? label(x) : d; });
      return h("div", { class: "mp-card " + st }, h("div", { class: "mp-top" }, h("span", { class: "mp-key", text: label(m) }), h("span", { class: "chip " + st, text: st })),
        h("div", { text: m.body.text }), from.length ? h("div", { class: "mp-from", text: "derived from " + from.join(", ") }) : null,
        h("div", { class: "mp-meta" }, h("span", { text: m.source }), h("span", { text: id }),
          h("span", { class: "mp-acts" }, h("button", { type: "button", class: "btn", title: "It was wrong: withdraw it, and everything live built on it goes stale", disabled: past || st === "retracted", onclick: function () { act({ op: "retract", agent: agent.value, id: id, reason: "wrong" }); } }, "Retract (wrong)"),
            h("button", { type: "button", class: "btn", title: "It is outdated: mark it and everything built on it stale", disabled: past || st !== "live", onclick: function () { act({ op: "invalidate", refs: [id], reason: "premise changed" }); } }, "Mark stale (outdated)"))));
    });
    list.replaceChildren.apply(list, cards.length ? cards : [h("p", { class: "pg-note", text: "The log is empty. Write a memory, or load the demo." })]);
    var recs = store.records.filter(function (r) { return r.lsn <= viewLsn; });
    logBox.replaceChildren(h("div", { class: "pg-scroll" }, h("table", { class: "pg-table" }, h("thead", {}, h("tr", {}, ["lsn", "txn", "op", "memory", "agent", "reason"].map(function (t) { return h("th", { scope: "col", text: t }); }))),
      h("tbody", {}, recs.slice().reverse().map(function (r) { return h("tr", { class: r.lsn === viewLsn ? "now" : "" }, [r.lsn, r.txn, r.op, label(r.memory), r.agent, r.reason].map(function (c) { return h("td", { text: String(c) }); })); })))));
    rollback.disabled = !past; rollback.textContent = past ? "Roll back to lsn " + viewLsn : "Roll back";
  }
  var rollback = h("button", { type: "button", class: "btn", id: "mp-rollback", onclick: function () { act({ op: "rollback", lsn: viewLsn, reason: "rollback to lsn " + viewLsn }); } }, "Roll back");
  function exportLog() {
    var json = JSON.stringify(store.records.map(function (r) { return { lsn: r.lsn, txn: r.txn, op: r.op, id: r.memory.id, kind: r.memory.kind, key: r.memory.key, body: r.memory.body, agent: r.agent, reason: r.reason, derived_from: r.memory.derived_from }; }), null, 2);
    var a = h("a", { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: "memcommit-log.json" }); a.click();
  }

  root.className = "pg";
  root.replaceChildren(
    h("div", { class: "pg-panel" }, h("h3", { text: "1. Write a memory" }), h("p", { class: "pg-sub", text: "Each write is a transaction in an append-only log. Pick what it was derived from, and later retract a premise (it was wrong) or mark it stale (it is outdated) to watch what was built on it go stale." }),
      h("div", { class: "pg-row" }, agent, kind, key), h("div", { class: "pg-row" }, text), derivedBox,
      h("div", { class: "pg-row" }, h("button", { type: "button", class: "btn solid", id: "mp-write", onclick: write }, "Write"), h("button", { type: "button", class: "btn", id: "mp-demo", onclick: demo }, "Load the demo"),
        h("button", { type: "button", class: "btn", id: "mp-clear", onclick: function () { ops = []; rebuild(); persist(); render(); note.textContent = ""; } }, "Clear the log"), h("button", { type: "button", class: "btn", id: "mp-export", onclick: exportLog }, "Export the log")), note),
    h("div", { class: "pg-panel" }, h("h3", { text: "2. Time travel" }), h("p", { class: "pg-sub", text: "Drag to see the state as of any log position. Past states are read only; roll back to write the compensating records that return to one." }),
      h("div", { class: "pg-row" }, h("span", { class: "pg-status", text: "position" }), slider, sliderOut, rollback)),
    h("div", { class: "pg-panel" }, h("h3", { text: "3. Memories" }), list),
    h("div", { class: "pg-panel" }, h("h3", { text: "4. The log" }), logBox));
  load(); if (!ops.length) demo(); else render();
  window.__ml = { ML: ML };
})();

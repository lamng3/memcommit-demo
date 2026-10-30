// The configuration explorer: knobs on the left, what the library did with them on the right.
// Data: configs-data.json, written by configs_data.py from the real library. Nothing is computed here but lookups.
(function () {
  var root = document.getElementById("cfg");
  if (!root) return;

  var CSS = [
    ".cfg-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 16px; }",
    ".cfg-tabs button, .cfg-seg button { border: 1px solid var(--border); background: transparent; color: var(--fg); border-radius: 999px; padding: 4px 14px; font: inherit; font-size: 14px; cursor: pointer; }",
    ".cfg-tabs button[aria-pressed=true], .cfg-seg button[aria-pressed=true] { border-color: var(--primary); background: var(--primary-10); color: var(--primary); font-weight: 500; }",
    ".cfg-seg button:disabled { opacity: .35; cursor: default; }",
    ".cfg-grid { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 20px; align-items: start; }",
    "@media (max-width: 860px) { .cfg-grid { grid-template-columns: 1fr; } }",
    ".cfg-knobs { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; display: grid; gap: 12px; }",
    ".cfg-knob .lab { font-size: 13px; color: var(--muted); margin-bottom: 4px; display: flex; justify-content: space-between; gap: 8px; }",
    ".cfg-knob .lab code { font-size: 12px; }",
    ".cfg-seg { display: flex; flex-wrap: wrap; gap: 5px; }",
    ".cfg-seg button { padding: 2px 11px; font-size: 13px; }",
    ".cfg-out { display: grid; gap: 14px; min-width: 0; }",
    ".cfg-big { display: flex; flex-wrap: wrap; gap: 10px 28px; align-items: baseline; }",
    ".cfg-big .v { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; color: var(--primary); font-variant-numeric: tabular-nums; }",
    ".cfg-big .k { font-size: 13px; color: var(--muted); }",
    ".cfg-bars { display: grid; gap: 5px; }",
    ".cfg-bar { display: grid; grid-template-columns: 150px 1fr 56px; gap: 8px; align-items: center; font-size: 13.5px; }",
    ".cfg-bar .t { height: 14px; border-radius: 4px; background: var(--border); position: relative; overflow: hidden; }",
    ".cfg-bar .t i { position: absolute; inset: 0 auto 0 0; background: var(--faint); border-radius: 4px; }",
    ".cfg-bar.me .t i { background: var(--primary); }",
    ".cfg-bar.me { font-weight: 600; }",
    ".cfg-bar .n { text-align: right; font-variant-numeric: tabular-nums; }",
    ".cfg-card { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; min-width: 0; }",
    ".cfg-card h4 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }",
    ".cfg-card ul { margin: 0; padding-left: 18px; font-size: 13.5px; }",
    ".cfg-card pre { margin: 0; font-family: var(--mono); font-size: 12.5px; white-space: pre-wrap; overflow-wrap: anywhere; }",
    ".cfg-note { font-size: 13px; color: var(--muted); margin: 0; }",
    ".cfg-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }",
    ".cfg-svg { width: 100%; height: auto; display: block; }",
    ".cfg-svg text { fill: var(--muted); font-size: 11px; font-family: var(--font); }",
  ].join("\n");
  var style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  function el(tag, attrs) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      (Array.isArray(kid) ? kid : [kid]).forEach(function (c) { n.append(c.nodeType ? c : document.createTextNode(c)); });
    }
    return n;
  }
  function f3(v) { return v.toFixed(3); }
  function same(a, b) { return String(a) === String(b); }

  // A segmented control. options: [[value, label]]; enabled(value) may grey some out.
  function seg(label, hint, options, value, onPick, enabled) {
    var box = el("div", { class: "cfg-seg", role: "group", "aria-label": label });
    options.forEach(function (o) {
      var b = el("button", { type: "button", "aria-pressed": same(o[0], value) ? "true" : "false", text: o[1] });
      if (enabled && !enabled(o[0])) b.disabled = true;
      b.onclick = function () { onPick(o[0]); };
      box.append(b);
    });
    return el("div", { class: "cfg-knob" }, el("div", { class: "lab" }, el("span", { text: label }), hint ? el("code", { text: hint }) : null), box);
  }
  function bars(rows, mine, fmt) {
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; })) || 1;
    return el("div", { class: "cfg-bars" }, rows.map(function (r) {
      var i = el("i");
      i.style.width = (100 * r[1] / max) + "%";
      return el("div", { class: "cfg-bar" + (r[0] === mine ? " me" : "") }, el("span", { text: r[0] }), el("span", { class: "t" }, i), el("span", { class: "n", text: (fmt || f3)(r[1]) }));
    }));
  }
  function card(title, body) { return el("div", { class: "cfg-card" }, el("h4", { text: title }), body); }
  function list(items, empty) { return items.length ? el("ul", null, items.map(function (t) { return el("li", { text: t }); })) : el("p", { class: "cfg-note", text: empty || "none" }); }
  function code(text) { return card("The configuration, in code", el("pre", { text: text })); }

  var data, tab = "eviction";
  var state = {
    eviction: { workload: "conversation", capacity: 64, policy: "Semantic", base: 20, growth: 1.5, shape: "power", dependents: 0.5, rebuildable: 0.5, expiry: true, kinds: false },
    forgetting: { shape: "exponential", base: 7, growth: 200 },
    dreaming: { conflicts: "history", duplicate: 0.85 },
    ontology: { on_conflict: "record", links: true, analogies: true },
  };

  function set(panel, key, value) { state[panel][key] = value; render(); }

  // Eviction -----------------------------------------------------------------
  function evRow(s, policy) {
    return data.eviction.rows.find(function (r) {
      if (r.workload !== s.workload || r.capacity !== s.capacity || r.policy !== policy) return false;
      if (policy !== "Spaced" && policy !== "Semantic") return true;
      if (r.base !== s.base || r.growth !== s.growth || r.shape !== s.shape) return false;
      return policy === "Spaced" || (r.dependents === s.dependents && r.rebuildable === s.rebuildable && r.expiry === s.expiry && r.kinds === s.kinds);
    });
  }
  function evBest(s) {
    var rows = data.eviction.rows.filter(function (r) { return r.workload === s.workload && r.capacity === s.capacity; });
    return rows.reduce(function (a, b) { return b.hit > a.hit ? b : a; });
  }
  function evCode(s) {
    var p = s.policy;
    if (p !== "Spaced" && p !== "Semantic") return "TieredMemory(store, capacity=" + s.capacity + ", eviction=" + p + "())";
    var ret = "Retention(base=" + s.base + ", growth=" + s.growth + ', shape="' + s.shape + '"' + (p === "Semantic" && s.kinds ? ",\n                    by_kind={...})" : ")");
    if (p === "Spaced") return "TieredMemory(store, capacity=" + s.capacity + ",\n             eviction=Spaced(" + ret + "))";
    return "TieredMemory(store, capacity=" + s.capacity + ", eviction=Semantic(\n    " + ret + ",\n    dependents=" + s.dependents + ", rebuildable=" + s.rebuildable +
      (s.expiry ? "" : ",\n    expires=lambda m: None") + "))";
  }
  function eviction() {
    var s = state.eviction, P = "eviction", tuned = s.policy === "Spaced" || s.policy === "Semantic", sem = s.policy === "Semantic";
    var knobs = el("div", { class: "cfg-knobs" },
      seg("Workload", null, [["agent", "agent traces"], ["conversation", "conversation"]], s.workload, function (v) { set(P, "workload", v); }),
      seg("Capacity", "capacity", [[32, "32"], [64, "64"], [128, "128"]], s.capacity, function (v) { set(P, "capacity", v); }),
      seg("Policy", "eviction", ["FIFO", "LRU", "LFU", "ARC", "Forgetting", "Spaced", "Semantic"].map(function (p) { return [p, p]; }), s.policy, function (v) { set(P, "policy", v); }),
      seg("Initial stability", "base", [[5, "5"], [20, "20"], [50, "50"]], s.base, function (v) { set(P, "base", v); }, function () { return tuned; }),
      seg("Spacing growth", "growth", [[0, "0"], [1.5, "1.5"], [5, "5"]], s.growth, function (v) { set(P, "growth", v); }, function () { return tuned; }),
      seg("Curve shape", "shape", [["power", "power"], ["exponential", "exponential"]], s.shape, function (v) { set(P, "shape", v); }, function () { return tuned; }),
      seg("Weight of dependents", "dependents", [[0, "0"], [0.5, "0.5"], [1, "1"]], s.dependents, function (v) { set(P, "dependents", v); }, function () { return sem; }),
      seg("Value if rebuildable", "rebuildable", [[0.25, "0.25"], [0.5, "0.5"], [1, "1"]], s.rebuildable, function (v) { set(P, "rebuildable", v); }, function () { return sem; }),
      seg("Expiry", "expires_at", [[true, "on"], [false, "off"]], s.expiry, function (v) { set(P, "expiry", v); }, function () { return sem; }),
      seg("Stability by kind", "by_kind", [[false, "off"], [true, "on"]], s.kinds, function (v) { set(P, "kinds", v); }, function () { return sem; })
    );
    var me = evRow(s, s.policy), best = evBest(s);
    var others = ["FIFO", "LRU", "LFU", "ARC", "Forgetting", "Spaced", "Semantic"].map(function (p) {
      var r = evRow(s, p);
      return [p === s.policy ? p + " (yours)" : p + (p === "Spaced" || p === "Semantic" ? " (same knobs)" : ""), r ? r.hit : 0];
    });
    var bestDesc = best.policy + (best.base != null ? " base " + best.base + ", growth " + best.growth + ", " + best.shape : "") +
      (best.dependents != null ? ", dependents " + best.dependents + ", rebuildable " + best.rebuildable + ", expiry " + (best.expiry ? "on" : "off") + ", by kind " + (best.kinds ? "on" : "off") : "");
    var out = el("div", { class: "cfg-out" },
      el("div", { class: "cfg-big" },
        el("div", null, el("div", { class: "v", text: me ? f3(me.hit) : "–" }), el("div", { class: "k", text: "hit rate" })),
        el("div", null, el("div", { class: "v", text: me ? me.records.toLocaleString() : "–" }), el("div", { class: "k", text: "log records" })),
        el("div", null, el("div", { class: "v", text: f3(best.hit) }), el("div", { class: "k", text: "best on this grid" }))),
      card("Every policy at this workload and capacity", bars(others, s.policy + " (yours)")),
      el("p", { class: "cfg-note", text: "Best on the grid here: " + bestDesc + ". " + data.eviction.workloads[s.workload] + " events in the " + s.workload + " workload." }),
      code(evCode(s)));
    return el("div", { class: "cfg-grid" }, knobs, out);
  }

  // Forgetting ---------------------------------------------------------------
  function curve(t, S, shape) {
    if (t <= 0) return 1;
    return shape === "exponential" ? Math.pow(0.9, t / S) : Math.pow(1 + (19 / 81) * t / S, -0.5);
  }
  function needChart(fg) {
    var W = 520, H = 200, L = 40, B = 26, pts = fg.need, maxT = pts[pts.length - 1][0], maxY = Math.max.apply(null, pts.map(function (p) { return p[1]; })) * 1.15;
    function x(t) { return L + (W - L - 10) * Math.log(1 + t) / Math.log(1 + maxT); }
    function y(v) { return H - B - (H - B - 10) * v / maxY; }
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", "cfg-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Need against idle days, with power and exponential fits");
    function add(tag, a, text) { var n = document.createElementNS(ns, tag); for (var k in a) n.setAttribute(k, a[k]); if (text) n.textContent = text; svg.append(n); return n; }
    add("line", { x1: L, y1: H - B, x2: W - 10, y2: H - B, stroke: "currentColor", "stroke-opacity": 0.25 });
    [0.5, 2, 7, 30, 120].forEach(function (t) { add("text", { x: x(t), y: H - 8, "text-anchor": "middle" }, t + "d"); });
    [0, 0.05, 0.1].forEach(function (v) { add("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, v.toFixed(2)); });
    [["power", "stroke: var(--primary)"], ["exponential", "stroke: var(--warn)"]].forEach(function (c) {
      var f = fg.fits[c[0]], d = "";
      for (var i = 0; i <= 60; i++) { var t = Math.exp(Math.log(1 + maxT) * i / 60) - 1; d += (i ? "L" : "M") + x(t).toFixed(1) + " " + y(f.scale * curve(t, f.stability, c[0])).toFixed(1); }
      add("path", { d: d, fill: "none", style: c[1], "stroke-width": 2 });
    });
    pts.forEach(function (p) { add("circle", { cx: x(p[0]), cy: y(p[1]), r: 3.5, fill: "currentColor", "fill-opacity": 0.7 }); });
    return svg;
  }
  function forgetting() {
    var fg = data.forgetting, s = state.forgetting, P = "forgetting";
    if (!fg) return el("p", { class: "cfg-note", text: "The LoCoMo data was not available when this page was built." });
    var knobs = el("div", { class: "cfg-knobs" },
      seg("Curve shape", "shape", [["power", "power"], ["exponential", "exponential"]], s.shape, function (v) { set(P, "shape", v); }),
      seg("Initial stability (days)", "base", [[1, "1"], [2, "2"], [4, "4"], [7, "7"], [14, "14"], [30, "30"]], s.base, function (v) { set(P, "base", v); }),
      seg("Spacing growth", "growth", [[0, "0"], [1.5, "1.5"], [5, "5"], [20, "20"], [200, "200"]], s.growth, function (v) { set(P, "growth", v); }));
    var me = fg.rows.find(function (r) { return r.shape === s.shape && r.base === s.base && r.growth === s.growth; });
    var best = fg.rows.reduce(function (a, b) { return b.auc > a.auc ? b : a; });
    var cmp = [["Retention (yours)", me.auc]].concat(Object.keys(fg.baselines).map(function (k) { return [k, fg.baselines[k]]; }))
      .concat([["best Retention on grid", best.auc]]);
    var fits = fg.fits;
    var out = el("div", { class: "cfg-out" },
      el("div", { class: "cfg-big" },
        el("div", null, el("div", { class: "v", text: f3(me.auc) }), el("div", { class: "k", text: "AUC, next-session reuse" })),
        el("div", null, el("div", { class: "v", text: f3(best.auc) }), el("div", { class: "k", text: "best: " + best.shape + ", base " + best.base + ", growth " + best.growth }))),
      card("Against recency and frequency", bars(cmp, "Retention (yours)")),
      card("Need: of the items idle t days, the share used again within 7 days",
        el("div", null, needChart(fg), el("p", { class: "cfg-note", text: "Dots: LoCoMo, 10 conversations. Green: power fit (S " + fits.power.stability.toFixed(1) + " d, RMSE " + fits.power.rmse.toFixed(4) +
          "). Amber: exponential fit (S " + fits.exponential.stability.toFixed(1) + " d, RMSE " + fits.exponential.rmse.toFixed(4) + "). Log-scaled time." }))),
      code("Retention(base=" + s.base + ", growth=" + s.growth + ', shape="' + s.shape + '", importance=0.0)'));
    return el("div", { class: "cfg-grid" }, knobs, out);
  }

  // Dreaming -----------------------------------------------------------------
  function dreaming() {
    var d = data.dreaming, s = state.dreaming, P = "dreaming";
    var knobs = el("div", { class: "cfg-knobs" },
      seg("Conflicting statements", "conflicts", [["supersede", "supersede"], ["history", "keep history"]], s.conflicts, function (v) { set(P, "conflicts", v); }),
      seg("Duplicate threshold", "duplicate", [[0.5, "0.5"], [0.85, "0.85"], [1.01, "off"]], s.duplicate, function (v) { set(P, "duplicate", v); }),
      card("The script", el("ul", null, d.script.map(function (x) { return el("li", { text: x[1] + ": " + x[2].join(" ") }); }))));
    var r = d.rows.find(function (x) { return x.conflicts === s.conflicts && x.duplicate === s.duplicate; });
    var out = el("div", { class: "cfg-out" },
      el("div", { class: "cfg-big" },
        el("div", null, el("div", { class: "v", text: String(r.notes.length) }), el("div", { class: "k", text: "live notes" })),
        el("div", null, el("div", { class: "v", text: String(r.records) }), el("div", { class: "k", text: "log records" }))),
      el("div", { class: "cfg-cols" },
        card("Notes left", list(r.notes.map(function (n) { return n.path + ": " + n.text.replace(/\n/g, " / "); }))),
        card("What the passes did", list(r.changes))),
      code('Dreamer(store, heuristic_extractor, conflicts="' + s.conflicts + '", duplicate=' + s.duplicate + ")\n# or ModelExtractor(model) and similar=embedding_similarity(embed)"));
    return el("div", { class: "cfg-grid" }, knobs, out);
  }

  // Ontology -----------------------------------------------------------------
  function ontology() {
    var o = data.ontology, s = state.ontology, P = "ontology";
    var knobs = el("div", { class: "cfg-knobs" },
      seg("Conflicts", "on_conflict", [["record", "record"], ["supersede", "supersede"]], s.on_conflict, function (v) { set(P, "on_conflict", v); }),
      seg("Links", "links", [[true, "on"], [false, "off"]], s.links, function (v) { set(P, "links", v); }),
      seg("Analogies", "analogies", [[true, "on"], [false, "off"]], s.analogies, function (v) { set(P, "analogies", v); }),
      card("Stated facts", list(o.facts.map(function (f) { return f.join(" "); }))));
    var r = o.rows.find(function (x) { return x.on_conflict === s.on_conflict && x.links === s.links && x.analogies === s.analogies; });
    var out = el("div", { class: "cfg-out" },
      el("div", { class: "cfg-big" },
        el("div", null, el("div", { class: "v", text: String(r.inferred.length) }), el("div", { class: "k", text: "inferred facts" })),
        el("div", null, el("div", { class: "v", text: String(r.conflicts.length + r.superseded) }), el("div", { class: "k", text: s.on_conflict === "record" ? "conflicts recorded" : "facts superseded" })),
        el("div", null, el("div", { class: "v", text: String(r.link_list.length + r.analogy_list.length) }), el("div", { class: "k", text: "links and analogies" }))),
      el("div", { class: "cfg-cols" },
        card("Inferred, each derived from its premises and rule", list(r.inferred)),
        card("Mind map of alice  (* inferred)", el("pre", { text: r.map }))),
      el("div", { class: "cfg-cols" },
        card("Conflicts", list(r.conflicts, s.on_conflict === "supersede" ? "the newer lives_in superseded the older" : "none")),
        card("Links", list(r.link_list, s.links ? "none" : "off")),
        card("Analogies", list(r.analogy_list, s.analogies ? "none" : "off"))),
      code('Ontology(classes={...}, properties=[Property("lives_in", functional=True), ...],\n         rules=[...], on_conflict="' + s.on_conflict + '", links=' + (s.links ? "True" : "False") + ", analogies=" + (s.analogies ? "True" : "False") + ")"));
    return el("div", { class: "cfg-grid" }, knobs, out);
  }

  var TABS = [["eviction", "Eviction"], ["forgetting", "Forgetting curve"], ["dreaming", "Dreaming"], ["ontology", "Ontology"]];
  var VIEWS = { eviction: eviction, forgetting: forgetting, dreaming: dreaming, ontology: ontology };

  function render() {
    var tabs = el("div", { class: "cfg-tabs", role: "group", "aria-label": "Panels" }, TABS.map(function (t) {
      var b = el("button", { type: "button", "aria-pressed": t[0] === tab ? "true" : "false", text: t[1] });
      b.onclick = function () { tab = t[0]; render(); };
      return b;
    }));
    root.replaceChildren(tabs, VIEWS[tab]());
  }

  fetch("configs-data.json").then(function (r) { return r.json(); }).then(function (d) { data = d; render(); })
    .catch(function () { root.textContent = "Could not load configs-data.json."; });
})();

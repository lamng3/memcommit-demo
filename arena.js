// A ranked leaderboard ("arena") drawn from a JSON file of recorded results. Nothing is computed beyond sorting and ranking.
//   <div data-arena data-src="leaderboard-data.json"></div><script src="arena.js"></script>   (any number of boards per page)
// JSON: { note, groups: {id: {label, ours}}, boards: [{id, name, sub, metric, columns: [{key, label, fmt}], rows: [{name, group, tag, score, values}]}] }
(function () {
  var FMT = {
    f2: function (v) { return v.toFixed(2); }, f3: function (v) { return v.toFixed(3); }, f1: function (v) { return v.toFixed(1); },
    int: function (v) { return Math.round(v).toLocaleString(); }, pct: function (v) { return Math.round(v * 100) + "%"; },
    usd: function (v) { return "$" + v.toFixed(v < 1 ? 3 : 2); },
  };
  function el(tag, attrs) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "class") n.className = attrs[k]; else if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (function add(list) {
      list.forEach(function (kid) {
        if (kid == null || kid === false) return;
        if (Array.isArray(kid)) add(kid);
        else n.append(kid.nodeType ? kid : document.createTextNode(kid));
      });
    })([].slice.call(arguments, 2));
    return n;
  }
  function mount(root) {
  var data, board = 0, group = "all", query = "", sortKey = "score", sortDir = -1, refocus = false;

  function ranked(b) {
    // rank by the primary score, ties sharing a rank; the table may be sorted otherwise, ranks stay with the score
    var byScore = b.rows.slice().sort(function (x, y) { return b.lowerIsBetter ? x.score - y.score : y.score - x.score; });
    var rank = new Map(), last = null, r = 0;
    byScore.forEach(function (row, i) { if (row.score !== last) { r = i + 1; last = row.score; } rank.set(row, r); });
    return rank;
  }
  function medal(r) { return r <= 3 ? el("span", { class: "medal r" + r, text: r }) : el("span", { class: "plain", text: r }); }
  function fmt(c, v) { return v == null ? el("span", { class: "none", text: "–" }) : document.createTextNode((FMT[c.fmt] || FMT.f3)(v)); }
  function isOurs(row) { return !!(data.groups[row.group] || {}).ours; }

  function render() {
    var b = data.boards[board], rank = ranked(b), max = Math.max.apply(null, b.rows.map(function (r) { return r.score; })) || 1;
    var rows = b.rows.filter(function (r) {
      return (group === "all" || r.group === group) && (!query || (r.name + " " + (r.tag || "")).toLowerCase().indexOf(query) !== -1);
    });
    var cmp = function (x, y) {
      var a = sortKey === "score" ? x.score : sortKey === "name" ? x.name.toLowerCase() : (x.values || {})[sortKey];
      var c = sortKey === "score" ? y.score : sortKey === "name" ? y.name.toLowerCase() : (y.values || {})[sortKey];
      if (a == null) return 1; if (c == null) return -1;
      return (a < c ? -1 : a > c ? 1 : 0) * sortDir;
    };
    rows.sort(cmp);

    var top = b.rows.slice().sort(function (x, y) { return b.lowerIsBetter ? x.score - y.score : y.score - x.score; }).slice(0, 3);
    var podium = el("div", { class: "podium" }, top.map(function (row) {
      var r = rank.get(row);
      return el("div", { class: "slot r" + r + (isOurs(row) ? " ours" : "") }, el("span", { class: "medal", text: r }),
        el("div", { class: "name", text: row.name }), el("div", { class: "score", text: FMT[b.fmt || "f3"](row.score) }),
        el("div", { class: "meta", text: [(data.groups[row.group] || {}).label, row.tag].filter(Boolean).join(" · ") }));
    }));

    var head = el("tr", {}, el("th", { class: "rank", text: "#" }),
      th("name", "System", false), th("score", b.metricLabel || b.metric, true, true),
      b.columns.map(function (c) { return th(c.key, c.label, true, false, true); }));
    function th(key, label, num, primary, opt) {
      var cell = el("th", { class: (num ? "num " : "") + (opt ? "opt" : "") }, el("button", { type: "button", text: label }));
      if (sortKey === key) cell.setAttribute("aria-sort", sortDir < 0 ? "descending" : "ascending");
      cell.firstChild.onclick = function () { if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = key === "name" ? 1 : (b.lowerIsBetter && key === "score" ? 1 : -1); } render(); };
      return cell;
    }
    var body = el("tbody", {}, rows.map(function (row) {
      var r = rank.get(row), ours = isOurs(row);
      return el("tr", { class: ours ? "ours" : "other" },
        el("td", { class: "rank" }, medal(r)),
        el("td", {}, el("div", { class: "nm", text: row.name }),
          el("div", { class: "tags" },
            ours ? el("span", { class: "tag ours", text: (data.groups[row.group] || {}).label || "ours" }) : el("span", { class: "tag", text: (data.groups[row.group] || {}).label || row.group }),
            row.tag ? el("span", { class: "tag", text: row.tag }) : null)),
        el("td", { class: "num" }, el("div", { class: "meter" }, (function () { var i = el("i"); i.style.setProperty("--w", Math.round((row.score / max) * 100) + "%"); return i; })(), el("b", { text: FMT[b.fmt || "f3"](row.score) }))),
        b.columns.map(function (c) { return el("td", { class: "num opt" }, fmt(c, (row.values || {})[c.key])); }));
    }));
    var groups = Object.keys(data.groups);
    var bar = el("div", { class: "a-bar" },
      data.boards.length > 1 ? el("div", { class: "seg", role: "group", "aria-label": "Board" }, data.boards.map(function (bd, i) {
        return el("button", { type: "button", "aria-pressed": String(i === board), text: bd.name }); })) : null,
      el("div", { class: "seg", role: "group", "aria-label": "Show" }, ["all"].concat(groups).map(function (g) {
        return el("button", { type: "button", "aria-pressed": String(g === group), text: g === "all" ? "All" : data.groups[g].label }); })),
      el("input", { type: "search", placeholder: "Filter", "aria-label": "Filter systems", value: query }));
    var seg = bar.querySelectorAll(".seg");
    var bi = data.boards.length > 1 ? 0 : -1;
    if (bi === 0) seg[0].childNodes.forEach(function (btn, i) { btn.onclick = function () { board = i; sortKey = "score"; sortDir = b.lowerIsBetter ? 1 : -1; render(); }; });
    seg[seg.length - 1].childNodes.forEach(function (btn, i) { btn.onclick = function () { group = i === 0 ? "all" : groups[i - 1]; render(); }; });
    var input = bar.querySelector("input");
    input.oninput = function () { query = input.value.trim().toLowerCase(); refocus = true; render(); };

    root.className = "arena";
    root.replaceChildren.apply(root, [bar, b.sub ? el("p", { class: "a-sub", text: b.sub }) : null, podium,
      el("div", { class: "scroll" }, el("table", {}, el("thead", {}, head), body)),
      rows.length ? null : el("p", { class: "a-foot", text: "No system matches." }),
      el("p", { class: "a-foot", text: data.note || "" })].filter(Boolean));
    if (refocus) { // the redraw replaced the search box, so put the cursor back at the end of what was typed
      var box = root.querySelector("input[type=search]");
      box.focus(); box.setSelectionRange(box.value.length, box.value.length);
      refocus = false;
    }
  }

  fetch(root.dataset.src).then(function (r) { return r.json(); }).then(function (d) { data = d; sortDir = d.boards[0].lowerIsBetter ? 1 : -1; render(); });
  }
  document.querySelectorAll("[data-arena]").forEach(mount);
})();

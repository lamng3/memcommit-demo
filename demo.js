// Replays a real MemCommit log (demo-data.json, exported by demo_data.py) and lets a visitor retract a memory.
// The log and the set of memories a retraction marks stale come from the library; this file only folds them.
(function () {
  var root = document.getElementById("demo");
  if (!root) return;
  var el = function (id) { return document.getElementById(id); };
  var data, picked = null, extra = [];

  function records() { return data.log.concat(extra); }

  // The state after the first n records: status per memory id.
  function fold(n) {
    var status = {};
    records().slice(0, n).forEach(function (r) {
      if (r.op === "put") status[r.id] = "live";
      else if (r.op === "stale") status[r.id] = "stale";
      else if (r.op === "retract") status[r.id] = "retracted";
      else if (r.op === "restore") status[r.id] = "live";
    });
    return status;
  }

  function render() {
    var all = records(), n = +el("lsn").value, status = fold(n), byId = {};
    data.memories.forEach(function (m) { byId[m.id] = m; });
    el("lsn").max = all.length;
    el("lsn-out").textContent = n + " / " + all.length;
    var box = el("mems");
    box.innerHTML = "";
    data.memories.forEach(function (m) {
      var s = status[m.id];
      var b = document.createElement("button");
      b.className = "mem" + (s ? "" : " hidden");
      b.setAttribute("aria-pressed", picked === m.id ? "true" : "false");
      b.innerHTML = '<span class="key"></span><span class="chip ' + (s || "live") + '">' + (s || "") + '</span><span class="txt"></span>';
      b.querySelector(".key").textContent = m.kind + " · " + m.key;
      b.querySelector(".txt").textContent = m.text;
      b.onclick = function () { picked = picked === m.id ? null : m.id; render(); };
      box.appendChild(b);
    });
    var last = all[n - 1];
    el("logline").innerHTML = last
      ? "<b>lsn " + last.lsn + " " + last.op + "</b> " + (last.note || "") + (last.reason ? " · " + last.reason : "")
      : "empty log";
    el("retract").disabled = !(picked && status[picked] === "live" && n === all.length);
    el("undo").disabled = extra.length === 0;
  }

  function step(delta) { el("lsn").value = Math.max(0, Math.min(records().length, +el("lsn").value + delta)); }

  fetch("demo-data.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    el("lsn").max = data.log.length;
    el("lsn").value = data.log.length;
    el("lsn").oninput = render;
    el("retract").onclick = function () {
      var status = fold(records().length), base = records().length;
      data.cascade[picked].forEach(function (id, i) {
        if (status[id] !== "live") return;
        var m = id === picked ? "retract" : "stale";
        extra.push({ lsn: base + extra.length + 1, txn: 99, op: m, id: id, note: m === "retract" ? "retracted by you" : "derived from what was retracted", reason: "" });
      });
      el("lsn").max = records().length; // raise the max first, or the browser clamps the value to the old one
      el("lsn").value = records().length;
      picked = null;
      render();
    };
    el("undo").onclick = function () {
      // A rollback is a compensating record per memory, as in the library; here it simply removes the user's records.
      extra = [];
      el("lsn").value = data.log.length;
      render();
    };
    el("reset").onclick = function () { extra = []; picked = null; el("lsn").value = data.log.length; render(); };
    render();
  });
})();

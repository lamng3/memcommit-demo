// Shared playground helpers for the manuals: a SPARQL engine in the browser (Oxigraph, WebAssembly), data saved in
// IndexedDB, result tables, and an optional connection to a language model you run yourself (Ollama or any
// OpenAI-compatible endpoint). Nothing here talks to a server of ours; there is no server.
const PG = (() => {
  const OXIGRAPH = "https://cdn.jsdelivr.net/npm/oxigraph@0.5.12/web.js";
  let engine;
  const load = () => (engine ||= import(OXIGRAPH).then(async (ox) => { await ox.default(); return ox; }));

  // ---- storage: the store is kept as N-Quads in IndexedDB, per playground name ----
  const idb = (mode, fn) => new Promise((resolve, reject) => {
    const open = indexedDB.open("manual-playgrounds", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("stores");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("stores", mode), req = fn(tx.objectStore("stores"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
  const saved = (name) => idb("readonly", (s) => s.get(name)).catch(() => undefined);
  const keep = (name, text) => idb("readwrite", (s) => s.put(text, name)).catch(() => undefined);

  // A store that survives a reload. `seed` is [{text, format}] loaded when nothing is saved yet.
  async function openStore(name, seed = []) {
    const ox = await load(), store = new ox.Store();
    const previous = await saved(name);
    if (previous) { store.load(previous, { format: "application/n-quads" }); }
    else for (const s of seed) store.load(s.text, { format: s.format || "text/turtle", base_iri: s.base });
    const handle = {
      store, ox, restored: !!previous,
      async save() { await keep(name, store.dump({ format: "application/n-quads" })); },
      async reset(newSeed = seed) { store.update("DROP ALL"); for (const s of newSeed) store.load(s.text, { format: s.format || "text/turtle", base_iri: s.base }); await handle.save(); },
    };
    if (!previous) await handle.save();
    return handle;
  }

  // ---- terms and results ----
  const PREFIXES = {
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf:", "http://www.w3.org/2000/01/rdf-schema#": "rdfs:", "http://www.w3.org/2002/07/owl#": "owl:",
    "http://www.w3.org/2001/XMLSchema#": "xsd:", "http://xmlns.com/foaf/0.1/": "foaf:", "http://purl.org/dc/terms/": "dct:",
  };
  function short(iri, prefixes = {}) {
    for (const [ns, p] of Object.entries({ ...PREFIXES, ...prefixes })) if (iri.startsWith(ns) && iri.length > ns.length) return p + iri.slice(ns.length);
    return iri;
  }
  function term(t, prefixes) {
    if (!t) return { text: "", kind: "unbound" };
    if (t.termType === "NamedNode") return { text: short(t.value, prefixes), kind: "iri", full: t.value };
    if (t.termType === "BlankNode") return { text: "_:" + t.value, kind: "blank" };
    if (t.termType === "Literal") {
      const tail = t.language ? "@" + t.language : t.datatype && t.datatype.value !== "http://www.w3.org/2001/XMLSchema#string" ? "^^" + short(t.datatype.value, prefixes) : "";
      return { text: '"' + t.value + '"' + tail, kind: "literal" };
    }
    return { text: String(t.value ?? t), kind: "other" };
  }

  // Run a query or update. Returns {kind, vars, rows (arrays of terms), boolean, ms} or throws the engine's message.
  function run(store, text, prefixes) {
    const started = performance.now(), isUpdate = /^\s*(?:(?:PREFIX|BASE)[^\n]*\n\s*)*(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|COPY|MOVE|ADD|WITH)\b/i.test(text);
    if (isUpdate) { const before = store.size; store.update(text); return { kind: "update", changed: store.size - before, size: store.size, ms: performance.now() - started }; }
    const result = store.query(text), ms = performance.now() - started;
    if (typeof result === "boolean") return { kind: "ask", boolean: result, ms };
    if (typeof result === "string") return { kind: "text", text: result, ms };
    if (result.length && result[0].subject) { // CONSTRUCT / DESCRIBE: quads
      return { kind: "graph", vars: ["subject", "predicate", "object"], rows: result.map((q) => [term(q.subject, prefixes), term(q.predicate, prefixes), term(q.object, prefixes)]), ms };
    }
    const vars = result.length ? [...result[0].keys()] : (/SELECT\s+(?:DISTINCT\s+|REDUCED\s+)?((?:\?\w+\s*)+)/i.exec(text)?.[1].match(/\?\w+/g) || []).map((v) => v.slice(1));
    return { kind: "select", vars, rows: result.map((m) => vars.map((v) => term(m.get(v), prefixes))), ms };
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === "class") el.className = v; else if (k === "text") el.textContent = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (v != null && v !== false) el.setAttribute(k, v === true ? "" : v); }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }

  // Draw a result into `el`: a table for rows, a line for the rest, and a count with the time.
  function show(el, r, { limit = 500 } = {}) {
    el.replaceChildren();
    if (r.kind === "ask") return el.append(h("p", { class: "pg-line" }, "Answer: ", h("b", { text: String(r.boolean) }), ` · ${r.ms.toFixed(1)} ms`));
    if (r.kind === "update") return el.append(h("p", { class: "pg-line" }, `Update applied: ${r.changed >= 0 ? "+" : ""}${r.changed} triples, ${r.size.toLocaleString()} in the store · ${r.ms.toFixed(1)} ms`));
    if (r.kind === "text") return el.append(h("pre", { class: "pg-pre", text: r.text }));
    const shown = r.rows.slice(0, limit);
    const table = h("table", { class: "pg-table" },
      h("thead", {}, h("tr", {}, r.vars.map((v) => h("th", { scope: "col", text: "?" + v })))),
      h("tbody", {}, shown.map((row) => h("tr", {}, row.map((t) => h("td", { class: "pg-" + t.kind, title: t.full || null, text: t.text }))))));
    el.append(h("div", { class: "pg-scroll" }, r.rows.length ? table : null),
      h("p", { class: "pg-line" }, `${r.rows.length.toLocaleString()} ${r.rows.length === 1 ? "row" : "rows"}${r.rows.length > limit ? ` (first ${limit} shown)` : ""} · ${r.ms.toFixed(1)} ms`));
  }

  // ---- a language model: Ollama on this computer, a small one in the page (WebGPU), or any OpenAI-compatible endpoint ----
  const LLM_KEY = "pg:llm", OLLAMA = "http://localhost:11434";
  const HERE = document.currentScript && document.currentScript.src ? document.currentScript.src.replace(/[^/]*$/, "") : "";
  const DEFAULTS = { backend: "ollama", base: OLLAMA + "/v1", model: "llama3.1", key: "", local: "lfm2.5-350m" };
  const llmConfig = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LLM_KEY) || "{}") }; } catch { return { ...DEFAULTS }; } };
  const saveConfig = (patch) => { try { localStorage.setItem(LLM_KEY, JSON.stringify({ ...llmConfig(), ...patch })); } catch { /* storage may be off */ } };
  const LOCAL = { module: null, model: null, label: "" };
  const localModule = () => (LOCAL.module ||= import(HERE + "local-llm.js"));
  const llmName = () => { const c = llmConfig(); return c.backend === "browser" ? (LOCAL.model ? LOCAL.label + " in your browser" : "the in-browser model (not loaded yet)") : c.backend === "ollama" ? c.model + " on Ollama" : c.model + " at " + c.base; };
  const isLoopback = (url) => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname); } catch { return false; } };
  // Chrome asks the visitor before a public page reaches a server on their own machine; naming the request as one opts in to that prompt.
  const lna = (url) => (isLoopback(url) ? { targetAddressSpace: "loopback" } : {});
  const BLOCKED = (where) => "The browser could not reach " + where + ". Is Ollama running, and does it allow this page's origin (OLLAMA_ORIGINS=\"*\" ollama serve)? Chrome asks permission before a web page may reach a server on your computer: allow it when it asks, and try again. Safari does not allow it at all: use the in-browser model or the paste option instead.";

  async function chat(messages, { temperature = 0, maxTokens } = {}) {
    const c = llmConfig();
    if (c.backend === "browser") {
      if (!LOCAL.model) throw new Error("Load the in-browser model first: open Your model, choose In-browser model, and press Load.");
      return LOCAL.model.chat(messages, { temperature, maxTokens: maxTokens || 400 });
    }
    const base = c.backend === "ollama" ? OLLAMA + "/v1" : c.base, url = base.replace(/\/$/, "") + "/chat/completions";
    let res;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(c.key && c.backend !== "ollama" ? { Authorization: "Bearer " + c.key } : {}) },
        body: JSON.stringify({ model: c.model, messages, temperature, stream: false, ...(maxTokens ? { max_tokens: maxTokens } : {}) }), ...lna(url) });
    } catch (e) { throw new Error(isLoopback(url) ? BLOCKED(base) : "The browser could not reach " + base + ". Does it allow this page's origin (CORS)?"); }
    if (!res.ok) throw new Error(`The model endpoint answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).choices[0].message.content;
  }
  // Is Ollama running on this computer, and which models does it have?
  async function detectOllama() {
    try {
      const r = await fetch(OLLAMA + "/api/tags", { signal: AbortSignal.timeout(3000), ...lna(OLLAMA) });
      if (!r.ok) return { ok: false, error: "answered " + r.status };
      return { ok: true, models: ((await r.json()).models || []).map((m) => m.name) };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  async function localModels() { try { return (await localModule()).MODELS; } catch { return []; } }

  // The form: three ways to get a model. Settings stay in this browser and go only to the endpoint you name.
  function llmPanel(el, { onChange } = {}) {
    const c0 = llmConfig(), changed = () => onChange && onChange();
    const field = (id, label, value, type = "text", ph = "") => h("label", { class: "pg-field", for: id }, label, h("input", { id, type, value, placeholder: ph, autocomplete: "off" }));
    const backend = h("select", { id: "llm-backend", "aria-label": "Where the model runs" }, [["ollama", "Ollama on this computer"], ["browser", "A small model in this browser (WebGPU)"], ["endpoint", "Another OpenAI-compatible endpoint"]].map(([v, t]) => h("option", { value: v, text: t, selected: v === c0.backend })));
    // Ollama
    const ollamaStatus = h("span", { class: "pg-status", id: "llm-ollama-status", text: "not checked yet" }), ollamaSel = h("select", { id: "llm-ollama-model", "aria-label": "Ollama model" });
    const detect = async () => {
      ollamaStatus.textContent = "looking for Ollama…"; const r = await detectOllama(), cur = llmConfig();
      if (!r.ok) { ollamaStatus.textContent = "Ollama not found at " + OLLAMA + " (" + r.error + "). Start it with OLLAMA_ORIGINS=\"*\" ollama serve, then check again."; ollamaSel.replaceChildren(); return; }
      if (!r.models.length) { ollamaStatus.textContent = "Ollama is running but has no models: try ollama pull llama3.1"; ollamaSel.replaceChildren(); return; }
      ollamaSel.replaceChildren(...r.models.map((m) => h("option", { value: m, text: m, selected: m === cur.model })));
      if (!r.models.includes(cur.model)) { saveConfig({ model: r.models[0] }); }
      ollamaSel.value = llmConfig().model; ollamaStatus.textContent = "Ollama found: " + r.models.length + (r.models.length === 1 ? " model" : " models") + " installed."; changed();
    };
    ollamaSel.addEventListener("change", () => { saveConfig({ model: ollamaSel.value }); changed(); });
    const ollama = h("div", { id: "llm-ollama" }, h("div", { class: "pg-row" }, h("button", { type: "button", class: "btn", id: "llm-detect", onclick: detect }, "Detect Ollama"), ollamaSel, ollamaStatus),
      h("p", { class: "pg-note", text: "Ollama is detected when you open this panel. Browsers ask permission before a web page reaches a server on your computer, and Ollama must allow this page: run OLLAMA_ORIGINS=\"*\" ollama serve." }));
    // In the page
    const localSel = h("select", { id: "llm-local-model", "aria-label": "In-browser model" }), bar = h("progress", { id: "llm-progress", max: 100, value: 0, hidden: true }), localStatus = h("span", { class: "pg-status", id: "llm-local-status" });
    localModels().then((ms) => { localSel.replaceChildren(...ms.map((m) => h("option", { value: m.id, text: m.label + " (" + m.size + ")", selected: m.id === c0.local }))); });
    localSel.addEventListener("change", () => saveConfig({ local: localSel.value }));
    const load = async () => {
      try {
        localStatus.textContent = "starting…"; bar.hidden = false;
        const mod = await localModule(); if (LOCAL.model) { LOCAL.model.dispose(); LOCAL.model = null; }
        const id = localSel.value || llmConfig().local;
        LOCAL.model = await mod.load(id, { onStatus: (t) => (localStatus.textContent = t), onProgress: (what, p) => { if (what === "weights" && p.total) { bar.value = (p.loaded / p.total) * 100; } } });
        LOCAL.label = LOCAL.model.label; localStatus.textContent = "Ready: " + LOCAL.label + " on " + (LOCAL.model.backend === "webgpu" ? "WebGPU" : "WebAssembly") + "."; bar.hidden = true; changed();
      } catch (e) { bar.hidden = true; localStatus.textContent = "Could not load it: " + String(e.message || e); }
    };
    const browser = h("div", { id: "llm-browser" }, h("div", { class: "pg-row" }, localSel, h("button", { type: "button", class: "btn", id: "llm-load", onclick: load }, "Load the model"), bar, localStatus),
      h("p", { class: "pg-note", text: "This downloads the weights once (hundreds of megabytes, then kept by your browser) and runs the model on your GPU with jax-js, so nothing leaves the page. These models are tiny: expect them to follow a format but get the task wrong. Use Ollama for real answers." }));
    // Any endpoint
    const base = field("llm-base", "Endpoint", c0.base, "text", "http://localhost:11434/v1"), model = field("llm-model", "Model", c0.model), key = field("llm-key", "API key (optional)", c0.key, "password");
    const status = h("span", { class: "pg-status" });
    const saveEndpoint = () => { saveConfig({ base: base.querySelector("input").value.trim(), model: model.querySelector("input").value.trim(), key: key.querySelector("input").value }); changed(); };
    [base, model, key].forEach((f) => f.querySelector("input").addEventListener("change", saveEndpoint));
    const test = h("button", { type: "button", class: "btn", onclick: async () => { saveEndpoint(); status.textContent = "asking…"; try { const t0 = performance.now(); await chat([{ role: "user", content: "Reply with the single word: ready" }]); status.textContent = `reachable (${Math.round(performance.now() - t0)} ms)`; } catch (e) { status.textContent = "not reachable: " + (e.message || e); } } }, "Test the connection");
    const endpoint = h("div", { id: "llm-endpoint" }, h("div", { class: "pg-llm" }, base, model, key), h("p", { class: "pg-line" }, test, " ", status));
    const show = () => { const v = backend.value; ollama.hidden = v !== "ollama"; browser.hidden = v !== "browser"; endpoint.hidden = v !== "endpoint"; };
    backend.addEventListener("change", () => { saveConfig({ backend: backend.value }); show(); changed(); if (backend.value === "ollama") detect(); });
    el.replaceChildren(h("div", { class: "pg-row" }, h("label", { for: "llm-backend" }, "Run the model "), backend), ollama, browser, endpoint);
    show();
    const details = el.closest("details"); let probed = false;
    const probe = () => { if (!probed && backend.value === "ollama") { probed = true; detect(); } };
    if (details) details.addEventListener("toggle", () => { if (details.open) probe(); }); else probe();
  }

  return { load, openStore, run, show, short, term, h, chat, llmPanel, llmConfig, llmName, detectOllama };
})();

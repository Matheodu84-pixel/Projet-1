// ── What Is This? — logique principale (thread UI) ────────────────────────────

const PROMPT =
  "Identifie précisément ce qu'on voit sur cette photo. Réponds en " +
  "français avec : 1) Ce que c'est exactement, 2) Deux ou trois détails " +
  "clés (espèce, origine, usage, contexte...), 3) Un fait surprenant. " +
  "Sois concis et passionné.";

const MAX_SIDE = 512; // compression côté client avant l'IA

const $ = (id) => document.getElementById(id);
const el = {
  status: $("status"), statusText: $("statusText"),
  loader: $("loader"), dlBar: $("dlBar"), dlText: $("dlText"),
  picker: $("picker"), btnCamera: $("btnCamera"), btnGallery: $("btnGallery"),
  fileCamera: $("fileCamera"), fileGallery: $("fileGallery"),
  stage: $("stage"), previewImg: $("previewImg"),
  btnAnalyze: $("btnAnalyze"), btnCancel: $("btnCancel"),
  result: $("result"), resultImg: $("resultImg"),
  resultBody: $("resultBody"), btnRetry: $("btnRetry"),
};

let worker = null;
let modelReady = false;
let currentImage = null; // data URL compressée
const progress = new Map(); // file -> { loaded, total }

// ── Statut ────────────────────────────────────────────────────────────────────
function setStatus(kind, text) {
  el.status.className = "status status--" + kind;
  el.statusText.textContent = text;
}

function show(section, on = true) { section.hidden = !on; }

// ── Service worker (offline) ──────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// ── Worker IA ─────────────────────────────────────────────────────────────────
function initWorker() {
  worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", onWorkerMessage);
  worker.postMessage({ type: "load" });
}

function fmtMB(bytes) { return (bytes / 1048576).toFixed(0); }

function onWorkerMessage(e) {
  const m = e.data;
  switch (m.status) {
    case "loading":
      setStatus("loading", "Chargement de l'IA…");
      show(el.loader, true);
      break;

    case "initiate":
    case "download":
      if (m.file) progress.set(m.file, { loaded: 0, total: m.total || 0 });
      break;

    case "progress": {
      if (m.file) {
        progress.set(m.file, {
          loaded: m.loaded || 0,
          total: m.total || progress.get(m.file)?.total || 0,
        });
      }
      let loaded = 0, total = 0;
      for (const v of progress.values()) { loaded += v.loaded; total += v.total; }
      if (total > 0) {
        const pct = Math.min(100, Math.round((loaded / total) * 100));
        el.dlBar.style.width = pct + "%";
        el.dlText.textContent =
          `Téléchargement de l'IA… ${fmtMB(loaded)}/${fmtMB(total)} Mo ` +
          "— à faire une seule fois !";
        setStatus("loading", `Téléchargement de l'IA… ${pct}%`);
      }
      break;
    }

    case "done":
      break;

    case "ready":
      modelReady = true;
      show(el.loader, false);
      setStatus("ready", "🟢 IA chargée — prête hors ligne");
      break;

    case "start":
      el.resultBody.innerHTML = '<span class="caret"></span>';
      streamBuffer = "";
      break;

    case "update":
      streamBuffer += m.output || "";
      el.resultBody.innerHTML =
        renderMarkdown(streamBuffer) + '<span class="caret"></span>';
      el.resultBody.scrollIntoView({ block: "nearest", behavior: "smooth" });
      break;

    case "complete":
      streamBuffer = m.output || streamBuffer;
      el.resultBody.innerHTML = renderMarkdown(streamBuffer.trim());
      el.btnAnalyze.disabled = false;
      el.btnAnalyze.classList.remove("is-busy");
      setStatus("ready", "🟢 IA chargée — prête hors ligne");
      break;

    case "error":
      handleError(m.data);
      break;
  }
}

let streamBuffer = "";

function handleError(msg) {
  setStatus("error", "Erreur");
  show(el.loader, false);
  el.btnAnalyze.disabled = false;
  el.btnAnalyze.classList.remove("is-busy");
  el.resultBody.innerHTML = renderMarkdown(
    "**Oups, une erreur est survenue.**\n\n" +
      "`" + (msg || "inconnue") + "`\n\n" +
      "Vérifie ta connexion lors du premier chargement, puis réessaie.",
  );
  show(el.result, true);
  show(el.stage, false);
}

// ── Compression image (max 512×512) ───────────────────────────────────────────
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > h && w > MAX_SIDE) { h = Math.round((h * MAX_SIDE) / w); w = MAX_SIDE; }
      else if (h >= w && h > MAX_SIDE) { w = Math.round((w * MAX_SIDE) / h); h = MAX_SIDE; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible")); };
    img.src = url;
  });
}

async function onFile(file) {
  if (!file) return;
  try {
    currentImage = await compressImage(file);
    el.previewImg.src = currentImage;
    show(el.picker, false);
    show(el.result, false);
    show(el.stage, true);
    el.stage.classList.add("fade");
  } catch (err) {
    handleError(err.message);
  }
}

// ── Markdown minimal & sûr ────────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderMarkdown(src) {
  const lines = escapeHtml(src).split("\n");
  let html = "", listOpen = false;
  const inline = (t) =>
    t
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  for (let raw of lines) {
    const line = raw.trim();
    const li = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    const hd = line.match(/^(#{1,3})\s+(.*)$/);
    if (li) {
      if (!listOpen) { html += "<ul>"; listOpen = true; }
      html += "<li>" + inline(li[1]) + "</li>";
      continue;
    }
    if (listOpen) { html += "</ul>"; listOpen = false; }
    if (hd) { html += `<h3>${inline(hd[2])}</h3>`; }
    else if (line) { html += `<p>${inline(line)}</p>`; }
  }
  if (listOpen) html += "</ul>";
  return html;
}

// ── Analyse ───────────────────────────────────────────────────────────────────
function analyze() {
  if (!currentImage) return;
  if (!modelReady) {
    setStatus("loading", "L'IA finit de charger…");
    show(el.loader, true);
    return;
  }
  el.btnAnalyze.disabled = true;
  el.btnAnalyze.classList.add("is-busy");
  setStatus("loading", "🔎 Analyse en cours…");
  el.resultImg.src = currentImage;
  show(el.stage, false);
  show(el.result, true);
  el.result.classList.add("fade");
  el.resultBody.innerHTML = '<span class="caret"></span>';
  worker.postMessage({ type: "generate", data: { image: currentImage, prompt: PROMPT } });
}

function reset() {
  currentImage = null;
  el.fileCamera.value = "";
  el.fileGallery.value = "";
  show(el.result, false);
  show(el.stage, false);
  show(el.picker, true);
  el.picker.classList.add("fade");
}

// ── Évènements UI ─────────────────────────────────────────────────────────────
el.btnCamera.addEventListener("click", () => el.fileCamera.click());
el.btnGallery.addEventListener("click", () => el.fileGallery.click());
el.fileCamera.addEventListener("change", (e) => onFile(e.target.files[0]));
el.fileGallery.addEventListener("change", (e) => onFile(e.target.files[0]));
el.btnAnalyze.addEventListener("click", analyze);
el.btnCancel.addEventListener("click", reset);
el.btnRetry.addEventListener("click", reset);

setStatus("loading", "Initialisation…");
initWorker();

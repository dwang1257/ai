export const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Post a Reel</title>
<style>
:root { color-scheme: light dark; --bg: #f6f6f4; --card: #ffffff; --text: #1a1a1a; --muted: #6b6b6b; --border: #dcdcd8; --subtle: #f0f0ed; --track: #e6e6e2; --raised: #ffffff; --accent: #1a1a1a; --accent-text: #ffffff; --error: #b42318; --ok: #067647; }
@media (prefers-color-scheme: dark) { :root { --bg: #111111; --card: #1b1b1b; --text: #ececec; --muted: #9a9a9a; --border: #333333; --subtle: #242424; --track: #2e2e2e; --raised: #333333; --accent: #ececec; --accent-text: #111111; --error: #f97066; --ok: #47cd89; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; padding: 48px 16px; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, sans-serif; }
main { width: 100%; max-width: 560px; margin: 0 auto; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
h1 { margin: 0 0 20px; font-size: 20px; font-weight: 600; line-height: 1.3; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tabs { display: flex; gap: 4px; margin: 0 0 24px; padding: 4px; border-radius: 10px; background: var(--subtle); }
.tab { flex: 1; padding: 7px 12px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.tab:hover { color: var(--text); }
.tab[aria-selected="true"] { background: var(--raised); color: var(--text); box-shadow: 0 0 0 1px var(--border), 0 1px 2px rgba(0, 0, 0, 0.06); }
label { display: block; margin-bottom: 6px; font-weight: 500; }
.control { display: block; width: 100%; margin: 0 0 16px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
textarea.control { min-height: 120px; resize: vertical; }
.control:focus-visible { outline-offset: -1px; }
.primary { display: block; width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-text); font: inherit; font-weight: 600; cursor: pointer; }
.secondary { display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 14px; font-weight: 500; line-height: 1.4; text-decoration: none; cursor: pointer; }
.secondary:hover:not(:disabled) { background: var(--subtle); }
.text-button { padding: 0; border: 0; background: none; color: var(--muted); font: inherit; font-size: 13px; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.text-button:hover:not(:disabled) { color: var(--text); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.status { margin: 16px 0 0; color: var(--muted); overflow-wrap: anywhere; }
.status:empty { display: none; }
.status.error { color: var(--error); }
.status.ok { color: var(--ok); }
.status a { color: inherit; }
.lede { margin: -12px 0 20px; color: var(--muted); font-size: 14px; }
.lede span { display: block; font-size: 13px; overflow-wrap: anywhere; }
.notice { margin: 0 0 20px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--subtle); font-size: 14px; overflow-wrap: anywhere; }
.notice.error { color: var(--error); }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
.zones { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 0 0 16px; }
.field { min-width: 0; }
.field-label { display: block; margin-bottom: 6px; font-weight: 500; }
.zone { display: flex; flex-direction: column; min-height: 236px; border: 1px dashed var(--border); border-radius: 8px; transition: border-color 0.15s, background-color 0.15s; }
.zone.filled { border-style: solid; }
.zone.dragover { border-style: solid; border-color: var(--accent); background: var(--subtle); }
.zone.invalid { border-color: var(--error); }
.pick { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 100%; padding: 20px 16px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; text-align: center; cursor: pointer; }
.pick:hover:not(:disabled) { background: var(--subtle); }
.zone.dragover .pick { background: transparent; }
.pick svg { width: 28px; height: 28px; margin-bottom: 8px; color: var(--muted); }
.pick-title { font-weight: 500; }
.pick-hint { color: var(--muted); font-size: 13px; }
.picked { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 8px; min-width: 0; }
.preview { display: flex; height: 148px; border-radius: 6px; background: var(--subtle); overflow: hidden; }
.preview video, .preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
.file { display: flex; flex-direction: column; gap: 6px; padding: 0 4px; min-width: 0; }
.file-name { overflow: hidden; font-size: 14px; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.file-sub { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.file-sub .ok { color: var(--ok); }
.file-sub .error { color: var(--error); }
.file-actions { display: flex; gap: 14px; margin-top: auto; padding: 0 4px 4px; }
.bar { height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; }
.bar > span { display: block; width: 0; height: 100%; border-radius: 2px; background: var(--accent); transition: width 0.2s; }
.zone-error { margin: 6px 0 0; color: var(--error); font-size: 13px; }
.zone-error:empty { display: none; }
.check { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; font-weight: 400; cursor: pointer; }
.check input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
.job { margin: 16px 0 0; padding: 16px; border: 1px solid var(--border); border-radius: 8px; }
.job-head, .job-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.job-state { font-weight: 600; }
.job-state.ok { color: var(--ok); }
.job-state.error { color: var(--error); }
.job-elapsed, .job-line { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.job-elapsed { flex: none; white-space: nowrap; }
.job-line > :last-child { flex: none; }
.meter { position: relative; height: 6px; margin: 12px 0 8px; border-radius: 3px; background: var(--track); overflow: hidden; }
.meter > span { display: block; width: 0; height: 100%; border-radius: 3px; background: var(--accent); transition: width 0.4s; }
.meter.stopped > span { background: var(--muted); }
.meter.indeterminate > span { width: 35%; transition: none; animation: slide 1.6s ease-in-out infinite; }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
@media (prefers-reduced-motion: reduce) {
  .zone, .bar > span, .meter > span { transition: none; }
  .meter.indeterminate > span { width: 100%; animation: none; opacity: 0.45; background: repeating-linear-gradient(-45deg, var(--accent) 0 6px, transparent 6px 12px); }
}
.job-note { margin: 8px 0 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.job-note:empty { display: none; }
.job-note.error { color: var(--error); }
.job-note a { color: inherit; }
.job-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.result { margin: 16px 0 0; }
.result video { display: block; width: 100%; max-height: 520px; border-radius: 8px; background: #000000; }
.result-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0 0; }
.path { margin: 8px 0 0; color: var(--muted); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.partials { margin: 12px 0 0; color: var(--muted); font-size: 13px; }
.partials ul { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 4px 0 0; padding: 0; list-style: none; }
.partials a { color: inherit; }
.result > .secondary { width: 100%; margin-top: 16px; }
@media (max-width: 520px) {
  body { padding: 16px; }
  main { padding: 20px 16px; }
  .zones { grid-template-columns: 1fr; }
  .zone { min-height: 168px; }
  .preview { height: 200px; }
  .result-actions { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<main>
<div class="tabs" role="tablist" aria-label="Mode">
<button class="tab" id="tab-post" type="button" role="tab" aria-selected="true" aria-controls="panel-post" data-tab="post" data-title="Post a Reel">Post a Reel</button>
<button class="tab" id="tab-animate" type="button" role="tab" aria-selected="false" aria-controls="panel-animate" data-tab="animate" data-title="Animate" tabindex="-1">Animate</button>
</div>
<section id="panel-post" role="tabpanel" aria-labelledby="tab-post">
<h1>Post a Reel to Instagram</h1>
<form id="form">
<label for="videoPath">Video path</label>
<input class="control" id="videoPath" name="videoPath" placeholder="/Users/you/videos/reel.mp4" required autocomplete="off" spellcheck="false">
<label for="caption">Caption</label>
<textarea class="control" id="caption" name="caption" maxlength="2200" placeholder="Leave empty and Claude writes one from the video"></textarea>
<button class="primary" id="post" type="submit">Post to Instagram</button>
</form>
<p class="status" id="status" role="status" aria-live="polite"></p>
</section>
<section id="panel-animate" role="tabpanel" aria-labelledby="tab-animate" hidden>
<h1>Animate a character</h1>
<p class="lede">Swap the character in a template video with Viggle Animate on Maestro.<span id="maestroHost" hidden></span></p>
<p class="notice" id="animateNotice" role="status" hidden></p>
<div class="zones">
<div class="field">
<span class="field-label" id="videoLabel">Template video</span>
<div class="zone disabled" id="videoZone">
<button class="pick" id="videoPick" type="button" aria-labelledby="videoLabel videoPickTitle" aria-describedby="videoPickHint" disabled>
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>
<span class="pick-title" id="videoPickTitle">Choose a video</span>
<span class="pick-hint" id="videoPickHint">or drag it here<br>MP4, MOV, WEBM, MKV, M4V, AVI<br>Up to 500 MB</span>
</button>
<div class="picked" id="videoPicked" hidden>
<div class="preview" id="videoPreview"></div>
<div class="file">
<span class="file-name" id="videoName"></span>
<div class="file-sub"><span id="videoSize"></span><span id="videoUpload"></span></div>
<div class="bar" id="videoBar" role="progressbar" aria-label="Template video upload" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="videoBarFill"></span></div>
</div>
<div class="file-actions">
<button class="text-button" id="videoRetry" type="button" hidden>Retry upload</button>
<button class="text-button" id="videoReplace" type="button">Replace</button>
<button class="text-button" id="videoRemove" type="button">Remove</button>
</div>
</div>
<input id="videoInput" type="file" accept="video/*,.mp4,.mov,.webm,.mkv,.m4v,.avi" tabindex="-1" hidden>
</div>
<p class="zone-error" id="videoError" aria-live="polite"></p>
</div>
<div class="field">
<span class="field-label" id="imageLabel">Character image</span>
<div class="zone disabled" id="imageZone">
<button class="pick" id="imagePick" type="button" aria-labelledby="imageLabel imagePickTitle" aria-describedby="imagePickHint" disabled>
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
<span class="pick-title" id="imagePickTitle">Choose an image</span>
<span class="pick-hint" id="imagePickHint">or drag it here<br>PNG, JPG, JPEG, WEBP<br>Up to 500 MB</span>
</button>
<div class="picked" id="imagePicked" hidden>
<div class="preview" id="imagePreview"></div>
<div class="file">
<span class="file-name" id="imageName"></span>
<div class="file-sub"><span id="imageSize"></span><span id="imageUpload"></span></div>
<div class="bar" id="imageBar" role="progressbar" aria-label="Character image upload" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="imageBarFill"></span></div>
</div>
<div class="file-actions">
<button class="text-button" id="imageRetry" type="button" hidden>Retry upload</button>
<button class="text-button" id="imageReplace" type="button">Replace</button>
<button class="text-button" id="imageRemove" type="button">Remove</button>
</div>
</div>
<input id="imageInput" type="file" accept="image/*,.png,.jpg,.jpeg,.webp" tabindex="-1" hidden>
</div>
<p class="zone-error" id="imageError" aria-live="polite"></p>
</div>
</div>
<label class="check"><input id="keepAudio" type="checkbox" checked disabled>Keep original audio</label>
<button class="primary" id="generate" type="button" disabled>Generate</button>
<p class="status" id="animateStatus" role="status" aria-live="polite"></p>
<div class="job" id="job" hidden>
<div class="job-head"><span class="job-state" id="jobState" role="status" aria-live="polite"></span><span class="job-elapsed" id="jobElapsed"></span></div>
<div class="meter" id="jobMeter" aria-label="Generation progress"><span id="jobMeterFill"></span></div>
<div class="job-line"><span id="jobPhase"></span><span id="jobProgress"></span></div>
<p class="job-note" id="jobMessage"></p>
<p class="job-note" id="jobAudio"></p>
<p class="job-note error" id="jobError"></p>
<p class="job-note" id="jobNote"></p>
<div class="job-actions"><button class="secondary" id="cancel" type="button" hidden>Cancel</button><a class="secondary" id="openMaestro" href="#" target="_blank" rel="noopener noreferrer" hidden>Open Maestro</a></div>
</div>
<div class="result" id="result" hidden>
<video id="resultVideo" controls playsinline preload="metadata"></video>
<div class="result-actions" id="resultActions">
<a class="secondary" id="download" href="#" download>Download</a>
<button class="secondary" id="postThis" type="button">Post this to Instagram</button>
</div>
<p class="path" id="resultPath"></p>
<div class="partials" id="partials" hidden>Earlier partial renders<ul id="partialList"></ul></div>
<button class="secondary" id="again" type="button">Start another</button>
</div>
</section>
</main>
<script>
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { return; } },
  remove(key) { try { localStorage.removeItem(key); } catch { return; } }
};
const tabKey = "reelUi.tab";
const jobKey = "reelUi.animateJob";
const tabs = [document.getElementById("tab-post"), document.getElementById("tab-animate")];

function selectTab(tab, focus) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
  }
  document.title = tab.dataset.title;
  store.set(tabKey, tab.dataset.tab);
  if (focus) tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTab(tab, false));
  tab.addEventListener("keydown", (event) => {
    const next = { ArrowRight: tabs[(index + 1) % tabs.length], ArrowLeft: tabs[(index - 1 + tabs.length) % tabs.length], Home: tabs[0], End: tabs[tabs.length - 1] }[event.key];
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  });
});
selectTab(tabs.find((tab) => tab.dataset.tab === store.get(tabKey)) || tabs[0], false);

const form = document.getElementById("form");
const button = document.getElementById("post");
const statusEl = document.getElementById("status");
const labels = { running: "Publishing...", needs_attention: "Needs attention in Manus", published: "Posted to Instagram", failed: "Failed" };

function link(text, href) {
  if (!/^https?:\\/\\//.test(href)) return document.createTextNode(text);
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  return a;
}

function show(parts, tone) {
  statusEl.className = "status " + (tone || "");
  statusEl.replaceChildren(...parts.flatMap((part, i) => (i ? [document.createTextNode(" "), part] : [part])));
}

async function poll(taskId) {
  try {
    const response = await fetch("/api/status?id=" + encodeURIComponent(taskId));
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const parts = [document.createTextNode(labels[body.state] + ".")];
    if (body.message) parts.push(document.createTextNode(body.message));
    if (body.postUrl) parts.push(link("View Reel", body.postUrl));
    parts.push(link("Manus task", body.taskUrl));
    show(parts, body.state === "published" ? "ok" : body.state === "failed" ? "error" : "");
    if (body.state === "published" || body.state === "failed") return;
  } catch (error) {
    show([document.createTextNode("Could not check status: " + error.message + ". Retrying...")], "error");
  }
  setTimeout(() => poll(taskId), 5000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  const autoCaption = !form.caption.value.trim();
  show([document.createTextNode(autoCaption ? "Writing caption, then uploading video..." : "Uploading video and starting Manus task...")]);
  let response;
  try {
    response = await fetch("/api/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoPath: form.videoPath.value, caption: form.caption.value })
    });
  } catch {
    show([document.createTextNode("Lost connection to the UI server. The post may have started; check Manus before posting again.")], "error");
    return;
  }
  const body = await response.json().catch(() => ({ error: "Unreadable response from the UI server" }));
  if (!response.ok) {
    show([document.createTextNode(body.error)], "error");
    button.disabled = false;
    return;
  }
  if (autoCaption) {
    form.caption.value = body.caption;
    form.caption.readOnly = true;
  }
  show([document.createTextNode("Publishing started."), link("Manus task", body.taskUrl)]);
  poll(body.taskId);
});

const maxBytes = 500 * 1024 * 1024;
const kinds = {
  video: { extensions: [".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"], typeError: "Choose a video file: .mp4, .mov, .webm, .mkv, .m4v or .avi." },
  image: { extensions: [".png", ".jpg", ".jpeg", ".webp"], typeError: "Choose an image file: .png, .jpg, .jpeg or .webp." }
};
const stateLabels = { checking: "Checking status...", queued: "Queued - waiting for the GPU", running: "Generating", completed: "Done", failed: "Failed", cancelled: "Cancelled" };
const terminalStates = ["completed", "failed", "cancelled"];
const generate = document.getElementById("generate");
const keepAudio = document.getElementById("keepAudio");
const animateStatus = document.getElementById("animateStatus");
const notice = document.getElementById("animateNotice");
const maestroHost = document.getElementById("maestroHost");
const jobEl = document.getElementById("job");
const jobState = document.getElementById("jobState");
const jobElapsed = document.getElementById("jobElapsed");
const jobMeter = document.getElementById("jobMeter");
const jobMeterFill = document.getElementById("jobMeterFill");
const jobPhase = document.getElementById("jobPhase");
const jobProgress = document.getElementById("jobProgress");
const jobMessage = document.getElementById("jobMessage");
const jobAudio = document.getElementById("jobAudio");
const jobError = document.getElementById("jobError");
const jobNote = document.getElementById("jobNote");
const cancelButton = document.getElementById("cancel");
const resultEl = document.getElementById("result");
const resultVideo = document.getElementById("resultVideo");
const download = document.getElementById("download");
const resultPath = document.getElementById("resultPath");
const partials = document.getElementById("partials");
const partialList = document.getElementById("partialList");
const postThis = document.getElementById("postThis");
const resultActions = document.getElementById("resultActions");
const openMaestro = document.getElementById("openMaestro");
const again = document.getElementById("again");

let enabled = false;
let phase = "idle";
let current = null;
let pollTimer = 0;
let clockTimer = 0;
let finalOutput = "";

function el(id) {
  return document.getElementById(id);
}

const zones = {};
for (const kind of Object.keys(kinds)) {
  zones[kind] = {
    kind,
    root: el(kind + "Zone"),
    pick: el(kind + "Pick"),
    picked: el(kind + "Picked"),
    input: el(kind + "Input"),
    preview: el(kind + "Preview"),
    name: el(kind + "Name"),
    size: el(kind + "Size"),
    upload: el(kind + "Upload"),
    bar: el(kind + "Bar"),
    barFill: el(kind + "BarFill"),
    retry: el(kind + "Retry"),
    replace: el(kind + "Replace"),
    remove: el(kind + "Remove"),
    error: el(kind + "Error"),
    file: null,
    url: "",
    path: "",
    xhr: null
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function extension(name) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function mediaUrl(path) {
  return "/api/media?path=" + encodeURIComponent(path);
}

function setZoneError(zone, message) {
  zone.error.textContent = message;
  zone.root.classList.toggle("invalid", Boolean(message));
}

function setUploadState(zone, text, tone, fraction) {
  zone.upload.textContent = text;
  zone.upload.className = tone || "";
  zone.bar.style.visibility = fraction === null ? "hidden" : "visible";
  if (fraction !== null) {
    const percent = Math.round(fraction * 100);
    zone.barFill.style.width = percent + "%";
    zone.bar.setAttribute("aria-valuenow", String(percent));
  }
}

function resetZone(zone) {
  if (zone.xhr) zone.xhr.abort();
  zone.xhr = null;
  if (zone.url) URL.revokeObjectURL(zone.url);
  zone.url = "";
  zone.file = null;
  zone.path = "";
  zone.preview.replaceChildren();
}

function clearZone(zone) {
  resetZone(zone);
  zone.picked.hidden = true;
  zone.pick.hidden = false;
  zone.root.classList.remove("filled");
  setZoneError(zone, "");
  updateGenerate();
  zone.pick.focus();
}

function choose(zone, file) {
  if (!enabled || !file) return;
  if (!kinds[zone.kind].extensions.includes(extension(file.name))) {
    setZoneError(zone, kinds[zone.kind].typeError);
    return;
  }
  if (file.size > maxBytes) {
    setZoneError(zone, "That file is " + formatBytes(file.size) + ". The limit is 500 MB.");
    return;
  }
  if (file.size === 0) {
    setZoneError(zone, "That file is empty.");
    return;
  }
  setZoneError(zone, "");
  resetZone(zone);
  zone.file = file;
  zone.url = URL.createObjectURL(file);
  let media;
  if (zone.kind === "video") {
    media = document.createElement("video");
    media.muted = true;
    media.loop = true;
    media.autoplay = true;
    media.playsInline = true;
    media.setAttribute("muted", "");
    media.setAttribute("aria-label", "Template video preview");
  } else {
    media = document.createElement("img");
    media.alt = "Character image preview";
  }
  media.src = zone.url;
  zone.preview.replaceChildren(media);
  if (media.play) media.play().catch(() => undefined);
  zone.name.textContent = file.name;
  zone.name.title = file.name;
  zone.size.textContent = formatBytes(file.size);
  zone.pick.hidden = true;
  zone.picked.hidden = false;
  zone.root.classList.add("filled");
  upload(zone);
}

function upload(zone) {
  const file = zone.file;
  const xhr = new XMLHttpRequest();
  zone.xhr = xhr;
  zone.path = "";
  zone.retry.hidden = true;
  setUploadState(zone, "Uploading 0%", "", 0);
  updateGenerate();
  const fail = (message) => {
    if (zone.xhr !== xhr) return;
    zone.xhr = null;
    zone.retry.hidden = false;
    setUploadState(zone, "Upload failed", "error", null);
    setZoneError(zone, message);
    updateGenerate();
  };
  xhr.upload.onprogress = (event) => {
    if (zone.xhr !== xhr || !event.lengthComputable) return;
    const fraction = event.loaded / event.total;
    setUploadState(zone, "Uploading " + Math.round(fraction * 100) + "%", "", fraction);
  };
  xhr.onload = () => {
    if (zone.xhr !== xhr) return;
    let body;
    try {
      body = JSON.parse(xhr.responseText);
    } catch {
      body = { error: "Unreadable response from the UI server" };
    }
    if (xhr.status < 200 || xhr.status >= 300 || !body.path) {
      fail(body.error || "Upload failed with HTTP " + xhr.status);
      return;
    }
    zone.xhr = null;
    zone.path = body.path;
    setUploadState(zone, "Uploaded", "ok", null);
    updateGenerate();
  };
  xhr.onerror = () => fail("Lost connection to the UI server while uploading.");
  xhr.open("POST", "/api/upload?kind=" + zone.kind + "&name=" + encodeURIComponent(file.name));
  xhr.setRequestHeader("content-type", "application/octet-stream");
  xhr.send(file);
}

for (const zone of Object.values(zones)) {
  zone.pick.addEventListener("click", () => zone.input.click());
  zone.replace.addEventListener("click", () => zone.input.click());
  zone.remove.addEventListener("click", () => clearZone(zone));
  zone.retry.addEventListener("click", () => {
    setZoneError(zone, "");
    upload(zone);
  });
  zone.input.addEventListener("change", () => {
    const file = zone.input.files[0];
    zone.input.value = "";
    choose(zone, file);
  });
  const hasFiles = (event) => event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files");
  zone.root.addEventListener("dragenter", (event) => {
    if (!enabled || !hasFiles(event)) return;
    event.preventDefault();
    zone.root.classList.add("dragover");
  });
  zone.root.addEventListener("dragover", (event) => {
    if (!enabled || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    zone.root.classList.add("dragover");
  });
  zone.root.addEventListener("dragleave", (event) => {
    if (!zone.root.contains(event.relatedTarget)) zone.root.classList.remove("dragover");
  });
  zone.root.addEventListener("drop", (event) => {
    zone.root.classList.remove("dragover");
    if (!enabled || !hasFiles(event)) return;
    event.preventDefault();
    choose(zone, event.dataTransfer.files[0]);
  });
}

window.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer && !event.target.closest?.(".zone")) event.dataTransfer.dropEffect = "none";
});
window.addEventListener("drop", (event) => event.preventDefault());

function setEnabled(value) {
  enabled = value;
  keepAudio.disabled = !value;
  for (const zone of Object.values(zones)) {
    zone.pick.disabled = !value;
    zone.replace.disabled = !value;
    zone.remove.disabled = !value;
    zone.retry.disabled = !value;
    zone.root.classList.toggle("disabled", !value);
  }
  updateGenerate();
}

function updateGenerate() {
  generate.disabled = !(enabled && phase === "idle" && zones.video.path && zones.image.path);
  generate.textContent = phase === "submitting" ? "Starting..." : phase === "active" ? "Generating..." : "Generate";
}

function showAnimateStatus(text, tone) {
  animateStatus.className = "status " + (tone || "");
  animateStatus.textContent = text;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return "Elapsed " + (hours ? hours + ":" + String(minutes).padStart(2, "0") : minutes) + ":" + seconds;
}

function tick() {
  if (current) jobElapsed.textContent = formatElapsed(Date.now() - current.submittedAt);
}

function stopTimers() {
  clearTimeout(pollTimer);
  clearInterval(clockTimer);
  pollTimer = 0;
  clockTimer = 0;
}

function setMeter(state, progress) {
  const value = state === "completed" ? 100 : Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  const indeterminate = (state === "running" || state === "checking") && value === 0;
  jobMeter.classList.toggle("indeterminate", indeterminate);
  jobMeter.classList.toggle("stopped", state === "failed" || state === "cancelled");
  if (indeterminate) {
    jobMeter.removeAttribute("role");
    jobMeter.removeAttribute("aria-valuenow");
    jobMeterFill.style.width = "";
  } else {
    jobMeter.setAttribute("role", "progressbar");
    jobMeter.setAttribute("aria-valuemin", "0");
    jobMeter.setAttribute("aria-valuemax", "100");
    jobMeter.setAttribute("aria-valuenow", String(value));
    jobMeterFill.style.width = value + "%";
  }
  return { value, indeterminate };
}

function resetJobView() {
  jobState.textContent = "";
  jobState.className = "job-state";
  jobElapsed.textContent = "";
  jobPhase.textContent = "";
  jobProgress.textContent = "";
  jobMessage.textContent = "";
  jobAudio.textContent = "";
  jobError.textContent = "";
  jobNote.textContent = "";
  jobNote.className = "job-note";
  cancelButton.hidden = true;
  cancelButton.disabled = false;
  cancelButton.textContent = "Cancel";
  openMaestro.hidden = true;
  setMeter("queued", 0);
  resultEl.hidden = true;
  resultVideo.removeAttribute("src");
  resultVideo.load();
  partialList.replaceChildren();
  partials.hidden = true;
  finalOutput = "";
}

function renderStatus(status) {
  const state = status.state;
  const active = !terminalStates.includes(state);
  jobState.textContent = stateLabels[state] || state;
  jobState.className = "job-state" + (state === "completed" ? " ok" : state === "failed" ? " error" : "");
  const meter = setMeter(state, status.progress);
  jobPhase.textContent = status.phase || (state === "queued" ? "Waiting for Maestro to start the job" : "");
  let right = "";
  if (active && typeof status.etaSeconds === "number" && status.etaSeconds > 0) {
    right = status.etaSeconds < 60 ? "Less than a minute left" : "About " + Math.round(status.etaSeconds / 60) + " min left";
  }
  if (state === "running" && !meter.indeterminate) right = meter.value + "%" + (right ? " - " + right : "");
  jobProgress.textContent = right;
  jobMessage.textContent = active && status.message && status.message !== status.phase ? status.message : "";
  jobError.textContent = status.error || "";
  jobError.className = "job-note" + (state === "cancelled" ? "" : " error");
  cancelButton.hidden = !active || state === "checking";
  openMaestro.hidden = openMaestro.hidden || !active;
  if (!active) finish(status);
}

function finish(status) {
  stopTimers();
  tick();
  store.remove(jobKey);
  if (status.state === "completed") {
    phase = "done";
    showResult(status.outputs || []);
  } else {
    phase = "idle";
    current = null;
  }
  updateGenerate();
}

function showResult(outputs) {
  resultEl.hidden = false;
  if (outputs.length === 0) {
    jobError.textContent = "Maestro finished but returned no output files.";
    resultVideo.hidden = true;
    resultActions.hidden = true;
    resultPath.textContent = "";
    again.focus();
    return;
  }
  finalOutput = outputs[outputs.length - 1];
  resultVideo.hidden = false;
  resultActions.hidden = false;
  resultVideo.src = mediaUrl(finalOutput);
  download.href = mediaUrl(finalOutput) + "&download=1";
  resultPath.textContent = finalOutput;
  const earlier = outputs.slice(0, -1);
  partialList.replaceChildren(...earlier.map((path, i) => {
    const item = document.createElement("li");
    const a = document.createElement("a");
    a.href = mediaUrl(path);
    a.target = "_blank";
    a.rel = "noopener";
    a.title = path;
    a.textContent = "Partial render " + (i + 1);
    item.append(a);
    return item;
  }));
  partials.hidden = earlier.length === 0;
}

async function pollJob(jobId) {
  if (!current || current.jobId !== jobId) return;
  try {
    const response = await fetch("/api/animate/status?id=" + encodeURIComponent(jobId));
    const body = await response.json().catch(() => ({ error: "Unreadable response from the UI server" }));
    if (!current || current.jobId !== jobId) return;
    if (response.status === 404) {
      jobNote.textContent = "";
      renderStatus({ jobId, state: "failed", progress: 0, error: body.error || "The UI server does not know this job." });
      return;
    }
    if (!response.ok) throw new Error(body.error || "HTTP " + response.status);
    jobNote.textContent = "";
    jobNote.className = "job-note";
    renderStatus(body);
    if (terminalStates.includes(body.state)) return;
  } catch (error) {
    if (!current || current.jobId !== jobId) return;
    jobNote.className = "job-note error";
    jobNote.textContent = "Could not check status: " + error.message + ". Retrying...";
  }
  pollTimer = setTimeout(() => pollJob(jobId), 5000);
}

function startJob(job, initialState) {
  current = job;
  phase = "active";
  updateGenerate();
  resetJobView();
  jobEl.hidden = false;
  renderStatus({ jobId: job.jobId, state: initialState, progress: 0 });
  if (job.audioNote) jobAudio.textContent = job.audioNote;
  const maestro = job.maestroUrl || "";
  if (/^https?:\\/\\//.test(maestro)) {
    openMaestro.href = maestro;
    openMaestro.hidden = false;
  }
  tick();
  clockTimer = setInterval(tick, 1000);
  jobEl.scrollIntoView({ block: "nearest" });
  pollTimer = setTimeout(() => pollJob(job.jobId), initialState === "checking" ? 0 : 5000);
}

generate.addEventListener("click", async () => {
  if (generate.disabled || phase !== "idle") return;
  phase = "submitting";
  updateGenerate();
  resetJobView();
  jobEl.hidden = true;
  showAnimateStatus("Sending files to Maestro and queueing the job...");
  let response;
  try {
    response = await fetch("/api/animate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ controlVideoPath: zones.video.path, characterImagePath: zones.image.path, keepAudio: keepAudio.checked })
    });
  } catch {
    phase = "lost";
    updateGenerate();
    showAnimateStatus("Lost connection to the UI server. The job may have started; check Maestro before generating again.", "error");
    return;
  }
  const body = await response.json().catch(() => ({ error: "Unreadable response from the UI server" }));
  if (!response.ok || !body.jobId) {
    phase = "idle";
    updateGenerate();
    showAnimateStatus(body.error || "The UI server did not return a job id.", "error");
    return;
  }
  showAnimateStatus("");
  const job = { jobId: body.jobId, submittedAt: Date.now(), maestroUrl: body.maestroUrl || "", audioNote: body.audioNote || "" };
  store.set(jobKey, JSON.stringify(job));
  startJob(job, body.queued === false ? "running" : "queued");
});

cancelButton.addEventListener("click", async () => {
  if (!current || cancelButton.disabled) return;
  const jobId = current.jobId;
  cancelButton.disabled = true;
  cancelButton.textContent = "Cancelling...";
  try {
    const response = await fetch("/api/animate/cancel?id=" + encodeURIComponent(jobId), { method: "POST" });
    const body = await response.json().catch(() => ({ error: "Unreadable response from the UI server" }));
    if (!response.ok) throw new Error(body.error || "HTTP " + response.status);
    if (current && current.jobId === jobId) {
      clearTimeout(pollTimer);
      renderStatus(body);
      if (!terminalStates.includes(body.state)) pollTimer = setTimeout(() => pollJob(jobId), 5000);
    }
  } catch (error) {
    jobNote.className = "job-note error";
    jobNote.textContent = "Could not cancel: " + error.message;
  }
  cancelButton.disabled = false;
  cancelButton.textContent = "Cancel";
});

postThis.addEventListener("click", () => {
  if (!finalOutput) return;
  form.videoPath.value = finalOutput;
  selectTab(tabs[0], false);
  form.caption.focus();
});

again.addEventListener("click", () => {
  stopTimers();
  current = null;
  phase = "idle";
  resetJobView();
  jobEl.hidden = true;
  showAnimateStatus("");
  updateGenerate();
  generate.focus();
});

function showNotice(parts, tone) {
  notice.className = "notice" + (tone ? " " + tone : "");
  notice.replaceChildren(...parts);
  notice.hidden = false;
}

function code(text) {
  const element = document.createElement("code");
  element.textContent = text;
  return element;
}

function savedJob() {
  try {
    const job = JSON.parse(store.get(jobKey) || "null");
    return job && typeof job.jobId === "string" && typeof job.submittedAt === "number" ? job : null;
  } catch {
    return null;
  }
}

async function loadAnimateConfig() {
  let body;
  try {
    const response = await fetch("/api/animate/config");
    body = await response.json();
    if (!response.ok) throw new Error(body.error || "HTTP " + response.status);
  } catch (error) {
    showNotice([document.createTextNode("Could not load Animate settings: " + error.message)], "error");
    setEnabled(false);
    return;
  }
  if (!body.enabled) {
    showNotice([document.createTextNode("Set "), code("MAESTRO_URL"), document.createTextNode(" in "), code(".env"), document.createTextNode(" to enable Animate.")]);
    setEnabled(false);
    return;
  }
  if (body.maestroUrl) {
    try {
      maestroHost.textContent = "Maestro at " + new URL(body.maestroUrl).host;
      maestroHost.hidden = false;
    } catch {
      maestroHost.hidden = true;
    }
  }
  setEnabled(true);
  const job = savedJob();
  if (job) startJob(job, "checking");
}

loadAnimateConfig();
</script>
</body>
</html>
`;

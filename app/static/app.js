import { Viewer, LANDMARKS } from "/static/viewer.js?v=layout26";

const STEPS = [
  { id: "source", title: "Source", what: "the character image" },
  { id: "tpose", title: "T-pose", what: "a T-pose image" },
  { id: "mesh", title: "Mesh", what: "a textured T-pose mesh (.glb)" },
  { id: "markers", title: "Skeleton", what: "" },
  { id: "rig", title: "Rig", what: "" },
  { id: "animations", title: "Animations", what: "" },
];
// Skeleton, rig, and animation share one tab. The side panels walk the stages.
const UI_STEPS = [
  STEPS[0], STEPS[1], STEPS[2],
  { id: "rigflow", title: "Rig", what: "" },
];
const UPLOAD = { source: "image/*", tpose: "image/*", mesh: ".glb" };
const STATE_TEXT = { empty: "not done", done: "done", running: "running", queued: "queued", error: "failed" };

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "disabled") e.disabled = !!v;
    else if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) {
    if (k == null || k === false) continue;
    e.append(k);
  }
  return e;
};

const api = async (path, opts = {}) => {
  const r = await fetch("/api" + path, opts);
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(body.error || body || r.statusText);
  return body;
};

let job = null, view = "source", viewer = null, shownKey = "", pollTimer = null, lastRunning = null, serverStamp = "";
let dotsStarting = false;
const CLIENT_FIELDS = ["_libFilter", "_libHighlight", "_libExpanded", "_viewerClips", "_rigPhase", "_markerSolo", "_markerSym"];
window.studio = { get job() { return job; }, get view() { return view; }, get viewer() { return viewer; } };

function carryClient(next, prev = job) {
  if (!next || !prev || next.id !== prev.id) return next;
  for (const k of CLIENT_FIELDS) {
    if (prev[k] !== undefined) next[k] = prev[k];
  }
  return next;
}

function rigFlowState(j) {
  const markers = j.steps.markers || { state: "empty" };
  const rig = j.steps.rig || { state: "empty" };
  if (rig.state === "running" || rig.state === "queued" || rig.state === "error") return rig;
  if (markers.state === "running" || markers.state === "queued" || markers.state === "error") return markers;
  if (rig.state === "done") return rig;
  // Dots on the mesh are the start of Rig, not a finished rig.
  if (markers.state === "done") return { state: "empty", message: markers.message || "skeleton placed" };
  return { state: "empty" };
}

function uiState(j, step) {
  if (step.id === "rigflow") return rigFlowState(j);
  return j.steps[step.id];
}

function stampJob(j) {
  if (!j) return "";
  const copy = { ...j };
  for (const k of CLIENT_FIELDS) delete copy[k];
  return JSON.stringify(copy);
}

// ------------------------------------------------------------------ jobs list
async function refreshList() {
  const list = await api("/jobs");
  const box = $("jobList");
  if (!box) return;
  const top = box.scrollTop;
  box.replaceChildren(...list.map((j) => {
    const dots = el("div", { class: "dots" }, ...UI_STEPS.map((s) => el("span", { class: "dot " + uiState(j, s).state, title: s.title })));
    return el("div", { class: "jobItem" + (job && job.id === j.id ? " on" : ""), "data-id": j.id,
      onclick: () => openJob(j.id) }, j.name, dots);
  }));
  box.scrollTop = top;
}

$("newJob").onsubmit = async (e) => {
  e.preventDefault();
  const j = await api("/jobs", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: $("newName").value }) });
  $("newName").value = "";
  await openJob(j.id, "source");
};

async function openJob(id, step) {
  job = carryClient(await api("/jobs/" + id));
  shownKey = "";
  view = step || firstOpenStep(job);
  $("empty").hidden = true; $("job").hidden = false;
  render();
  refreshList();
  schedulePoll();
}

function firstOpenStep(j) {
  for (const id of ["source", "tpose", "mesh"]) {
    if (j.steps[id].state !== "done") return id;
  }
  return "rigflow";
}

$("deleteJob").onclick = async () => {
  if (!job || !confirm(`Delete "${job.name}" and all its files?`)) return;
  try { await api("/jobs/" + job.id, { method: "DELETE" }); } catch (e) { return alert(e.message); }
  job = null; disposeViewer(); $("job").hidden = true; $("empty").hidden = false; refreshList();
};
$("openFolder").onclick = () => job && api(`/jobs/${job.id}/open`, { method: "POST" });

// ------------------------------------------------------------------ polling
function busy(j) { return j && Object.values(j.steps).some((s) => s.state === "running" || s.state === "queued"); }
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, busy(job) ? 1500 : 6000);
}
async function poll() {
  if (job) {
    try {
      const prevRig = job.steps.rig.state;
      const next = carryClient(await api("/jobs/" + job.id));
      const runId = ["source", "tpose", "mesh", "markers", "rig"].find((id) => next.steps[id].state === "running");
      const followView = runId === "markers" || runId === "rig" ? "rigflow" : runId;
      const follow = followView && followView !== lastRunning;
      if (follow) {
        lastRunning = followView;
        view = followView;
        if (followView === "rigflow") next._rigPhase = "dots";
      }
      if (prevRig === "running" && next.steps.rig.state === "done") {
        next._rigPhase = "play";
        view = "rigflow";
        shownKey = "";
      }
      // Same server payload: keep the sidebar, gallery scroll, and any slider drag.
      if (!follow && stampJob(next) === serverStamp) job = next;
      else { job = next; render(); }
    } catch (e) { /* job deleted */ }
  }
  refreshList();
  schedulePoll();
}

// ------------------------------------------------------------------ actions
function ensureDots() {
  if (dotsStarting || !job || view !== "rigflow" || job._rigPhase === "play") return;
  if (!job.files.mesh || job.markers) return;
  const st = job.steps.markers;
  if (!st || st.state !== "empty" || !st.can_run || busy(job)) return;
  dotsStarting = true;
  runStep("markers", false).finally(() => { dotsStarting = false; });
}

async function runStep(step, chain) {
  try { job = carryClient(await api(`/jobs/${job.id}/run/${step}${chain ? "?chain=1" : ""}`, { method: "POST" })); }
  catch (e) { return alert(e.message); }
  render(); refreshList(); schedulePoll();
}
function rebind() {
  job._rigPhase = "dots";
  shownKey = "";
  runStep("rig", false);
}
async function resetMarkers() {
  try {
    await api(`/jobs/${job.id}/markers`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset: true }) });
    job = carryClient(await api("/jobs/" + job.id));
    job._rigPhase = "dots";
    job._markerSolo = [];
    shownKey = "";
    render();
    refreshList();
  } catch (e) { alert(e.message); }
}
async function cancelStep() {
  try { await api(`/jobs/${job.id}/cancel`, { method: "POST" }); }
  catch (e) { return alert(e.message); }
  setTimeout(poll, 300);
}

function pickFile(step) {
  const inp = $("filePick");
  inp.accept = UPLOAD[step];
  inp.value = "";
  inp.onchange = () => inp.files[0] && upload(step, inp.files[0]);
  inp.click();
}
async function upload(step, file) {
  $("status").replaceChildren(el("span", {}, `uploading ${file.name}…`));
  try { job = carryClient(await api(`/jobs/${job.id}/upload/${step}`, { method: "POST", body: await file.arrayBuffer() })); }
  catch (e) { return alert(e.message); }
  shownKey = ""; view = step; render(); refreshList(); schedulePoll();
}

async function showLog(step) {
  $("logText").textContent = (await api(`/jobs/${job.id}/log/${step}`)) || "(no log yet)";
  $("logDlg").showModal();
}

// ------------------------------------------------------------------ render
const OWNER = { "source.png": "source", "tpose.png": "tpose", "mesh.glb": "mesh", "markers.json": "markers",
  "animations.json": "animations" };
function version(step) { const s = job.steps[step] || {}; return s.state === "done" ? (s.updated || "") : s.state; }
function fileUrl(path) {
  let step = OWNER[path] || "rig";
  if (path.startsWith("rig/poses/")) step = "rig";
  if (path.startsWith("export/")) step = job.files.animations ? "animations" : "rig";
  return `/api/jobs/${job.id}/file/${path}?v=${encodeURIComponent(version(step))}`;
}

function render() {
  if (!job) return;
  serverStamp = stampJob(job);
  $("jobName").textContent = job.name;
  $("steps").replaceChildren(...UI_STEPS.map((s, i) => {
    const st = uiState(job, s);
    return el("button", { class: `step ${st.state}${view === s.id ? " on" : ""}`, "data-step": s.id,
      onclick: () => { view = s.id; render(); } },
      el("div", { class: "n" }, `Step ${i + 1}`), el("div", { class: "t" }, s.title),
      el("div", { class: "s" }, STATE_TEXT[st.state]));
  }));
  renderStatus();
  renderView();
  renderSide();
  ensureDots();
}

function busyStep() {
  const id = ["source", "tpose", "mesh", "markers", "rig"].find((s) => {
    const st = job.steps[s];
    return st && (st.state === "running" || st.state === "queued");
  });
  if (!id) return null;
  if (id === "markers" || id === "rig") return { id: "rigflow", title: "Rig", _src: id };
  return UI_STEPS.find((s) => s.id === id);
}

function renderStatus() {
  const st = view === "rigflow" ? rigFlowState(job) : job.steps[view];
  const parts = [];
  const running = busyStep();
  if (running) {
    const rst = job.steps[running._src || running.id];
    parts.push(
      el("span", {}, `${running.title}: ${STATE_TEXT[rst.state]}${rst.message ? " — " + rst.message : ""}`),
      el("a", { onclick: cancelStep }, "Cancel"),
    );
  } else if (st.state === "error") {
    parts.push(el("span", { class: "err" }, st.message || "failed"));
  } else if (st.message) {
    parts.push(el("span", {}, st.message));
  }
  if (view === "rigflow") parts.push(el("a", { onclick: () => showLog(job.steps.rig.state === "empty" ? "markers" : "rig") }, "Log"));
  else if (view !== "source") parts.push(el("a", { onclick: () => showLog(view) }, "Log"));
  $("status").replaceChildren(...parts);
}

function disposeViewer() {
  if (viewer) { viewer.dispose(); viewer = null; }
  if (window.__viewer) window.__viewer = null;
}

function meshFillPct() {
  const st = job.steps.mesh;
  if (st.state === "done") return 100;
  // Never show a full body while Comfy is still going (old progress:1 used to stick).
  if (typeof st.progress === "number") return Math.max(3, Math.min(96, Math.round(st.progress * 100)));
  if (st.state === "queued") return 3;
  if (st.state === "running") return 6;
  return 0;
}

function updateMeshFill() {
  const wrap = $("view") && $("view").querySelector(".meshFill");
  if (!wrap) return false;
  const pct = meshFillPct();
  const label = job.steps.mesh.phase || job.steps.mesh.message || "building the mesh";
  const clip = wrap.querySelector(".meshFillClip");
  const bar = wrap.querySelector(".meshFillBar > div");
  const text = wrap.querySelector(".meshFillLabel");
  if (clip) clip.style.setProperty("--fill", pct + "%");
  if (bar) bar.style.width = pct + "%";
  if (text) text.textContent = label;
  return true;
}

function meshFillView(box) {
  const pct = meshFillPct();
  const label = job.steps.mesh.phase || job.steps.mesh.message || "building the mesh";
  const wrap = el("div", { class: "meshFill" });
  const stack = el("div", { class: "meshFillStack" });
  // Ghost + fill are the same T-pose (or SVG fallback), clipped feet→head.
  if (job.files.tpose) {
    const src = fileUrl("tpose.png");
    stack.append(
      el("div", { class: "meshFillGhost" }, el("img", { src, alt: "" })),
      el("div", { class: "meshFillClip", style: `--fill:${pct}%` }, el("img", { src, alt: "" })),
    );
  } else {
    stack.append(
      el("div", { class: "meshFillGhost svg" }, bodySilhouette()),
      el("div", { class: "meshFillClip svg", style: `--fill:${pct}%` }, bodySilhouette(true)),
    );
  }
  wrap.append(stack, el("div", { class: "meshFillLabel" }, label),
    el("div", { class: "meshFillBar" }, el("div", { style: `width:${pct}%` })));
  box.append(wrap);
}

function bodySilhouette(filled) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 200");
  svg.setAttribute("class", filled ? "sil fill" : "sil");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // Simple T-pose body: head, torso, arms out, legs
  path.setAttribute("d",
    "M60 8c9 0 16 7 16 16s-7 16-16 16-16-7-16-16 7-16 16-16zm-14 36h28c10 0 16 8 16 18v36c0 6-3 11-8 14v48c0 8-5 14-12 14h-8c-7 0-12-6-12-14v-28h-4v28c0 8-5 14-12 14h-8c-7 0-12-6-12-14v-48c-5-3-8-8-8-14V62c0-10 6-18 16-18zm-30 14h18v14H16c-4 0-6-3-6-7v0c0-4 3-7 6-7zm56 0h18c3 0 6 3 6 7v0c0 4-3 7-6 7H86V58z");
  path.setAttribute("fill", filled ? "currentColor" : "#3a4250");
  svg.append(path);
  return svg;
}

function applyMarkerView() {
  if (!viewer || viewer.mode !== "markers" || !viewer.ready) return;
  const mk = job.markers;
  if (!mk || !mk.joints) return;
  const rev = (job.steps.markers && job.steps.markers.updated) || "placed";
  if (viewer._dotsRev === rev) return;
  viewer._dotsRev = rev;
  viewer.setLandmarks(mk.joints, mk.height, mk.joints_off_body || [], mk.off_body || [], job._markerSolo || [], job._markerSym !== false);
}

function renderView() {
  const box = $("view");
  const playing = view === "rigflow" && job._rigPhase === "play" && !!job.files.rig;
  const has = view === "rigflow" ? !!job.files.mesh : !!job.files[view];
  const meshSt = job.steps.mesh;
  const meshBusy = view === "mesh" && (meshSt.state === "running" || meshSt.state === "queued");
  // Keep the status scene mounted; only patch fill/label so WebView2 isn't rebuilt every tick.
  const viewKey = `${view}|${has}|${playing ? "play" : "dots"}|${version(playing ? "rig" : view === "rigflow" ? "mesh" : view)}|${view === "rigflow" ? (job.steps.markers.started || "") : ""}|${meshBusy ? "mesh-fill" : ""}`;
  if (viewKey === shownKey) {
    if (meshBusy) updateMeshFill();
    applyMarkerView();
    return;
  }
  shownKey = viewKey;
  disposeViewer();
  box.replaceChildren();
  box.ondragover = box.ondrop = box.ondragleave = null;
  if (UPLOAD[view]) {
    box.ondragover = (e) => { e.preventDefault(); box.classList.add("dragover"); };
    box.ondragleave = () => box.classList.remove("dragover");
    box.ondrop = (e) => { e.preventDefault(); box.classList.remove("dragover"); e.dataTransfer.files[0] && upload(view, e.dataTransfer.files[0]); };
  }
  if (meshBusy) {
    meshFillView(box);
    return;
  }
  if (!has) {
    const st = UI_STEPS.find((s) => s.id === view);
    box.append(el("div", { class: "drop" },
      view === "rigflow" ? "Build a mesh first. The dots go on that mesh."
        : UPLOAD[view] ? `Drop ${st.what} here, or use the buttons on the right.` : "Nothing here yet."));
    return;
  }
  if (view === "source" || view === "tpose") {
    box.append(el("img", { src: fileUrl(job.files[view]), alt: view }));
  } else if (view === "mesh") {
    viewer = new Viewer(box, "orbit");
    viewer.load(fileUrl("mesh.glb"));
  } else if (view === "rigflow") {
    if (playing) {
      const sel = (job.anim_settings && job.anim_settings.selected) || "walk";
      viewer = new Viewer(box, "anim", { hideClipBar: true, studioDock: true, startClip: sel });
      window.__viewer = viewer;
      viewer.onKeyFrame = () => keyCurrentFrame();
      viewer.onClipChange = (name) => {
        if (!name || name === selectedClipId()) return;
        selectAnim(name, true);
      };
      viewer.load(fileUrl("rig/rigged_animated.glb")).then(() => {
        job._viewerClips = (viewer.info && viewer.info.clips) || [];
        const clip = job.anim_settings && job.anim_settings.clips[sel];
        if (clip) {
          viewer.setTimeScale(clip.speed || 1);
          if (clip.fit) viewer.setFit(clip.fit);
        }
        const playable = sel && viewer.actions[sel] ? sel
          : (job._viewerClips.find((n) => viewer.actions[n]) || job._viewerClips[0]);
        if (playable) viewer.play(playable);
        viewer._notifyClip = true;
        mountAnimFitOverlay();
        renderSide();
      });
    } else {
      viewer = new Viewer(box, "markers");
      viewer.onJointsChanged = saveJoints;
      viewer.onMarkersChanged = saveMarkers;
      viewer.load(fileUrl("mesh.glb")).then(() => {
        const mk = job.markers || {};
        if (mk.joints) {
          viewer._dotsRev = "";
          applyMarkerView();
        } else if (mk.markers) {
          viewer.setMarkers(mk.markers, mk.off_body || []);
        }
      });
    }
  }
}

async function saveMarkers(markers) {
  try {
    const r = await api(`/jobs/${job.id}/markers`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markers }) });
    applySkeletonResponse(r);
    job = carryClient(await api("/jobs/" + job.id));
    if (viewer) viewer._dotsRev = (job.steps.markers && job.steps.markers.updated) || "placed";
    render(); refreshList();
  } catch (e) { alert(e.message); }
}

async function saveJoints(joints) {
  try {
    const r = await api(`/jobs/${job.id}/markers`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joints }) });
    applySkeletonResponse(r);
    job = carryClient(await api("/jobs/" + job.id));
    if (viewer) viewer._dotsRev = (job.steps.markers && job.steps.markers.updated) || "placed";
    render(); refreshList();
  } catch (e) { alert(e.message); }
}

function applySkeletonResponse(r) {
  if (!job || !job.markers) return;
  if (r.joints) job.markers.joints = r.joints;
  if (r.markers) job.markers.markers = r.markers;
  job.markers.off_body = r.off_body || [];
  job.markers.joints_off_body = r.joints_off_body || [];
  if (viewer) viewer._dotsRev = "";
  applyMarkerView();
}

function card(title, ...kids) { return el("div", { class: "card" }, el("h3", {}, title), ...kids.filter(Boolean)); }

function runCard(step, label) {
  const st = job.steps[step];
  const active = st.state === "running" || st.state === "queued";
  const anyBusy = busy(job);
  const i = STEPS.findIndex((s) => s.id === step);
  const blocked = !st.can_run;
  const row = [
    el("button", { disabled: blocked || active || anyBusy, onclick: () => runStep(step, false), id: `run_${step}` }, job.files[step] ? "Run again" : "Run"),
    el("button", { class: "ghost", disabled: blocked || active || anyBusy, onclick: () => runStep(step, true), id: `chain_${step}` }, "Run to the end"),
  ];
  if (active) {
    row.push(el("button", { class: "ghost danger", id: `cancel_${step}`, onclick: cancelStep },
      st.message === "cancelling…" ? "Cancelling…" : "Cancel"));
  }
  return card(label,
    el("p", {}, blocked ? (job.steps[STEPS[i - 1].id].state === "error"
      ? `${STEPS[i - 1].title} failed — fix or replace it first.` : `Needs ${STEPS[i - 1].title} first.`) : (job.files[step] ? "Running again replaces this result and clears the steps after it." : "")),
    el("div", { class: "row" }, ...row));
}

const MESH_TRIS = { min: 8000, max: 80000, step: 1000, optimized: 60000, simple: 12000 };

function tposeSettings() {
  return job.tpose_settings || { method: "standard", prompt: "" };
}

async function runEverything() {
  const ts = tposeSettings();
  const ta = $("tposePrompt");
  const prompt = ta ? ta.value : null;
  const range = $("meshTris");
  const tris = range ? Number(range.value) : null;
  if (prompt != null && ts.method === "custom") {
    await saveTposeSettings({ method: "custom", prompt });
  }
  if (tris && tris !== Number(meshSettings().target_tris)) {
    await saveMeshSettings({ target_tris: tris });
  }
  runStep("tpose", true);
}

async function saveTposeSettings(payload) {
  try {
    job.tpose_settings = await api(`/jobs/${job.id}/tpose-settings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    renderSide();
  } catch (e) { alert(e.message); }
}

function tposeMethodCard() {
  const ts = tposeSettings();
  const locked = busy(job);
  const btn = (id, text) => el("button", {
    class: "ghost" + (ts.method === id ? " on" : ""),
    disabled: locked, id: `tposeMethod_${id}`,
    onclick: () => saveTposeSettings({ method: id }),
  }, text);
  const kids = [
    el("p", {}, "Standard is the Studio prompt. 2.5D uses your Desktop Qwen edit + larger output. Custom lets you edit the prompt."),
    el("div", { class: "row" },
      btn("standard", "Standard"),
      btn("2_5d", "2.5D"),
      btn("custom", "Custom prompt")),
  ];
  if (ts.method === "custom") {
    const ta = document.createElement("textarea");
    ta.id = "tposePrompt";
    ta.rows = 8;
    ta.disabled = locked;
    ta.value = ts.prompt || "";
    ta.placeholder = "Qwen edit prompt…";
    ta.onchange = () => saveTposeSettings({ method: "custom", prompt: ta.value });
    kids.push(ta);
  } else {
    kids.push(el("p", {}, ts.method === "2_5d"
      ? "Desktop 2.5D statue/diorama prompt; output scaled up for mesh."
      : "Identity-preserving T-pose prompt."));
  }
  return card("T-pose method", ...kids);
}

const MESH_SEED_DEFAULT = 156863899;

function meshSettings() {
  return job.mesh_settings || {
    preset: "optimized", target_tris: MESH_TRIS.optimized,
    seed_mode: "default", seed: MESH_SEED_DEFAULT,
  };
}

async function saveMeshSettings(payload) {
  try {
    job.mesh_settings = await api(`/jobs/${job.id}/mesh-settings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    renderSide();
  } catch (e) { alert(e.message); }
}

function meshQualityCard() {
  const ms = meshSettings();
  const locked = busy(job);
  const label = el("div", { class: "meshTrisLabel" }, `${Math.round(ms.target_tris / 1000)}k triangles`);
  const range = el("input", {
    type: "range", id: "meshTris", min: String(MESH_TRIS.min), max: String(MESH_TRIS.max),
    step: String(MESH_TRIS.step), value: String(ms.target_tris), disabled: locked,
  });
  range.oninput = () => {
    label.textContent = `${Math.round(Number(range.value) / 1000)}k triangles`;
  };
  range.onchange = () => saveMeshSettings({ target_tris: Number(range.value) });
  const presetBtn = (id, text, tris) => el("button", {
    class: "ghost" + (ms.target_tris === tris ? " on" : ""),
    disabled: locked, id: `meshPreset_${id}`,
    onclick: () => saveMeshSettings({ preset: id, target_tris: tris }),
  }, text);
  return card("Low-poly detail",
    el("p", {}, "Optimized is the AF-clean default. Simple is for plainer characters."),
    el("div", { class: "row" },
      presetBtn("optimized", "Optimized · 60k", MESH_TRIS.optimized),
      presetBtn("simple", "Simple · 12k", MESH_TRIS.simple)),
    label, range,
    el("div", { class: "meshTrisScale" }, el("span", {}, "8k"), el("span", {}, "80k")));
}

function meshSeedCard() {
  const ms = meshSettings();
  const locked = busy(job);
  const mode = ms.seed_mode || "default";
  const btn = (id, text) => el("button", {
    class: "ghost" + (mode === id ? " on" : ""),
    disabled: locked, id: `meshSeed_${id}`,
    onclick: () => saveMeshSettings({
      seed_mode: id,
      seed: id === "default" ? MESH_SEED_DEFAULT : (ms.seed || MESH_SEED_DEFAULT),
    }),
  }, text);
  const kids = [
    el("p", {}, "Shape seed for Trellis sparse gen. Default is the green-girl Desktop value."),
    el("div", { class: "row" },
      btn("default", "Default"),
      btn("random", "Random"),
      btn("lock", "Lock seed")),
  ];
  if (mode === "lock") {
    const inp = el("input", {
      type: "number", id: "meshSeedValue", min: "0", max: String(2147483647),
      value: String(ms.seed ?? MESH_SEED_DEFAULT), disabled: locked,
    });
    inp.onchange = () => saveMeshSettings({ seed_mode: "lock", seed: Number(inp.value) });
    kids.push(el("label", { class: "meshSeedField" }, "Seed", inp));
  } else if (mode === "random") {
    kids.push(el("p", {}, "A new seed is picked each mesh run. Last used seed is saved on the step."));
  } else {
    kids.push(el("p", {}, `Using ${MESH_SEED_DEFAULT}.`));
  }
  const used = job.steps.mesh && job.steps.mesh.seed;
  if (used != null && (job.steps.mesh.state === "done" || job.steps.mesh.state === "running")) {
    kids.push(el("p", {}, `Last run seed: ${used}`));
  }
  return card("Shape seed", ...kids);
}

function uploadCard(step) {
  const st = STEPS.find((s) => s.id === step);
  return card("Use your own", el("p", {}, `Start here with ${st.what}. Later steps are cleared.`),
    el("div", { class: "row" }, el("button", { class: "ghost", disabled: busy(job), onclick: () => pickFile(step), id: `upload_${step}` }, "Choose file…")));
}

function renderSide() {
  const side = $("side2");
  if (!side) return;
  const sideScroll = side.scrollTop;
  const lib = document.getElementById("animLibList");
  const libScroll = lib ? lib.scrollTop : 0;
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : "";
  const caret = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
  const k = [];
  if (view === "source") {
    k.push(uploadCard("source"));
    if (job.files.source) {
      k.push(tposeMethodCard(), meshQualityCard(), card("Next",
        el("p", {}, "Run everything uses the T-pose method and low-poly detail above, builds the mesh, and places the dots. Move the dots on the Rig tab, then Bind & wear."),
        el("div", { class: "row" }, el("button", { disabled: busy(job), onclick: runEverything, id: "chain_all" }, "Run everything"))));
    }
  } else if (view === "tpose") {
    const method = (job.tpose_settings && job.tpose_settings.method) || "standard";
    const runLabel = method === "2_5d" ? "Generate T-pose (2.5D)"
      : method === "custom" ? "Generate T-pose (custom prompt)"
      : "Generate T-pose (standard)";
    k.push(tposeMethodCard(), runCard("tpose", runLabel), uploadCard("tpose"));
  } else if (view === "mesh") {
    k.push(meshQualityCard(), meshSeedCard(), runCard("mesh", "Generate mesh (LowPoly UltraTex)"), uploadCard("mesh"));
    if (job.mesh_check) k.push(meshCheckCard(job.mesh_check));
    if (job.export) k.push(exportCard());
  } else if (view === "rigflow") {
    if (!job.files.mesh) {
      k.push(card("Rig", el("p", {}, "Build a mesh first. The dots go on that mesh.")));
    } else if (job._rigPhase === "play" && job.files.rig) {
      k.push(card("Markers",
        el("p", {}, "Reset the dots, move them on the mesh, then rebind. Unlock a hip to shape the V, and leave Symmetrical on so the other side matches."),
        el("div", { class: "row" },
          el("button", { onclick: () => { job._rigPhase = "dots"; shownKey = ""; render(); } }, "Adjust markers"),
          el("button", { class: "ghost", disabled: busy(job), onclick: resetMarkers }, "Reset markers"),
          el("button", { disabled: busy(job), onclick: rebind }, "Rebind"))));
      k.push(card("Rings",
        el("p", {}, "Rings sit on the joints. Turn them off to see the mesh."),
        el("div", { class: "row" }, el("button", {
          class: "ghost" + (viewer && viewer._skelVisible !== false ? " on" : ""),
          disabled: !viewer,
          onclick: () => {
            if (!viewer || !viewer.setSkeletonVisible) return;
            viewer.setSkeletonVisible(!viewer._skelVisible);
            renderSide();
          },
        }, viewer && viewer._skelVisible === false ? "Show rings" : "Hide rings"))));
      k.push(animationsCard());
      const rep = job.rig_report;
      if (rep && rep.steps && rep.steps.deform_qa) k.push(qaCard(rep.steps.deform_qa));
      if (job.export) k.push(exportCard());
    } else {
      k.push(card("Dots",
        el("p", {}, job.markers
          ? "Orange dots scale the skeleton. Unlock a white dot to move it alone. Symmetrical mirrors the other side."
          : "Opening this tab places the first dots on the mesh."),
        el("div", { class: "row" }, el("button", {
          disabled: busy(job) || !job.steps.markers.can_run,
          onclick: () => runStep("markers", false),
        }, job.markers ? "Place dots again" : "Place dots"))));
      if (job.markers) k.push(markersCard(job.markers));
      const st = job.steps.rig;
      if (st.state === "running" || st.state === "queued") {
        k.push(card("Bind & wear",
          el("p", {}, st.message || "Weighting the mesh to the skeleton."),
          el("div", { class: "row" }, el("button", { class: "ghost danger", id: "cancel_rig", onclick: cancelStep },
            st.message === "cancelling…" ? "Cancelling…" : "Cancel"))));
      } else if (job.files.rig) {
        k.push(card("Play",
          el("p", {}, "The last bind is ready. Play it, or move the dots and bind again."),
          el("div", { class: "row" }, el("button", { onclick: () => {
            job._rigPhase = "play"; shownKey = ""; render();
          } }, "Play the character"))));
      }
    }
  }
  side.replaceChildren(...k);
  side.scrollTop = sideScroll;
  const libNow = document.getElementById("animLibList");
  if (libNow) libNow.scrollTop = libScroll;
  if (focusId) {
    const again = document.getElementById(focusId);
    if (again) {
      again.focus();
      if (caret != null && again.setSelectionRange) {
        const pos = Math.min(caret, (again.value || "").length);
        again.setSelectionRange(pos, pos);
      }
    }
  }
}

function exportCard() {
  const tip = {
    "mesh_for_mixamo.fbx": "Mixamo → Upload Character (auto-rig)",
    "mesh_for_actionforge.glb": "Action Forge → import unrigged (auto-rig)",
    "rigged_animated.glb": "Action Forge → + Rigged character; also Blender / viewers",
    "rigged_animated.fbx": "Unity / Unreal / Action Forge + Rigged",
    "README.txt": "which file to use where",
  };
  return card("Export",
    el("p", {}, "Hand-off files in the character’s export folder."),
    ...job.export.map((n) => el("div", { class: "check" },
      el("span", { class: "mark ok" }, "✓"),
      el("span", {}, tip[n] ? `${n} — ${tip[n]}` : n))),
    el("div", { class: "row" },
      el("button", { class: "ghost", onclick: () => api(`/jobs/${job.id}/open`, { method: "POST" }) }, "Open folder")));
}

function meshCheckCard(mc) {
  return card(mc.ok ? "Mesh check: riggable" : "Mesh check: not riggable",
    ...mc.checks.map((c) => el("div", { class: "check" },
      el("span", { class: "mark " + (c.ok ? "ok" : c.name === "textured" ? "" : "bad") }, c.ok ? "✓" : "✗"),
      el("span", {}, `${c.name}: ${c.detail}`))));
}

function markersCard(src) {
  const off = src.off_body || [];
  const joff = src.joints_off_body || [];
  const solo = new Set(job._markerSolo || []);
  const blocked = off.length + joff.length;
  const label = (spec) => spec.side ? `${spec.side === "l" ? "L" : "R"} ${spec.label}` : spec.label;
  const bound = !!job.files.rig;
  const symBox = el("input", {
    type: "checkbox",
    title: "Moving one side mirrors the other",
    onchange: (e) => {
      job._markerSym = e.target.checked;
      if (viewer && viewer.setSym) viewer.setSym(job._markerSym);
    },
  });
  symBox.checked = job._markerSym !== false;
  return card("Dots",
    el("div", { class: "row" },
      el("button", { class: "ghost", disabled: busy(job), id: "resetMarkers", onclick: resetMarkers }, "Reset markers"),
      el("button", { disabled: blocked > 0 || busy(job) || !job.files.mesh, id: "rigFromMarkers",
        onclick: rebind }, bound ? "Rebind" : "Bind & wear"),
      el("label", { class: "check" }, symBox, "Symmetrical")),
    el("p", {}, "The groin is the bottom of the hip V. Unlock a white dot to move that hip, knee, or elbow on its own. With Symmetrical on, the other side mirrors it. Red is off the body, and binding stays locked until every dot is on the mesh."),
    ...LANDMARKS.filter((spec) => src.joints && src.joints[spec.joints[0]]).map((spec) => {
      const bad = joff.includes(spec.joints[0]) || (spec.marker && off.includes(spec.marker));
      let tick = null;
      if (spec.tone === "follow") {
        tick = el("input", {
          type: "checkbox",
          title: "Unlock this dot",
          onchange: (e) => {
            const next = new Set(job._markerSolo || []);
            if (e.target.checked) next.add(spec.id);
            else next.delete(spec.id);
            job._markerSolo = [...next];
            if (viewer && viewer.setSolo) viewer.setSolo(job._markerSolo);
            renderSide();
          },
        });
        tick.checked = solo.has(spec.id);
      }
      return el("div", { class: "check" },
        tick,
        el("span", { class: "mark " + (bad ? "bad" : "ok") }, bad ? "✗" : "✓"),
        el("span", {}, label(spec) + (spec.tone === "follow" ? (solo.has(spec.id) ? " — unlocked" : " — locked") : "")));
    }),
  );
}

function onCharClips() {
  const avail = new Set([...(job.anim_available || []), ...(job._viewerClips || [])]);
  let cats = (job.anim_clips || []).filter((c) => !avail.size || avail.has(c.id));
  if (job._viewerClips && job._viewerClips.length) {
    cats = cats.filter((c) => job._viewerClips.includes(c.id));
  }
  return cats;
}

function selectedClipId() {
  const settings = job.anim_settings || { selected: "walk", clips: {} };
  const cats = onCharClips();
  const onChar = new Set(cats.map((c) => c.id));
  if (onChar.has(settings.selected) || (!onChar.size && settings.selected)) return settings.selected;
  return (cats[0] && cats[0].id) || settings.selected;
}

function previewMedia(previewUrl, label) {
  if (previewUrl) {
    const v = document.createElement("video");
    v.src = previewUrl; v.muted = true; v.loop = true; v.playsInline = true;
    v.autoplay = true; v.preload = "metadata";
    return el("div", { class: "animTileMedia" }, v);
  }
  return el("div", { class: "animTilePlaceholder" }, el("span", {}, (label || "?").slice(0, 1).toUpperCase()));
}

function mountAnimFitOverlay() {
  const box = $("view");
  if (!box) return;
  const active = document.activeElement;
  if (active && active.closest && active.closest("#animFitOverlay")) return;
  const old = box.querySelector(".animFitOverlay");
  if (old) old.remove();
  if (view !== "rigflow" || job._rigPhase !== "play" || !job.files.rig) return;
  const settings = job.anim_settings || { clips: {} };
  const selected = selectedClipId();
  const cats = onCharClips();
  if (job.files.rig && !cats.length) return;
  const selMeta = (settings.clips && settings.clips[selected]) || { enabled: true, speed: 1, fit: {} };
  const fit = selMeta.fit || {};
  const liveFit = {
    hip: fit.hip ?? 0,
    arms: fit.arms ?? 1,
    legs: fit.legs ?? 1,
    arm_space: fit.arm_space ?? fit.arm_raise ?? 0,
    arm_fwd: fit.arm_fwd ?? 0,
    turn: fit.turn ?? 0,
  };
  const fps = 30;
  const dur = (viewer && viewer.clipDuration && viewer.clipDuration()) || Number(selMeta.duration) || 2;
  const frameCount = Math.max(1, Math.round(dur * fps));
  const curFrame = viewer && viewer.clipTime ? Math.round(viewer.clipTime() * fps) + 1 : 1;
  const label = (selMeta.label || selected).replace(/_/g, " ").replace(/-/g, " ");

  const pushFit = (patch) => {
    Object.assign(liveFit, patch);
    if (viewer) {
      viewer.setFit(liveFit);
      // Keep the clip playing while reshaping — Mixamo Arm-Space behavior.
      if (viewer.resumePlay) viewer.resumePlay();
    }
  };

  const fitSlider = (key, title, min, max, step, val, fmt) => {
    const lab = el("span", {}, title + " ", el("span", { id: `fitVal_${key}` }, fmt(val)));
    const inp = el("input", {
      type: "range", min, max, step, value: String(val), id: `fit_${key}`,
      oninput: (e) => {
        const v = Number(e.target.value);
        const node = $(`fitVal_${key}`); if (node) node.textContent = fmt(v);
        pushFit({ [key]: v });
      },
      onchange: () => { if (job.files.rig) saveAnimPatch(selected, { fit: { ...liveFit } }); },
    });
    return el("div", { class: "meshSeedField" }, lab, inp);
  };

  const includeBox = el("input", {
    type: "checkbox", id: "animEnabled",
    onchange: (e) => { if (job.files.rig) saveAnimPatch(selected, { enabled: e.target.checked }); },
  });
  includeBox.checked = selMeta.enabled !== false;

  const ov = el("div", { class: "animFitOverlay", id: "animFitOverlay" },
    el("h3", {}, label),
    el("label", { class: "animInclude" }, includeBox, " Include in export"),
    el("div", { class: "meshSeedField" },
      el("span", {}, "Frame ", el("span", { id: "animFrameVal" }, String(Math.min(frameCount, Math.max(1, curFrame))))),
      el("input", {
        type: "range", min: "1", max: String(frameCount), step: "1",
        value: String(Math.min(frameCount, Math.max(1, curFrame))), id: "animScrub",
        oninput: (e) => {
          const fr = Number(e.target.value);
          const label = $("animFrameVal");
          if (label) label.textContent = String(fr);
          if (viewer) viewer.scrubTo((fr - 1) / fps);
        },
      })),
    el("div", { class: "meshSeedField" },
      el("span", {}, "Speed ", el("span", { id: "animSpeedVal" }, `${Number(selMeta.speed || 1).toFixed(2)}×`)),
      el("input", {
        type: "range", min: "0.25", max: "2", step: "0.05",
        value: String(selMeta.speed || 1), id: "animSpeed",
        oninput: (e) => {
          const v = Number(e.target.value);
          const label = $("animSpeedVal");
          if (label) label.textContent = `${v.toFixed(2)}×`;
          if (viewer) viewer.setTimeScale(v);
        },
        onchange: (e) => { if (job.files.rig) saveAnimPatch(selected, { speed: Number(e.target.value) }); },
      })),
    el("h3", {}, "Character"),
    el("p", { class: "hint" }, "Fit to character. Arm-Space and Arms ↔ are live degree offsets on the upper arms."),
    fitSlider("arm_space", "Arm-Space °", "-120", "120", "1", liveFit.arm_space, (v) => `${Math.round(v)}°`),
    fitSlider("arm_fwd", "Arms ↔ °", "-120", "120", "1", liveFit.arm_fwd, (v) => `${Math.round(v)}°`),
    fitSlider("arms", "Overdrive", "0", "1.5", "0.05", liveFit.arms, (v) => `${Math.round(v * 50)}`),
    fitSlider("legs", "Stance", "0", "1.5", "0.05", liveFit.legs, (v) => `${Math.round(v * 50)}`),
    fitSlider("hip", "Hip height", "-0.12", "0.12", "0.005", liveFit.hip, (v) => v.toFixed(3)),
    fitSlider("turn", "Turn °", "-30", "30", "1", liveFit.turn, (v) => `${Math.round(v)}°`),
    el("div", { class: "row" },
      el("button", { class: "ghost", onclick: () => {
        const cleared = { hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0 };
        Object.assign(liveFit, cleared);
        if (job.files.rig) saveAnimPatch(selected, { fit: cleared });
        if (viewer) viewer.setFit(cleared);
        mountAnimFitOverlay();
      } }, "Reset fit")),
  );
  box.append(ov);
}

const DEMO_CLIPS = ["idle-subtle", "walk", "jog", "jump-2", "greeting", "crouch-idle"];

function previewDemoClip(clip) {
  const id = clip && clip.id;
  if (!id) return;
  job._libHighlight = id;
  job._demoClip = id;
  if (viewer && view === "animations") {
    viewer.load(libraryUrl(id)).then(() => {
      job._viewerClips = (viewer.info && viewer.info.clips) || [];
      const playable = (viewer.info && viewer.info.clips || []).find((n) => viewer.actions[n]);
      if (playable) viewer.play(playable);
      mountAnimFitOverlay();
    });
  } else if (view !== "animations") {
    view = "animations";
    shownKey = "";
    render();
    return;
  }
  renderSide();
}

function animationsCard() {
  const demo = false;
  const settings = job.anim_settings || { selected: "walk", clips: {} };
  const onCharCatalog = onCharClips();
  const onChar = new Set(onCharCatalog.map((c) => c.id));
  const libAll = job.motion_library || [];
  const libFilter = (job._libFilter || "").trim().toLowerCase();
  let libShown = demo ? libAll.slice() : libAll.filter((c) => !onChar.has(c.id));
  if (libFilter) {
    libShown = libShown.filter((c) =>
      (c.label || c.id).toLowerCase().includes(libFilter) || c.id.toLowerCase().includes(libFilter));
  }
  const selected = selectedClipId();
  const busyAnim = busy(job) || (job.steps.animations && job.steps.animations.state === "running");
  const hasOnChar = onCharCatalog.length > 0;
  const libById = Object.fromEntries(libAll.map((c) => [c.id, c]));
  const expandedFam = job._libExpanded || {};

  // 1) On-character chips, or a short demo set that plays on the mannequin
  const chips = el("div", { class: "animChipList" });
  const demoChips = demo
    ? DEMO_CLIPS.map((id) => libById[id]).filter(Boolean)
    : [];
  if (!demo && !hasOnChar) {
    chips.append(el("p", { class: "hint" }, "No clips on this character yet."));
  }
  for (const c of (demo ? demoChips : onCharCatalog)) {
    const id = c.id;
    const meta = (settings.clips && settings.clips[id]) || c;
    const label = meta.label || id.replace(/_/g, " ").replace(/-/g, " ");
    const on = demo ? id === demoClipId() : id === selected;
    chips.append(el("button", {
      class: "animChip" + (on ? " on" : "") + (!demo && meta.enabled === false ? " off" : ""),
      id: `anim_${id}`, type: "button", title: `Play ${label}`,
      onclick: () => (demo ? previewDemoClip(c) : selectAnim(id)),
    }, label));
  }

  // 2) Mesh2Motion gallery card preview area
  const libList = el("div", { class: "animLibList animGrid animGridScroll", id: "animLibList" });
  if (!libAll.length) {
    libList.append(el("p", { class: "hint" }, "Mesh2Motion pack not found under library/mesh2motion."));
  } else if (!libShown.length) {
    libList.append(el("p", { class: "hint" }, libFilter ? "No clips match." : "All searched clips are already on this character."));
  } else {
    const roots = [];
    const seenFam = new Set();
    for (const c of libShown) {
      const fam = c.family || c.id;
      if (libFilter) { roots.push(c); continue; }
      if (seenFam.has(fam)) continue;
      seenFam.add(fam);
      roots.push(libById[c.family_root || c.id] || c);
    }
    for (const c of roots.slice(0, 80)) {
      const id = c.id;
      const label = c.label || id;
      const kids = (!libFilter && c.siblings && c.siblings.length > 1) ? c.siblings : null;
      const open = !!(kids && expandedFam[c.family || id]);
      const tile = el("button", {
        class: "animTile" + (job._libHighlight === id ? " on" : ""),
        id: `lib_${id}`, type: "button",
        title: kids ? `${label} (${kids.length} poses)` : label,
        onclick: () => (demo ? previewDemoClip(c) : highlightLibraryClip(c)),
      },
        previewMedia(c.preview, label),
        el("span", { class: "animTileLabel" }, label),
      );
      if (kids) {
        tile.append(el("span", {
          class: "animTileExpand" + (open ? " open" : ""),
          title: open ? "Collapse" : "Expand pose tree",
          onclick: (e) => {
            e.stopPropagation();
            job._libExpanded = { ...(job._libExpanded || {}) };
            const key = c.family || id;
            if (job._libExpanded[key]) delete job._libExpanded[key];
            else job._libExpanded[key] = true;
            renderSide();
          },
        }, open ? "▾" : "▸"));
      }
      libList.append(tile);
      if (open && kids) {
        const wrap = el("div", { class: "animFamilyKids" });
        for (const s of kids) {
          const full = libById[s.id] || s;
          wrap.append(el("button", {
            class: "animTile" + (job._libHighlight === s.id ? " on" : ""),
            type: "button", title: s.label || s.id,
            onclick: () => (demo ? previewDemoClip(full) : highlightLibraryClip(full)),
          },
            previewMedia(s.preview || full.preview, s.label || s.id),
            el("span", { class: "animTileLabel" }, s.label || s.id),
          ));
        }
        libList.append(wrap);
      }
    }
    if (roots.length > 80) {
      libList.append(el("p", { class: "hint" }, `Showing 80 of ${roots.length} — refine search.`));
    }
  }

  const libSearch = el("input", {
    class: "animLibSearch", id: "animLibSearch", type: "search",
    placeholder: `Search ${libAll.length || ""} Mesh2Motion clips…`,
    value: job._libFilter || "",
    oninput: (e) => { job._libFilter = e.target.value; renderSide(); },
  });
  const libHi = job._libHighlight ? (libById[job._libHighlight] || { id: job._libHighlight, label: job._libHighlight }) : null;

  // Keep fit overlay in sync with side panel
  setTimeout(mountAnimFitOverlay, 0);

  return card("Motion library",
    el("p", {}, demo
      ? "Demo mannequin. Click a clip to play it. Import, add, and export turn on after Rig."
      : "Named clips on this character play in the preview. Gallery below shows Mesh2Motion motions — ▸ expands a pose family."),
    el("h3", {}, demo ? "Preview" : `On this character (${onCharCatalog.length})`),
    chips,
    el("div", { class: "row" },
      el("button", { class: "ghost", disabled: demo || busyAnim, id: "importMotion", title: demo ? "Rig the character first" : "", onclick: pickMotion }, "Import motion"),
      el("button", {
        class: "ghost", disabled: demo || busyAnim || !(job.motion_library_count > 0),
        id: "replaceBuiltins", title: demo ? "Rig the character first" : "Swap idle/walk/… for Mesh2Motion",
        onclick: replaceBuiltins,
      }, "Use Mesh2Motion builtins"),
      el("button", { disabled: demo || busyAnim || !hasOnChar, id: "exportAnims", title: demo ? "Rig the character first" : "", onclick: exportAnims }, "Export selected")),
    el("h3", {}, `Gallery (${libAll.length})`),
    libSearch,
    libHi ? el("div", { class: "row" },
      el("button", { disabled: demo || busyAnim, title: demo ? "Rig the character first" : "", onclick: () => addLibraryClip(libHi.id) }, `Add “${libHi.label || libHi.id}”`),
      el("button", { class: "ghost", onclick: () => { job._libHighlight = null; renderSide(); } }, "Clear"),
    ) : null,
    libList,
  );
}

function pickMotion() {
  const inp = $("filePick");
  inp.accept = ".fbx,.glb,.gltf";
  inp.value = "";
  inp.onchange = () => inp.files[0] && uploadMotion(inp.files[0]);
  inp.click();
}

async function uploadMotion(file) {
  $("status").replaceChildren(el("span", {}, `importing ${file.name}…`));
  try {
    job = carryClient(await api(`/jobs/${job.id}/import-motion?name=${encodeURIComponent(file.name)}`, {
      method: "POST", body: await file.arrayBuffer(),
    }));
  } catch (e) { return alert(e.message); }
  shownKey = "";
  view = "rigflow";
  job._rigPhase = "play";
  render(); refreshList(); schedulePoll();
}

async function addLibraryClip(clipId) {
  $("status").replaceChildren(el("span", {}, `adding ${clipId}…`));
  try {
    job = carryClient(await api(`/jobs/${job.id}/apply-library`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clip: clipId }),
    }));
  } catch (e) { return alert(e.message); }
  shownKey = "";
  view = "rigflow";
  job._rigPhase = "play";
  render(); refreshList(); schedulePoll();
}

async function replaceBuiltins() {
  if (!confirm("Replace idle / walk / crouch / wave / … with Mesh2Motion (Action Forge) clips?")) return;
  $("status").replaceChildren(el("span", {}, "replacing builtins with Mesh2Motion…"));
  try {
    job = carryClient(await api(`/jobs/${job.id}/replace-builtins`, { method: "POST" }));
  } catch (e) { return alert(e.message); }
  shownKey = "";
  view = "rigflow";
  job._rigPhase = "play";
  render(); refreshList(); schedulePoll();
}

async function keyCurrentFrame() {
  if (!viewer) return alert("open the animation preview first");
  const playing = viewer.playing && viewer.actions && viewer.actions[viewer.playing] ? viewer.playing : "";
  const selected = playing || selectedClipId();
  const fps = 30;
  const scrub = $("animScrub");
  const fr = Number((scrub && scrub.value) || Math.round((viewer.clipTime() || 0) * fps) + 1);
  // keep the scrubbed/posed bones and snapshot them
  viewer.setAnimMode("pose", { keepPose: true });
  const pose = viewer.poseSnapshot();
  if (!Object.keys(pose).length) return alert("no bones to key");
  try {
    job = carryClient(await api(`/jobs/${job.id}/key-clip`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clip: selected, frame: fr, pose }),
    }));
  } catch (e) { return alert(e.message); }
  shownKey = "";
  render(); refreshList(); schedulePoll();
}

async function selectAnim(id, fromViewer) {
  job._libHighlight = null;
  if (viewer && !viewer.actions[id]) {
    return alert("That clip isn’t on this character yet. Run Rig again for new Studio motions, or Import a file.");
  }
  const settings = { ...(job.anim_settings || {}), selected: id, clips: { ...((job.anim_settings && job.anim_settings.clips) || {}) } };
  try {
    job.anim_settings = await api(`/jobs/${job.id}/anim-settings`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
    });
  } catch (e) { return alert(e.message); }
  if (viewer && viewer.actions[id]) {
    if (!fromViewer) {
      viewer.setAnimMode("animate");
      viewer.play(id);
    }
    const clip = job.anim_settings.clips[id];
    if (clip) {
      viewer.setTimeScale(clip.speed || 1);
      if (clip.fit) viewer.setFit(clip.fit);
    }
  }
  renderSide(); renderStatus();
  mountAnimFitOverlay();
}

function highlightLibraryClip(clip) {
  // Select a library / pose-tree card (preview already loops on the tile)
  job._libHighlight = clip.id;
  renderSide();
}

async function saveAnimPatch(id, patch) {
  const settings = {
    selected: (job.anim_settings && job.anim_settings.selected) || id,
    clips: { ...((job.anim_settings && job.anim_settings.clips) || {}) },
  };
  settings.clips[id] = { ...(settings.clips[id] || {}), ...patch };
  try {
    job.anim_settings = await api(`/jobs/${job.id}/anim-settings`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
    });
  } catch (e) { return alert(e.message); }
  renderSide();
  if (view === "rigflow" && job._rigPhase === "play") mountAnimFitOverlay();
}

async function exportAnims() {
  try {
    job = carryClient(await api(`/jobs/${job.id}/export-anims`, { method: "POST" }));
  } catch (e) { return alert(e.message); }
  render(); refreshList(); schedulePoll();
}

function qaCard(qa) {
  const rows = Object.entries(qa.poses).map(([k, v]) => el("tr", {}, el("td", {}, k), el("td", {}, String(v.tears)), el("td", {}, String(v.max_stretch))));
  return card(`Deformation check: ${qa.gate}`,
    el("p", { class: qa.gate === "PASS" ? "ok" : "bad" }, `Limit ${Math.floor(qa.edges * 0.002)} torn edges on walk, crouch and idle.`),
    el("table", {}, el("tr", {}, el("th", {}, "pose"), el("th", {}, "torn edges"), el("th", {}, "max stretch")), ...rows));
}

// ------------------------------------------------------------------ start
(async () => {
  const info = await api("/info");
  const e = $("engine");
  e.textContent = (info.portable ? "Portable engines" : "Engines: dev install") + (info.engines_ok ? "" : " (missing!)");
  e.className = info.engines_ok ? "" : "bad";
  e.title = Object.values(info.engines).join("\n");
  await refreshList();
  const first = document.querySelector(".jobItem");
  if (first) openJob(first.dataset.id);
})();

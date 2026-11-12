import { Stage } from "./stage.js";

const STEPS = [
  ["source", "Source"],
  ["tpose", "T-pose"],
  ["mesh", "Mesh"],
  ["markers", "Markers"],
  ["skeleton", "Skeleton"],
  ["rig", "Rig"],
  ["animations", "Animations"],
];

const bar = document.getElementById("bar");
const panel = document.getElementById("panel");
const stageBox = document.getElementById("stage");

let job = null;
let view = "mesh";
let stage = null;
let library = [];
let showLabels = false;
let showFit = true;
let showEnv = false;
let query = "";
let category = "all";
let panelKey = "";
let shown = "";
let seenSent = false;
let posting = false;

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function fileUrl(name) {
  return `/api/jobs/${job.id}/file/${name}`;
}

async function boot() {
  const list = await api("/api/jobs");
  job = list.jobs.find((row) => row.name === "anime") || list.jobs[0] || null;
  if (!job) job = await api("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Character" }),
  });
  library = (await api("/api/motion-library")).clips;
  stage = new Stage(stageBox);
  stage.onJoints = (joints, moved) => postJSON("markers", { joints, moved });
  const views = document.createElement("div");
  views.className = "views";
  for (const name of ["front", "left", "right", "back", "free"]) {
    const button = document.createElement("button");
    button.dataset.view = name;
    button.textContent = name;
    button.onclick = () => stage.setView(name);
    views.appendChild(button);
  }
  stageBox.appendChild(views);
  const first = STEPS.find(([id]) => job.steps[id].state !== "done");
  view = first ? first[0] : "animations";
  render();
  setInterval(poll, 1500);
}

async function poll() {
  if (!job || posting) return;
  const prev = job.running;
  job = await api(`/api/jobs/${job.id}`);
  if (prev === "rig" && job.running !== "rig" && job.files.rig) view = "rig";
  render();
}

async function postJSON(path, body) {
  posting = true;
  try {
    job = await api(`/api/jobs/${job.id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    posting = false;
    panelKey = "";
    render();
  }
}

async function upload(step, file) {
  posting = true;
  try {
    job = await api(`/api/jobs/${job.id}/upload/${step}`, { method: "POST", body: file });
  } finally {
    posting = false;
    panelKey = "";
    render();
  }
}

function render() {
  bar.replaceChildren();
  for (const [id, label] of STEPS) {
    const button = document.createElement("button");
    const state = job.steps[id]?.state || "empty";
    button.className = "step" + (view === id ? " on" : "") + (state === "done" ? " done" : "") + (state === "running" ? " run" : "");
    button.textContent = label;
    button.onclick = () => { view = id; panelKey = ""; shown = ""; render(); };
    bar.appendChild(button);
  }
  const key = [view, job.running, job.steps[view]?.message, job.skeleton_seen, (job.off_body || []).join(), showLabels, showEnv].join("|");
  if (key !== panelKey) {
    panelKey = key;
    drawPanel();
  }
  syncStage();
}

function card(title) {
  const box = document.createElement("div");
  box.className = "card";
  const heading = document.createElement("h2");
  heading.textContent = title;
  box.appendChild(heading);
  return box;
}

function button(label, onclick, primary, disabled) {
  const el = document.createElement("button");
  el.textContent = label;
  if (primary) el.className = "primary";
  el.disabled = !!disabled;
  el.onclick = onclick;
  return el;
}

function fileButton(label, accept, step) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.hidden = true;
  const el = button(label, () => input.click());
  input.onchange = () => { if (input.files[0]) upload(step, input.files[0]); };
  el.appendChild(input);
  return el;
}

function drawPanel() {
  panel.replaceChildren();
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = job.steps[view]?.message || "";
  panel.appendChild(status);
  if (view === "source") drawSource();
  if (view === "tpose") drawTpose();
  if (view === "mesh") drawMesh();
  if (view === "markers") drawMarkers();
  if (view === "skeleton") drawSkeleton();
  if (view === "rig") drawRig();
  if (view === "animations") drawAnimations();
}

function drawSource() {
  const box = card("Source");
  box.appendChild(document.createElement("p")).textContent = "Upload the character image. Generation starts from this picture.";
  box.appendChild(fileButton("Upload my own", "image/*", "source"));
  panel.appendChild(box);
}

function drawTpose() {
  const settings = job.tpose_settings || { method: "standard", prompt: "" };
  const box = card("T-pose");
  const select = document.createElement("select");
  for (const [id, label] of [["standard", "Standard"], ["2_5d", "2.5D"], ["custom", "Custom prompt"]]) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    option.selected = settings.method === id;
    select.appendChild(option);
  }
  select.onchange = () => postJSON("tpose-settings", { method: select.value, prompt: settings.prompt, custom_prompt: settings.custom_prompt });
  box.appendChild(select);
  if (settings.method === "custom") {
    const area = document.createElement("textarea");
    area.value = settings.prompt || "";
    area.rows = 5;
    area.style.width = "100%";
    area.onchange = () => postJSON("tpose-settings", { method: "custom", prompt: area.value, custom_prompt: area.value });
    box.appendChild(area);
  }
  box.appendChild(button("Generate T-pose", () => postJSON("run/tpose", {}), true, !job.can_run.tpose));
  box.appendChild(fileButton("Upload my own T-pose", "image/*", "tpose"));
  panel.appendChild(box);
}

function drawMesh() {
  const settings = job.mesh_settings || { preset: "optimized", target_tris: 60000, seed_mode: "default", seed: 156863899 };
  const box = card("Mesh");
  const preset = document.createElement("select");
  for (const [id, label, tris] of [["optimized", "Optimized 60k", 60000], ["simple", "Simple 12k", 12000]]) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    option.selected = settings.preset === id;
    preset.appendChild(option);
  }
  preset.onchange = () => postJSON("mesh-settings", { preset: preset.value });
  box.appendChild(preset);
  const seedMode = document.createElement("select");
  for (const [id, label] of [["default", "Default"], ["random", "Random"], ["lock", "Lock seed"]]) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    option.selected = settings.seed_mode === id;
    seedMode.appendChild(option);
  }
  seedMode.onchange = () => postJSON("mesh-settings", { seed_mode: seedMode.value, seed: settings.seed, target_tris: settings.target_tris });
  box.appendChild(seedMode);
  const seed = document.createElement("input");
  seed.type = "number";
  seed.value = settings.seed ?? 156863899;
  seed.onchange = () => postJSON("mesh-settings", { seed_mode: "lock", seed: Number(seed.value), target_tris: settings.target_tris });
  box.appendChild(seed);
  box.appendChild(button("Generate mesh", () => postJSON("run/mesh", {}), true, !job.can_run.mesh));
  box.appendChild(fileButton("Upload my own mesh (.glb)", ".glb", "mesh"));
  panel.appendChild(box);
  if (job.mesh_check) {
    const readout = card("Mesh check");
    for (const row of job.mesh_check.checks || []) {
      const line = document.createElement("div");
      line.textContent = `${row.ok ? "✓" : "✗"} ${row.name} — ${row.detail}`;
      readout.appendChild(line);
    }
    panel.appendChild(readout);
  }
}

function drawMarkers() {
  const names = job.off_body || [];
  if (names.length) {
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.textContent = `The ${names[0].replaceAll("_", " ")} dot isn't on the body`;
    panel.appendChild(banner);
  }
  const box = card("Dots");
  const help = document.createElement("p");
  help.className = "help";
  help.textContent = "Orange dots drag. Grab a white dot and it turns orange. Labels stay off until you ask for them.";
  box.appendChild(help);
  const labels = document.createElement("label");
  labels.className = "row";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.checked = showLabels;
  tick.onchange = () => { showLabels = tick.checked; stage.setShowLabels(showLabels); };
  labels.append("Show labels", tick);
  box.appendChild(labels);
  box.appendChild(button("Place dots", () => postJSON("run/markers", {}), true, !job.can_run.markers));
  box.appendChild(button("Reset dots", () => postJSON("markers", { reset: true, moved: "reset" }), false, !job.files.markers));
  panel.appendChild(box);
}

function drawSkeleton() {
  if (job.files.markers && !seenSent) {
    seenSent = true;
    postJSON("skeleton/seen", {});
  }
  const box = card("Skeleton");
  const help = document.createElement("p");
  help.className = "help";
  help.textContent = "Bones are on the mesh. Drag a joint in front, side, back, or free. Nothing is bound until you bind from here.";
  box.appendChild(help);
  const env = document.createElement("label");
  env.className = "row";
  const envTick = document.createElement("input");
  envTick.type = "checkbox";
  envTick.checked = showEnv;
  envTick.onchange = () => {
    showEnv = envTick.checked;
    stage.showEnvelopes(showEnv, job.markers?.envelopes || {});
  };
  env.append("Show envelopes", envTick);
  box.appendChild(env);
  for (const bone of ["pelvis", "spine_01", "spine_02", "spine_03", "thigh_l", "thigh_r"]) {
    const row = document.createElement("label");
    row.className = "row";
    row.append(bone.replaceAll("_", " "));
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.5";
    slider.max = "2";
    slider.step = "0.05";
    slider.value = String((job.markers?.envelopes || {})[bone] || 1);
    slider.onchange = () => postJSON("markers", { envelopes: { [bone]: Number(slider.value) } });
    row.appendChild(slider);
    box.appendChild(row);
  }
  const fingers = document.createElement("select");
  for (const name of ["five", "four", "three", "mitten"]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = (job.markers?.fingers || "five") === name;
    fingers.appendChild(option);
  }
  fingers.onchange = () => postJSON("markers", { fingers: fingers.value });
  box.appendChild(fingers);
  const blocked = (job.off_body || []).length || (job.joints_off_body || []).length || !job.skeleton_seen;
  box.appendChild(button("Bind & wear", () => postJSON("run/rig", {}), true, blocked || !job.can_run.rig && job.running !== null));
  panel.appendChild(box);
}

function drawRig() {
  const box = card("Rig");
  const help = document.createElement("p");
  help.className = "help";
  help.textContent = job.files.rig
    ? "Bind pose. The skeleton stays put until you choose a motion."
    : "Bind & wear keeps the mesh on screen while the weights are built.";
  box.appendChild(help);
  const blocked = !job.skeleton_seen || (job.off_body || []).length || (job.joints_off_body || []).length;
  box.appendChild(button("Bind & wear", () => postJSON("run/rig", {}), true, blocked || job.running === "rig"));
  panel.appendChild(box);
}

function drawAnimations() {
  const box = card("Motions");
  const search = document.createElement("input");
  search.placeholder = "Search";
  search.value = query;
  search.oninput = () => { query = search.value; panelKey = ""; drawPanel(); };
  box.appendChild(search);
  const families = ["all", ...new Set(library.map((clip) => clip.family))];
  const select = document.createElement("select");
  for (const name of families) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = category === name;
    select.appendChild(option);
  }
  select.onchange = () => { category = select.value; panelKey = ""; drawPanel(); };
  box.appendChild(select);
  const grid = document.createElement("div");
  grid.className = "library";
  const add = document.createElement("div");
  add.className = "clip";
  add.appendChild(Object.assign(document.createElement("div"), { className: "tile", textContent: "+" }));
  add.appendChild(Object.assign(document.createElement("span"), { textContent: "Upload a motion" }));
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".glb,.gltf,.fbx";
  input.hidden = true;
  add.appendChild(input);
  add.onclick = () => input.click();
  grid.appendChild(add);
  const selected = job.animations?.selected;
  for (const clip of library) {
    if (category !== "all" && clip.family !== category) continue;
    if (query && !clip.label.toLowerCase().includes(query.toLowerCase())) continue;
    const tile = document.createElement("div");
    tile.className = "clip" + (selected === clip.id ? " on" : "");
    if (clip.preview) {
      const video = document.createElement("video");
      video.src = clip.preview;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      tile.appendChild(video);
    } else {
      tile.appendChild(Object.assign(document.createElement("div"), { className: "tile", textContent: clip.label.slice(0, 1) }));
    }
    tile.appendChild(Object.assign(document.createElement("span"), { textContent: clip.label }));
    tile.onclick = () => chooseClip(clip.id);
    grid.appendChild(tile);
  }
  box.appendChild(grid);
  panel.appendChild(box);
  if (showFit && job.animations?.clips?.[selected]) mountFit(job.animations.clips[selected].fit || {});
}

async function chooseClip(id) {
  const known = job.animations?.clips?.[id];
  if (!known) await postJSON("apply-library", { clip: id });
  else await postJSON("anim-settings", { selected: id });
  if (stage.actions[id]) stage.play(id);
}

function mountFit(fit) {
  let overlay = stageBox.querySelector(".fit");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "fit";
    stageBox.appendChild(overlay);
  }
  overlay.replaceChildren();
  const fields = [
    ["arm_space", "Arm-Space", -120, 120, 1],
    ["arm_fwd", "Arms", -120, 120, 1],
    ["arms", "Overdrive", 0, 1.5, 0.05],
    ["legs", "Stance", 0, 1.5, 0.05],
    ["hip", "Hip height", -0.12, 0.12, 0.005],
    ["turn", "Turn", -30, 30, 1],
  ];
  for (const [key, label, min, max, step] of fields) {
    const row = document.createElement("label");
    row.className = "row";
    row.append(label);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(fit[key] ?? (key === "arms" || key === "legs" ? 1 : 0));
    slider.oninput = () => stage.setFit({ [key]: Number(slider.value) });
    slider.onchange = () => postJSON("anim-settings", {
      selected: job.animations.selected,
      clips: { [job.animations.selected]: { fit: { ...fit, [key]: Number(slider.value) } } },
    });
    row.appendChild(slider);
    overlay.appendChild(row);
  }
  overlay.appendChild(button("Reset fit", () => postJSON("anim-settings", {
    selected: job.animations.selected,
    clips: { [job.animations.selected]: { fit: { hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0 } } },
  })));
  overlay.appendChild(button(showFit ? "Hide fit" : "Show fit", () => { showFit = !showFit; overlay.hidden = !showFit; }));
}

async function syncStage() {
  if (!stage || !job) return;
  stage.setShowLabels(showLabels);
  const rigging = job.running === "rig" && !job.files.rig;
  let mode = "empty";
  if (view === "source" && job.files.source) mode = "image:source.png";
  else if (view === "tpose" && job.files.tpose) mode = "image:tpose.png";
  else if ((view === "markers" || view === "skeleton" || rigging) && job.files.mesh) mode = "mesh";
  else if ((view === "rig" || view === "animations") && job.files.rig) mode = view === "rig" ? "hold" : "play";
  if (mode === shown) {
    if (mode === "mesh" && job.markers) paintMarkers();
    return;
  }
  shown = mode;
  stageBox.querySelectorAll("img.sheet").forEach((img) => img.remove());
  if (mode === "empty") {
    stage.clearModel();
    return;
  }
  if (mode.startsWith("image:")) {
    stage.clearModel();
    const img = document.createElement("img");
    img.className = "sheet";
    img.src = fileUrl(mode.slice(6));
    stageBox.appendChild(img);
    return;
  }
  if (mode === "mesh") {
    await stage.loadMesh(fileUrl("mesh.glb"));
    paintMarkers();
    return;
  }
  if (mode === "hold" || mode === "play") {
    await stage.loadRig(fileUrl("rig/rigged_animated.glb"), mode === "hold");
  }
}

function paintMarkers() {
  const det = job.markers;
  if (!det?.joints) return;
  if (view === "skeleton") {
    stage.setBones(det.joints, det.height);
    stage.showEnvelopes(showEnv, det.envelopes || {});
  } else if (view === "markers") {
    stage.setDots(det.joints, det.height, det.joints_off_body || [], det.off_body || [], []);
  }
}

boot();

import { Stage, boneLabel, bonePlace, dotColorCss } from "./stage.js?v=af5";

const STEPS = [
  ["source", "Source"],
  ["tpose", "T-pose"],
  ["mesh", "Mesh"],
  ["markers", "Markers"],
  ["rig", "Rig"],
  ["animations", "Animations"],
];

const bar = document.getElementById("bar");
const jobsBox = document.getElementById("jobs");
const panel = document.getElementById("panel");
const stageBox = document.getElementById("stage");

let jobs = [];
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
let showBones = true;

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
  jobs = (await api("/api/jobs")).jobs;
  job = jobs[0] || null;
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
  if (job) {
    const first = STEPS.find(([id]) => job.steps[id].state !== "done");
    view = first ? first[0] : "animations";
  }
  render();
  setInterval(poll, 1500);
}

async function poll() {
  if (!job || posting) return;
  const prev = job.running;
  job = await api(`/api/jobs/${job.id}`);
  // The server drops skeleton_seen when markers change. Arm the
  // skeleton panel to post skeleton/seen again on its next draw.
  if (!job.skeleton_seen) seenSent = false;
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
    if (!job.skeleton_seen) seenSent = false;
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
    shown = "";
    render();
  }
}

async function createJob(name) {
  const created = await api("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  jobs = (await api("/api/jobs")).jobs;
  return jobs.find((row) => row.id === created.id) || created;
}

async function openJob(next) {
  job = await api(`/api/jobs/${next.id}`);
  seenSent = false;
  showBones = true;
  shown = "";
  panelKey = "";
  const first = STEPS.find(([id]) => job.steps[id].state !== "done");
  view = first ? first[0] : "animations";
  render();
}

function drawJobs() {
  jobsBox.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Jobs";
  jobsBox.appendChild(heading);
  jobsBox.appendChild(button("+ New", async () => {
    const name = (window.prompt("Job name", "Character") || "").trim();
    if (!name) return;
    openJob(await createJob(name));
  }, true));
  const ordered = [...jobs].sort((a, b) => a.name.localeCompare(b.name));
  for (const row of ordered) {
    const line = document.createElement("div");
    line.className = "job";
    const el = button(row.name, () => {
      if (job && row.id === job.id) return;
      openJob(row);
    });
    if (job && row.id === job.id) el.className = (el.className ? el.className + " " : "") + "on";
    const remove = button("Delete", () => deleteJob(row));
    remove.className = "danger";
    line.append(el, remove);
    jobsBox.appendChild(line);
  }
}

async function deleteJob(row) {
  if (!window.confirm(`Delete ${row.name}? This removes the job and its files.`)) return;
  posting = true;
  try {
    await api(`/api/jobs/${row.id}`, { method: "DELETE" });
    jobs = jobs.filter((item) => item.id !== row.id);
    if (!job || job.id === row.id) {
      const next = jobs[0];
      job = next ? await api(`/api/jobs/${next.id}`) : null;
      seenSent = false;
      shown = "";
      if (job) {
        const first = STEPS.find(([id]) => job.steps[id].state !== "done");
        view = first ? first[0] : "animations";
      }
    }
  } catch (err) {
    window.alert(err.message || String(err));
  } finally {
    posting = false;
    panelKey = "";
    render();
  }
}

function render() {
  drawJobs();
  if (!job) {
    bar.replaceChildren();
    panel.replaceChildren();
    const note = document.createElement("p");
    note.className = "help";
    note.textContent = "No jobs. Use + New to start one.";
    panel.appendChild(note);
    if (stage) stage.clearModel();
    stageBox.querySelector(".fit")?.remove();
    return;
  }
  if (view !== "animations") stageBox.querySelector(".fit")?.remove();
  if (view !== "rig") stage.dismissHint();
  bar.replaceChildren();
  STEPS.forEach(([id, label], index) => {
    const button = document.createElement("button");
    const state = job.steps[id]?.state || "empty";
    button.className = "step" + (view === id ? " on" : "") + (state === "done" ? " done" : "") + (state === "running" ? " run" : "");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = state === "done" ? "✓" : String(index + 1);
    const title = document.createElement("b");
    title.textContent = label;
    button.append(badge, title);
    button.onclick = () => {
      view = id;
      if (id === "rig") showBones = true;
      panelKey = "";
      shown = "";
      render();
    };
    bar.appendChild(button);
  });
  const key = [view, showBones, job.running, job.steps[view]?.message, job.skeleton_seen, job.animations?.selected, (job.off_body || []).join(), showLabels, showEnv].join("|");
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
  const statusId = view === "rig" && job.running !== "rig" ? "skeleton" : view;
  status.textContent = job.steps[statusId]?.message || "";
  panel.appendChild(status);
  if (view === "source") drawSource();
  if (view === "tpose") drawTpose();
  if (view === "mesh") drawMesh();
  if (view === "markers") drawMarkers();
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

function guideDot(svg, x, y, name) {
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", x);
  dot.setAttribute("cy", y);
  dot.setAttribute("r", "3.2");
  dot.setAttribute("fill", dotColorCss(name));
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = boneLabel(name) + ". " + bonePlace(name);
  dot.appendChild(title);
  svg.appendChild(dot);
}

function guideBody(svg, d) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#1a1f28");
  path.setAttribute("stroke", "#3a4454");
  path.setAttribute("stroke-width", "1.5");
  svg.appendChild(path);
}

function placeGuide() {
  const wrap = document.createElement("div");
  wrap.className = "guide";
  const front = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  front.setAttribute("viewBox", "0 0 160 220");
  guideBody(front, "M80 8c10 0 16 8 16 16s-6 14-16 14-16-6-16-14 6-16 16-16zM64 40h32l8 28 22 8 18 36 8 28-10 4-8-24-14-8v22l8 46 4 28h-12l-2-26-8-44h-16l-8 44-2 26H52l4-28 8-46v-22l-14 8-8 24-10-4 8-28 18-36 22-8z");
  const frontDots = [
    [80, 10, "head_top"], [80, 24, "head"], [80, 42, "neck_base"],
    [62, 50, "clavicle_l"], [98, 50, "clavicle_r"],
    [44, 54, "upperarm_l"], [116, 54, "upperarm_r"],
    [80, 64, "spine_03"],
    [26, 86, "lowerarm_l"], [134, 86, "lowerarm_r"],
    [80, 88, "spine_02"],
    [16, 116, "hand_l"], [144, 116, "hand_r"],
    [80, 108, "spine_01"],
    [80, 124, "pelvis"],
    [66, 128, "thigh_l"], [94, 128, "thigh_r"],
    [12, 138, "hand_tip_l"], [148, 138, "hand_tip_r"],
    [66, 168, "calf_l"], [94, 168, "calf_r"],
    [66, 200, "foot_l"], [94, 200, "foot_r"],
    [58, 212, "ball_l"], [102, 212, "ball_r"],
    [50, 216, "toe_l"], [110, 216, "toe_r"],
  ];
  for (const [x, y, name] of frontDots) guideDot(front, x, y, name);
  const side = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  side.setAttribute("viewBox", "0 0 120 220");
  guideBody(side, "M52 8c12 0 20 8 22 16 4 2 8 8 6 14-6 4-16 4-24 0-6-6-8-14-4-20 0-6 0-10 0-10zM40 42h28l10 20 16 10 14 22 6 18-8 6-6-16-10-8-4 18 6 48 2 28h-10l-2-26-6-46H58l-4 46-2 26H42l2-28 6-48-6-16-12 8-6 16-8-6 8-20 16-12 10-18z");
  const sideDots = [
    [58, 12, "head_top"], [70, 26, "head"], [54, 42, "neck_base"],
    [72, 50, "clavicle_l"], [48, 54, "upperarm_l"], [78, 66, "spine_03"],
    [92, 82, "lowerarm_l"], [70, 90, "spine_02"], [104, 108, "hand_l"],
    [66, 108, "spine_01"], [54, 124, "pelvis"], [48, 130, "thigh_l"],
    [112, 126, "hand_tip_l"], [56, 170, "calf_l"], [52, 202, "foot_l"],
    [70, 212, "ball_l"], [82, 216, "toe_l"],
  ];
  for (const [x, y, name] of sideDots) guideDot(side, x, y, name);
  for (const [svg, caption] of [[front, "Front"], [side, "Side"]]) {
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.textContent = caption;
    fig.append(svg, cap);
    wrap.appendChild(fig);
  }
  return wrap;
}

function drawRig() {
  if (job.files.markers && !seenSent) {
    seenSent = true;
    postJSON("skeleton/seen", {});
  }
  const box = card("Rig");
  const help = document.createElement("p");
  help.className = "help";
  help.textContent = "Hover a dot to see where it should sit on the body. Yellow is the middle, blue the left, red the right.";
  box.appendChild(help);
  const bones = document.createElement("label");
  bones.className = "row";
  const boneTick = document.createElement("input");
  boneTick.type = "checkbox";
  boneTick.checked = showBones;
  boneTick.onchange = () => {
    showBones = boneTick.checked;
    if (!showBones) showEnv = false;
    paintMarkers();
    const envBox = box.querySelector("input[data-env]");
    if (envBox) envBox.checked = showEnv;
  };
  bones.append("Show skeleton", boneTick);
  box.appendChild(bones);
  if (showBones && job.markers?.joints) box.appendChild(placeGuide());
  const env = document.createElement("label");
  env.className = "row";
  const envTick = document.createElement("input");
  envTick.type = "checkbox";
  envTick.dataset.env = "1";
  envTick.checked = showEnv;
  envTick.onchange = () => {
    showEnv = envTick.checked;
    if (showEnv && !showBones) {
      showBones = true;
      boneTick.checked = true;
    }
    paintMarkers();
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

function motionUrl(id) {
  return `/api/motion-library/${encodeURIComponent(id)}/file`;
}

async function chooseClip(id) {
  const known = job.animations?.clips?.[id];
  if (!known) await postJSON("apply-library", { clip: id });
  else await postJSON("anim-settings", { selected: id });
  await stage.playClip(id, motionUrl(id));
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
  else if (view === "animations" && job.files.rig) mode = "play";
  else if ((view === "markers" || view === "mesh" || view === "rig" || rigging) && job.files.mesh) mode = "mesh";
  if (mode === shown) {
    if (mode === "mesh") paintMarkers();
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
    if (mode === "play" && job.animations?.selected) {
      await stage.playClip(job.animations.selected, motionUrl(job.animations.selected));
    }
  }
}

function paintMarkers() {
  const det = job.markers;
  if (!det?.joints) {
    stage.clearOverlay();
    return;
  }
  if (view === "rig" && showBones && job.running !== "rig") {
    stage.setBones(det.joints, det.height);
    stage.showEnvelopes(showEnv, det.envelopes || {});
  } else if (view === "markers" && det?.joints) {
    stage.setDots(det.joints, det.height, det.joints_off_body || [], det.off_body || [], []);
  } else {
    stage.clearOverlay();
  }
}

boot();

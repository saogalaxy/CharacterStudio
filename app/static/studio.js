import { Stage, ENVELOPE_BONES, boneLabel, bonePlace, dotColorCss, envelopeColorCss, poseLabel, visibleDots } from "./stage.js?v=af58";

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
let showFit = true;
let showEnv = false;
let query = "";
let category = "all";
let panelKey = "";
let jobEpoch = 0;
let shown = "";
let seenSent = false;
let posting = false;
let showBones = true;
let showAnimBones = false;
let showAnimEnv = false;
let showAnimHeat = false;
let showHeat = false;
let libraryScroll = 0;

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function fileUrl(name) {
  const step = name === "tpose.png" ? "tpose" : name === "source.png" ? "source" : "";
  const stamp = step ? job.steps?.[step]?.updated || "" : "";
  const q = stamp ? `?v=${encodeURIComponent(stamp)}` : "";
  return `/api/jobs/${job.id}/file/${name}${q}`;
}

async function boot() {
  jobs = (await api("/api/jobs")).jobs;
  job = jobs[0] || null;
  library = (await api("/api/motion-library")).clips;
  stage = new Stage(stageBox);
  stage.onJoints = (joints, moved) => postJSON("markers", { joints, finger_tips: stage.fingerTips, moved });
  stage.onPick = () => { if (view === "rig") mountRotate(); };
  stage.onIsolate = (kind, name) => {
    syncEyes(kind);
    const rows = document.querySelectorAll(kind === "env" ? ".env-key" : ".dotrow");
    rows.forEach((row) => {
      const eye = row.querySelector("button.eye");
      const on = eye?.dataset.bone === name;
      row.classList.toggle("hot", on);
      if (on) row.scrollIntoView({ block: "nearest" });
    });
    if (showHeat || showAnimHeat) stage.setWeightBone(name);
  };
  const views = document.createElement("div");
  views.className = "views";
  for (const name of ["front", "left", "right", "back", "free"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.view = name;
    button.textContent = name;
    button.onclick = () => stage.setView(name);
    views.appendChild(button);
  }
  const lock = document.createElement("button");
  lock.type = "button";
  lock.className = "lock";
  lock.title = "Lock camera";
  lock.setAttribute("aria-label", "Lock camera");
  lock.setAttribute("aria-pressed", "false");
  lock.appendChild(lockIcon(false));
  lock.onclick = () => {
    const on = !stage.locked;
    stage.setLocked(on);
    lock.classList.toggle("on", on);
    lock.title = on ? "Unlock camera" : "Lock camera";
    lock.setAttribute("aria-label", lock.title);
    lock.setAttribute("aria-pressed", on ? "true" : "false");
    lock.replaceChildren(lockIcon(on));
  };
  views.appendChild(lock);
  const skel = document.createElement("button");
  skel.type = "button";
  skel.className = "skel gone";
  skel.title = "Show the rig skeleton";
  skel.setAttribute("aria-pressed", "false");
  skel.textContent = "skeleton";
  skel.onclick = () => setAnimSkeleton(!showAnimBones);
  views.appendChild(skel);
  const envelopes = document.createElement("button");
  envelopes.type = "button";
  envelopes.className = "envelopes gone";
  envelopes.title = "Show the rig envelopes";
  envelopes.setAttribute("aria-pressed", "false");
  envelopes.textContent = "envelopes";
  envelopes.onclick = () => setAnimEnvelopes(!showAnimEnv);
  views.appendChild(envelopes);
  const weights = document.createElement("button");
  weights.type = "button";
  weights.className = "weights gone";
  weights.title = "Show the weight paint";
  weights.setAttribute("aria-pressed", "false");
  weights.textContent = "weights";
  weights.onclick = () => setAnimWeights(!showAnimHeat);
  views.appendChild(weights);
  stageBox.appendChild(views);
  if (job) {
    const first = STEPS.find(([id]) => job.steps[id].state !== "done");
    view = first ? first[0] : "animations";
  }
  render();
  setInterval(poll, 1500);
}

async function poll() {
  if (!job || posting || stage?.drag) return;
  const epoch = jobEpoch;
  const prev = job.running;
  const next = await api(`/api/jobs/${job.id}`);
  if (epoch !== jobEpoch || posting || stage?.drag) return;
  job = next;
  // The server drops skeleton_seen when markers change. Arm the
  // skeleton panel to post skeleton/seen again on its next draw.
  if (!job.skeleton_seen) seenSent = false;
  if (prev === "rig" && job.running !== "rig" && job.files.rig) view = "rig";
  render();
}

async function postJSON(path, body) {
  posting = true;
  jobEpoch += 1;
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
    job = await api(`/api/jobs/${job.id}/upload/${step}`, {
      method: "POST",
      headers: { "X-Filename": file.name },
      body: file,
    });
  } catch (err) {
    window.alert(err.message || String(err));
  } finally {
    posting = false;
    panelKey = "";
    shown = "";
    render();
  }
  if (step === "motion" && job?.animations?.selected) {
    await stage.playClip(job.animations.selected, motionUrl(job.animations.selected));
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
    clearStageChrome();
    return;
  }
  if (view !== "animations") clearStageChrome();
  if (view !== "rig" && view !== "markers") stage.dismissHint();
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
  const key = [view, showBones, job.running, job.steps[view]?.message, job.skeleton_seen, (job.off_body || []).join(), showEnv].join("|");
  if (key !== panelKey) {
    panelKey = key;
    drawPanel();
  }
  syncStage();
  const skelButton = stageBox.querySelector(".views button.skel");
  const envButton = stageBox.querySelector(".views button.envelopes");
  const weightButton = stageBox.querySelector(".views button.weights");
  const showStageTools = view === "animations" && !!job.files.rig;
  if (skelButton) skelButton.classList.toggle("gone", !showStageTools);
  if (envButton) envButton.classList.toggle("gone", !showStageTools);
  if (weightButton) weightButton.classList.toggle("gone", !showStageTools);
  if (view === "animations") mountTransport();
  if (view === "rig" && showBones) mountRotate();
  else stageBox.querySelector(".rotate")?.remove();
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

function stopButton() {
  const el = button("Stop", () => postJSON("stop", {}));
  el.className = "stop";
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
  const statusId = view === "rig" && job.running !== "rig" ? "skeleton" : view;
  const message = job.steps[statusId]?.message || "";
  const state = job.steps[statusId]?.state || "";
  if (message && !(view === "animations" && state !== "running")) {
    const status = document.createElement("p");
    status.className = "status";
    status.textContent = message;
    panel.appendChild(status);
  }
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
  let area = null;
  if (settings.method === "custom") {
    area = document.createElement("textarea");
    area.value = settings.prompt || "";
    area.rows = 5;
    area.style.width = "100%";
    area.onchange = () => postJSON("tpose-settings", { method: "custom", prompt: area.value, custom_prompt: area.value });
    box.appendChild(area);
  }
  box.appendChild(button("Generate T-pose", () => {
    const body = { method: select.value };
    if (select.value === "custom") {
      const text = area ? area.value : (settings.custom_prompt || settings.prompt || "");
      body.prompt = text;
      body.custom_prompt = text;
    }
    postJSON("run/tpose", body);
  }, true, !job.can_run.tpose));
  if (job.running === "tpose") box.appendChild(stopButton());
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
  if (job.running === "mesh") box.appendChild(stopButton());
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
  help.textContent = "Orange dots drag. Grab a white dot and it turns orange. Hover a dot and its name follows it, then fades out.";
  box.appendChild(help);
  box.appendChild(button("Place dots", () => postJSON("run/markers", {}), true, !job.can_run.markers));
  box.appendChild(button("Reset dots", () => postJSON("markers", { reset: true, moved: "reset" }), false, !job.files.markers));
  panel.appendChild(box);
}

function drawRig() {
  if (job.files.markers && !seenSent) {
    seenSent = true;
    postJSON("skeleton/seen", {});
  }
  const box = card("Rig");
  const help = document.createElement("p");
  help.className = "help";
  help.textContent = "Each finger has its own dot. Drag a dot to move it, or use Bend, Twist, and Swing to rotate that limb.";
  box.appendChild(help);
  const heat = document.createElement("label");
  heat.className = "row";
  const heatTick = document.createElement("input");
  heatTick.type = "checkbox";
  heatTick.checked = showHeat;
  heatTick.disabled = !job.files.rig;
  heatTick.onchange = () => {
    showHeat = heatTick.checked;
    paintMarkers();
  };
  heat.append("Weight paint", heatTick);
  box.appendChild(heat);
  const heatNote = document.createElement("p");
  heatNote.className = "help";
  heatNote.textContent = job.files.rig
    ? "Colors the last bind. Click a bone or a volume to paint that bone. Red is strong and blue is none."
    : "Bind the character once. Weight paint uses that result.";
  box.appendChild(heatNote);
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
  if (showBones && job.markers?.joints) {
    const names = visibleDots(job.markers.joints);
    box.appendChild(eyeTools("bone", names));
    const list = document.createElement("div");
    list.className = "dotlist";
    for (const name of names) {
      const row = document.createElement("div");
      row.className = "dotrow";
      const label = boneLabel(name);
      const shown = !stage.hiddenBones.has(name);
      if (!shown) row.classList.add("dim");
      const eye = document.createElement("button");
      eye.type = "button";
      eye.className = "eye";
      eye.dataset.kind = "bone";
      eye.dataset.bone = name;
      bindEye(eye, label, shown, (on) => {
        stage.setBoneHidden(name, !on);
        row.classList.toggle("dim", !on);
      });
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = dotColorCss(name);
      const text = document.createElement("span");
      text.className = "bone-name";
      text.textContent = label;
      row.title = bonePlace(name);
      row.append(eye, swatch, text);
      list.appendChild(row);
    }
    box.appendChild(list);
  }
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
  const envNote = document.createElement("p");
  envNote.className = "help";
  envNote.textContent = "Each color is one bone. Point at a name and that area brightens.";
  box.appendChild(envNote);
  box.appendChild(eyeTools("env", ENVELOPE_BONES));
  fillEnvelopeKey(box, true);
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

function fillEnvelopeKey(host, withSlider) {
  for (const bone of ENVELOPE_BONES) {
    const row = document.createElement("div");
    row.className = "row env-key";
    const label = boneLabel(bone);
    const shown = !stage.hiddenEnvs.has(bone);
    if (!shown) row.classList.add("dim");
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "eye";
    eye.dataset.kind = "env";
    eye.dataset.bone = bone;
    bindEye(eye, label, shown, (on) => {
      stage.setEnvelopeHidden(bone, !on);
      row.classList.toggle("dim", !on);
      if (!on) stage.highlightEnvelope("");
    });
    const name = document.createElement("span");
    name.className = "name";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = envelopeColorCss(bone);
    name.append(swatch, label);
    row.append(eye, name);
    if (withSlider) {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0.5";
      slider.max = "2";
      slider.step = "0.05";
      slider.value = String((job.markers?.envelopes || {})[bone] || 1);
      slider.onchange = () => postJSON("markers", { envelopes: { [bone]: Number(slider.value) } });
      row.appendChild(slider);
    }
    const hot = (on) => {
      row.classList.toggle("hot", on);
      if (on && stage.hiddenEnvs.has(bone)) return;
      stage.highlightEnvelope(on ? bone : "");
    };
    row.onmouseenter = () => hot(true);
    row.onmouseleave = () => hot(false);
    host.appendChild(row);
  }
}

function mountEnvLegend(host) {
  host.querySelector(".env-legend")?.remove();
  if (!showAnimEnv) {
    stage.highlightEnvelope("");
    return;
  }
  const key = document.createElement("div");
  key.className = "env-legend";
  key.appendChild(eyeTools("env", ENVELOPE_BONES));
  fillEnvelopeKey(key, false);
  host.appendChild(key);
}
function eyeTools(kind, names) {
  const bar = document.createElement("div");
  bar.className = "eye-tools";
  const make = (text, hidden) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.onclick = () => {
      if (kind === "env") stage.setEnvelopesHidden(names, hidden);
      else stage.setBonesHidden(names, hidden);
      syncEyes(kind);
      if (!hidden && (showHeat || showAnimHeat)) stage.setWeightBone("");
    };
    return button;
  };
  bar.append(make("Select all", false), make("Deselect all", true));
  return bar;
}

function syncEyes(kind) {
  document.querySelectorAll(`button.eye[data-kind="${kind}"]`).forEach((button) => {
    const hidden = kind === "env"
      ? stage.hiddenEnvs.has(button.dataset.bone)
      : stage.hiddenBones.has(button.dataset.bone);
    paintEye(button, !hidden);
    button.closest(".dotrow, .env-key")?.classList.toggle("dim", hidden);
  });
}

function paintEye(button, on) {
  button.classList.toggle("off", !on);
  const label = button.dataset.label || "";
  button.title = (on ? "Hide " : "Show ") + label;
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.replaceChildren(eyeIcon(on));
}

function bindEye(button, label, shown, apply) {
  button.dataset.label = label;
  paintEye(button, shown);
  button.onclick = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const on = button.classList.contains("off");
    apply(on);
    paintEye(button, on);
  };
}

function eyeIcon(open) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
  outline.setAttribute("d", "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z");
  const pupil = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  pupil.setAttribute("cx", "12");
  pupil.setAttribute("cy", "12");
  pupil.setAttribute("r", "3");
  svg.append(outline, pupil);
  if (!open) {
    const slash = document.createElementNS("http://www.w3.org/2000/svg", "path");
    slash.setAttribute("d", "M4 20L20 4");
    svg.appendChild(slash);
  }
  return svg;
}

function lockIcon(closed) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  body.setAttribute("x", "5");
  body.setAttribute("y", "11");
  body.setAttribute("width", "14");
  body.setAttribute("height", "10");
  body.setAttribute("rx", "2");
  const shackle = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shackle.setAttribute("d", closed ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V8a4 4 0 0 1 7.5-1");
  svg.append(body, shackle);
  return svg;
}

function setAnimSkeleton(on) {
  showAnimBones = !!on;
  stage.setSkeleton(showAnimBones);
  const button = stageBox.querySelector(".views button.skel");
  if (button) {
    button.classList.toggle("on", showAnimBones);
    button.setAttribute("aria-pressed", showAnimBones ? "true" : "false");
    button.title = showAnimBones ? "Hide the rig skeleton" : "Show the rig skeleton";
  }
  const tick = panel.querySelector("input[data-skel]");
  if (tick) tick.checked = showAnimBones;
}

function setAnimEnvelopes(on) {
  showAnimEnv = !!on;
  stage.setAnimEnvelopes(showAnimEnv, job?.markers?.envelopes || {});
  const button = stageBox.querySelector(".views button.envelopes");
  if (button) {
    button.classList.toggle("on", showAnimEnv);
    button.setAttribute("aria-pressed", showAnimEnv ? "true" : "false");
    button.title = showAnimEnv ? "Hide the rig envelopes" : "Show the rig envelopes";
  }
  const tick = panel.querySelector("input[data-anim-env]");
  if (tick) tick.checked = showAnimEnv;
}

function setAnimWeights(on) {
  showAnimHeat = !!on;
  stage.setAnimWeights(showAnimHeat);
  const button = stageBox.querySelector(".views button.weights");
  if (button) {
    button.classList.toggle("on", showAnimHeat);
    button.setAttribute("aria-pressed", showAnimHeat ? "true" : "false");
    button.title = showAnimHeat ? "Hide the weight paint" : "Show the weight paint";
  }
  const tick = panel.querySelector("input[data-anim-weight]");
  if (tick) tick.checked = showAnimHeat;
}

function drawAnimations() {
  const box = card("Motions");
  if (job.files.rig) {
    const bones = document.createElement("label");
    bones.className = "row";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.dataset.skel = "1";
    tick.checked = showAnimBones;
    tick.onchange = () => setAnimSkeleton(tick.checked);
    bones.append("Show skeleton", tick);
    box.appendChild(bones);
    const env = document.createElement("label");
    env.className = "row";
    const envTick = document.createElement("input");
    envTick.type = "checkbox";
    envTick.dataset.animEnv = "1";
    envTick.checked = showAnimEnv;
    envTick.onchange = () => {
      setAnimEnvelopes(envTick.checked);
      mountEnvLegend(box);
    };
    env.append("Show envelopes", envTick);
    box.appendChild(env);
    const weights = document.createElement("label");
    weights.className = "row";
    const weightTick = document.createElement("input");
    weightTick.type = "checkbox";
    weightTick.dataset.animWeight = "1";
    weightTick.checked = showAnimHeat;
    weightTick.onchange = () => setAnimWeights(weightTick.checked);
    weights.append("Show weights", weightTick);
    box.appendChild(weights);
    const weightNote = document.createElement("p");
    weightNote.className = "help";
    weightNote.textContent = "Colors the last bind on the moving mesh. Click the body to paint one bone. Red is strong and blue is none. Click empty space to see every bone again. Envelopes hide while this is on.";
    box.appendChild(weightNote);
    const note = document.createElement("p");
    note.className = "help";
    note.textContent = "Each color is one bone. Point at a name and that area brightens.";
    box.appendChild(note);
    mountEnvLegend(box);
  }
  if (!job.files.rig) {
    const need = document.createElement("p");
    need.className = "help";
    need.textContent = "Bind the character on Rig before a motion can play. The mesh stays on screen until then.";
    box.appendChild(need);
  }
  const search = document.createElement("input");
  search.placeholder = "Search";
  search.value = query;
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
  box.appendChild(select);
  box.appendChild(fileButton("Import a motion", ".glb,.gltf", "motion"));
  drawExport(box);
  drawSaved(box);
  const grid = document.createElement("div");
  grid.className = "library";
  const selected = job.animations?.selected;
  const imported = Object.entries(job.animations?.clips || {})
    .filter(([, row]) => row.source === "import")
    .map(([id, row]) => ({ id, label: row.label || id, family: "imported", preview: null }));
  if (imported.length) {
    const option = document.createElement("option");
    option.value = "imported";
    option.textContent = "imported";
    option.selected = category === "imported";
    select.appendChild(option);
  }
  for (const clip of [...imported, ...library]) {
    const tile = document.createElement("div");
    tile.className = "clip" + (selected === clip.id ? " on" : "");
    tile.dataset.id = clip.id;
    tile.dataset.family = clip.family || "";
    tile.dataset.label = clip.label.toLowerCase();
    if (clip.preview) {
      const video = document.createElement("video");
      video.dataset.src = clip.preview;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "none";
      tile.appendChild(video);
    } else {
      tile.appendChild(Object.assign(document.createElement("div"), { className: "tile", textContent: clip.label.slice(0, 1) }));
    }
    tile.appendChild(Object.assign(document.createElement("span"), { textContent: clip.label }));
    tile.onclick = () => chooseClip(clip.id);
    const ops = document.createElement("div");
    ops.className = "ops";
    const saved = !!job.animations?.clips?.[clip.id];
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.title = "Add this motion";
    if (saved) plus.className = "on";
    plus.onclick = (event) => {
      event.stopPropagation();
      addClip(clip.id);
    };
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.title = "Remove this motion";
    minus.onclick = (event) => {
      event.stopPropagation();
      removeClip(clip.id);
    };
    ops.append(plus, minus);
    tile.appendChild(ops);
    grid.appendChild(tile);
  }
  const applyFilter = () => {
    const q = query.trim().toLowerCase();
    for (const tile of grid.querySelectorAll(".clip[data-label]")) {
      tile.hidden = (category !== "all" && tile.dataset.family !== category) || (q && !tile.dataset.label.includes(q));
    }
    pumpVideos();
  };
  const pumpVideos = () => {
    const view = grid.getBoundingClientRect();
    for (const tile of grid.querySelectorAll(".clip[data-label]")) {
      const video = tile.querySelector("video");
      if (!video) continue;
      const rect = tile.getBoundingClientRect();
      const onScreen = !tile.hidden && rect.bottom > view.top && rect.top < view.bottom;
      if (!onScreen) {
        if (!video.paused) video.pause();
        continue;
      }
      if (!video.getAttribute("src")) video.setAttribute("src", video.dataset.src);
      if (video.paused) video.play().catch(() => {});
    }
  };
  search.oninput = () => { query = search.value; applyFilter(); };
  select.onchange = () => { category = select.value; applyFilter(); };
  grid.addEventListener("scroll", () => {
    libraryScroll = grid.scrollTop;
    pumpVideos();
  });
  box.appendChild(grid);
  panel.appendChild(box);
  applyFilter();
  grid.scrollTop = libraryScroll;
  ensureFit();
  mountTransport();
}

function downloadAnchor(label, href, filename) {
  const link = document.createElement("a");
  link.className = "export";
  link.textContent = label;
  if (!href) {
    link.classList.add("off");
    return link;
  }
  link.href = href;
  link.download = filename;
  return link;
}

function drawSaved(box) {
  const head = document.createElement("div");
  head.className = "saved-head";
  const heading = document.createElement("h3");
  heading.className = "sub";
  heading.textContent = "Saved";
  head.appendChild(heading);
  const clips = Object.entries(job.animations?.clips || {});
  if (clips.length) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear all";
    clear.onclick = () => {
      if (window.confirm("Remove every saved motion?")) clearClips();
    };
    head.appendChild(clear);
  }
  box.appendChild(head);
  if (!clips.length) {
    const note = document.createElement("p");
    note.className = "help";
    note.textContent = "Nothing saved yet. Use + on a card to keep a motion.";
    box.appendChild(note);
    return;
  }
  const row = document.createElement("div");
  row.className = "saved";
  for (const [id, item] of clips) {
    const itemBox = document.createElement("span");
    itemBox.className = "saved-item";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "name" + (id === job.animations?.selected ? " on" : "");
    chip.dataset.id = id;
    chip.textContent = item.label || id;
    chip.onclick = () => chooseClip(id);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "x";
    remove.textContent = "×";
    remove.title = "Remove";
    remove.onclick = () => removeClip(id);
    itemBox.append(chip, remove);
    row.appendChild(itemBox);
  }
  box.appendChild(row);
}

function drawExport(box) {
  const heading = document.createElement("h3");
  heading.className = "sub";
  heading.textContent = "Export";
  box.appendChild(heading);
  const note = document.createElement("p");
  note.className = "help";
  note.textContent = "One file with the character and every saved motion.";
  box.appendChild(note);
  const where = document.createElement("p");
  where.className = "path";
  where.textContent = job.export_ready ? `Saved to ${job.export_path}` : `Saves to ${job.export_path}`;
  box.appendChild(where);
  const action = document.createElement("button");
  action.type = "button";
  action.className = "primary";
  action.textContent = "Export .glb";
  const count = Object.keys(job.animations?.clips || {}).length;
  action.disabled = !job.files.rig || !count;
  action.onclick = () => exportPackage(action);
  box.appendChild(action);
  if (job.export_ready) {
    const show = document.createElement("button");
    show.type = "button";
    show.textContent = "Show in folder";
    show.onclick = () => postJSON("export/reveal", {});
    box.appendChild(show);
  }
}

function motionUrl(id) {
  const row = job.animations?.clips?.[id];
  if (row?.source === "import" && row.file) return fileUrl(row.file);
  return `/api/motion-library/${encodeURIComponent(id)}/file`;
}

async function chooseClip(id) {
  if (!job.animations) job.animations = { selected: id, clips: {} };
  job.animations.selected = id;
  for (const tile of panel.querySelectorAll(".clip[data-id]")) {
    tile.classList.toggle("on", tile.dataset.id === id);
  }
  for (const chip of panel.querySelectorAll(".saved button.name")) {
    chip.classList.toggle("on", chip.dataset.id === id);
  }
  ensureFit();
  const playing = stage.playClip(id, motionUrl(id));
  posting = true;
  try {
    job = await api(`/api/jobs/${job.id}/anim-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected: id }),
    });
    if (job.animations) job.animations.selected = id;
    panelKey = [view, showBones, job.running, job.steps[view]?.message, job.skeleton_seen, (job.off_body || []).join(), showEnv].join("|");
  } catch (err) {
    window.alert(err.message || String(err));
  } finally {
    posting = false;
  }
  await playing;
}

async function addClip(id) {
  if (job.animations?.clips?.[id]) return;
  await postJSON("apply-library", { clip: id });
}

async function removeClip(id) {
  if (!job.animations?.clips?.[id]) return;
  await postJSON("remove-clip", { clip: id });
}

async function clearClips() {
  await postJSON("clear-clips", {});
}

async function exportPackage(button) {
  button.disabled = true;
  button.textContent = "Packaging…";
  posting = true;
  try {
    const next = await api(`/api/jobs/${job.id}/export`, { method: "POST" });
    job = next;
    if (next.download) {
      const name = next.download.split("/").pop();
      const link = downloadAnchor(name, fileUrl(next.download), name);
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  } catch (err) {
    window.alert(err.message || String(err));
  } finally {
    posting = false;
    panelKey = "";
    render();
  }
}

function mountRotate() {
  const id = stage.picked;
  const known = id && (stage.joints?.[id] || stage.fingerTips?.[id]);
  let box = stageBox.querySelector(".rotate");
  if (!known) {
    if (box) box.hidden = true;
    return;
  }
  if (!box) {
    box = document.createElement("div");
    box.className = "rotate";
    const who = document.createElement("b");
    who.className = "who";
    box.appendChild(who);
    for (const [axis, label] of [["bend", "Bend"], ["twist", "Twist"], ["swing", "Swing"]]) {
      const row = document.createElement("label");
      row.className = "row";
      row.append(label);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "-90";
      slider.max = "90";
      slider.step = "1";
      slider.value = "0";
      slider.dataset.axis = axis;
      slider.dataset.last = "0";
      slider.oninput = () => {
        const next = Number(slider.value);
        const prev = Number(slider.dataset.last || 0);
        stage.rotating = true;
        stage.rotateSelection(axis, next - prev);
        slider.dataset.last = String(next);
      };
      slider.onchange = () => {
        slider.value = "0";
        slider.dataset.last = "0";
        stage.rotating = false;
        postJSON("markers", { joints: stage.joints, finger_tips: stage.fingerTips, moved: stage.picked });
      };
      row.appendChild(slider);
      box.appendChild(row);
    }
    stageBox.appendChild(box);
  }
  box.hidden = false;
  const who = box.querySelector(".who");
  const title = poseLabel(id);
  if (who.textContent !== title) {
    who.textContent = title;
    for (const slider of box.querySelectorAll("input")) {
      slider.value = "0";
      slider.dataset.last = "0";
    }
  }
}

function clearStageChrome() {
  stageBox.querySelector(".fit")?.remove();
  stageBox.querySelector(".fit-pill")?.remove();
  stageBox.querySelector(".dock")?.remove();
  if (stage) stage.onPlayback = null;
}

function ensureFit() {
  const selected = job.animations?.selected;
  if (view !== "animations" || !job.files.rig || !selected) {
    stageBox.querySelector(".fit")?.remove();
    stageBox.querySelector(".fit-pill")?.remove();
    return;
  }
  mountFit(job.animations?.clips?.[selected]?.fit || {});
}

function mountTransport() {
  if (view !== "animations" || !job?.files?.rig) {
    stageBox.querySelector(".dock")?.remove();
    if (stage) stage.onPlayback = null;
    return;
  }
  if (stageBox.querySelector(".dock")) return;
  const dock = document.createElement("div");
  dock.className = "dock";
  const play = document.createElement("button");
  play.type = "button";
  play.textContent = "Play";
  play.onclick = () => {
    if (!stage.current) return;
    if (stage.paused) stage.play(stage.current.getClip().name);
    else stage.pause();
  };
  const restart = document.createElement("button");
  restart.type = "button";
  restart.textContent = "Restart";
  restart.onclick = () => stage.restart();
  const scrub = document.createElement("input");
  scrub.type = "range";
  scrub.min = "0";
  scrub.step = "0.01";
  scrub.value = "0";
  let scrubbing = false;
  scrub.onpointerdown = () => { scrubbing = true; };
  scrub.oninput = () => stage.scrub(Number(scrub.value));
  scrub.onchange = () => { scrubbing = false; };
  const speedLabel = document.createElement("span");
  speedLabel.textContent = `${Number(stage.timeScale || 1).toFixed(1)}×`;
  const speed = document.createElement("input");
  speed.type = "range";
  speed.className = "speed";
  speed.min = "0.5";
  speed.max = "2";
  speed.step = "0.1";
  speed.value = String(stage.timeScale || 1);
  speed.title = "Play speed";
  speed.oninput = () => {
    stage.setSpeed(Number(speed.value));
    speedLabel.textContent = `${Number(speed.value).toFixed(1)}×`;
  };
  dock.append(play, restart, scrub, speedLabel, speed);
  stageBox.appendChild(dock);
  stage.onPlayback = (state) => {
    play.textContent = state.paused ? "Play" : "Pause";
    play.disabled = !state.duration;
    restart.disabled = !state.duration;
    scrub.disabled = !state.duration;
    scrub.max = String(state.duration || 0);
    if (!scrubbing) scrub.value = String(state.time || 0);
  };
}

function mountFit(fit) {
  if (!showFit) {
    stageBox.querySelector(".fit")?.remove();
    if (!stageBox.querySelector(".fit-pill")) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "fit-pill";
      pill.textContent = "Fit to character";
      pill.onclick = () => {
        showFit = true;
        ensureFit();
      };
      stageBox.appendChild(pill);
    }
    return;
  }
  stageBox.querySelector(".fit-pill")?.remove();
  let overlay = stageBox.querySelector(".fit");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "fit";
    stageBox.appendChild(overlay);
  }
  overlay.replaceChildren();
  const applied = {
    hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0, leg_space: 0,
    ...fit,
  };
  stage.setFit(applied);
  const fields = [
    ["arm_space", "Arm-Space", -120, 120, 1],
    ["arm_fwd", "Arms", -120, 120, 1],
    ["arms", "Overdrive", 0, 1.5, 0.05],
    ["legs", "Stride", 0, 1.5, 0.05],
    ["leg_space", "Legs apart", -60, 60, 1],
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
    slider.dataset.fit = key;
    slider.value = String(applied[key]);
    slider.oninput = () => stage.setFit({ [key]: Number(slider.value) });
    slider.onchange = () => {
      const id = job.animations?.selected;
      if (!id || !job.animations?.clips?.[id]) return;
      postJSON("anim-settings", {
        selected: id,
        clips: { [id]: { fit: { ...stage.fit } } },
      });
    };
    row.appendChild(slider);
    overlay.appendChild(row);
  }
  overlay.appendChild(button("Reset fit", () => {
    const defaults = { hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0, leg_space: 0 };
    stage.setFit(defaults);
    for (const slider of overlay.querySelectorAll("input[data-fit]")) {
      slider.value = String(defaults[slider.dataset.fit]);
    }
    const id = job.animations?.selected;
    if (!id || !job.animations?.clips?.[id]) return;
    postJSON("anim-settings", {
      selected: id,
      clips: { [id]: { fit: defaults } },
    });
  }));
  overlay.appendChild(button("Hide", () => {
    showFit = false;
    ensureFit();
  }));
}

function generationWatch() {
  if (job.running !== view || (view !== "tpose" && view !== "mesh")) return null;
  const step = job.steps[view] || {};
  const progress = Number(step.progress);
  const image = view === "tpose"
    ? (job.files.source ? "source.png" : "")
    : (job.files.tpose ? "tpose.png" : "");
  return {
    image,
    stage: step.message || "waiting on ComfyUI",
    progress: Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0,
  };
}

function paintGeneration(status) {
  let box = stageBox.querySelector(".gen-status");
  if (!box || box.dataset.image !== status.image) {
    stage.clearModel();
    stageBox.querySelectorAll("img.sheet").forEach((img) => img.remove());
    box?.remove();
    box = document.createElement("div");
    box.className = "gen-status";
    box.dataset.image = status.image;
    const frame = document.createElement("div");
    frame.className = "silhouette";
    if (status.image) {
      const ghost = document.createElement("img");
      ghost.className = "ghost";
      ghost.alt = "";
      ghost.src = fileUrl(status.image);
      const solid = document.createElement("img");
      solid.className = "solid";
      solid.alt = "";
      solid.src = ghost.src;
      frame.append(ghost, solid);
    }
    const name = document.createElement("p");
    name.className = "stage-name";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.appendChild(document.createElement("i"));
    const stop = stopButton();
    box.append(frame, name, bar, stop);
    stageBox.appendChild(box);
    shown = "status";
  }
  box.style.setProperty("--p", String(status.progress));
  box.querySelector(".stage-name").textContent = status.stage;
}

async function syncStage() {
  if (!stage || !job) return;
  const status = generationWatch();
  if (status) {
    paintGeneration(status);
    return;
  }
  stageBox.querySelector(".gen-status")?.remove();
  const rigging = job.running === "rig" && !job.files.rig;
  let mode = "empty";
  if (view === "source" && job.files.source) mode = `image:source.png:${job.steps.source?.updated || ""}`;
  else if (view === "tpose" && job.files.tpose) mode = `image:tpose.png:${job.steps.tpose?.updated || ""}`;
  else if (view === "animations" && job.files.rig) mode = "play";
  else if ((view === "markers" || view === "mesh" || view === "rig" || view === "animations" || rigging) && job.files.mesh) mode = "mesh";
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
    img.src = fileUrl(mode.slice(6).split(":")[0]);
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
    stage.setAnimEnvelopes(showAnimEnv, job.markers?.envelopes || {});
    stage.setAnimWeights(showAnimHeat);
  }
}

function paintMarkers() {
  const det = job.markers;
  if (!det?.joints) {
    stage.clearOverlay();
    return;
  }
  if (view === "rig" && showBones && job.running !== "rig") {
    stage.setBones(det.joints, det.height, det.fingers || "five", det.finger_tips || null);
    stage.showEnvelopes(showEnv, det.envelopes || {});
  } else if (view === "markers" && det?.joints) {
    stage.setDots(det.joints, det.height, det.joints_off_body || [], det.off_body || [], []);
  } else {
    stage.clearOverlay();
  }
  if (view === "rig" && showHeat && job.files.rig && job.running !== "rig") {
    stage.setWeightPaint(true, fileUrl("rig/rigged_animated.glb"));
  } else if (stage) {
    stage.setWeightPaint(false);
  }
}

boot();

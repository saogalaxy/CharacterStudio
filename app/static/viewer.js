// 3D view: "orbit" (inspect a mesh), "markers" (front view, drag skeleton), "anim" (play the rig's clips).
// Marker/joint coordinates are Blender's (Z up, character faces -Y); three.js shows them as (x, z, -y).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const toThree = (m) => new THREE.Vector3(m[0], m[2], -m[1]);
const toBlender = (v) => [v.x, -v.z, v.y];

// Same bone chain Rig builds. Stored spine joints follow the back; otherwise lerp.
const BONE_EDGES = [
  ["pelvis", "spine_01"], ["spine_01", "spine_02"], ["spine_02", "spine_03"],
  ["spine_03", "neck_base"], ["neck_base", "head"], ["head", "head_top"],
  ["spine_03", "clavicle_l"], ["clavicle_l", "upperarm_l"], ["upperarm_l", "lowerarm_l"],
  ["lowerarm_l", "hand_l"], ["hand_l", "hand_tip_l"],
  ["spine_03", "clavicle_r"], ["clavicle_r", "upperarm_r"], ["upperarm_r", "lowerarm_r"],
  ["lowerarm_r", "hand_r"], ["hand_r", "hand_tip_r"],
  ["pelvis", "thigh_l"], ["thigh_l", "calf_l"], ["calf_l", "foot_l"],
  ["foot_l", "ball_l"], ["ball_l", "toe_l"],
  ["pelvis", "thigh_r"], ["thigh_r", "calf_r"], ["calf_r", "foot_r"],
  ["foot_r", "ball_r"], ["ball_r", "toe_r"],
];

const DRAG_JOINTS = new Set([
  "pelvis", "neck", "head",
  "clavicle_l", "clavicle_r",
  "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r",
  "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r",
]);

const LABEL_JOINTS = new Set([
  "pelvis", "neck", "head",
  "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r",
  "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r",
]);

// Distinct joint colors: center = yellow, left = green/cyan, right = orange/magenta.
const JOINT_COLORS = {
  pelvis: 0xf0c040, neck: 0xffe066, head: 0xfff3b0, head_top: 0xfff8d6,
  clavicle_l: 0x2ec4b6, upperarm_l: 0x3ddc97, lowerarm_l: 0x56cfe1, hand_l: 0x7bdff2, hand_tip_l: 0xa0e7e5,
  thigh_l: 0x48bfe3, calf_l: 0x4ea8de, foot_l: 0x5390d9, ball_l: 0x5e60ce, toe_l: 0x7400b8,
  clavicle_r: 0xff8fab, upperarm_r: 0xff6b6b, lowerarm_r: 0xf72585, hand_r: 0xff85a1, hand_tip_r: 0xffb3c1,
  thigh_r: 0xff9f1c, calf_r: 0xfb8500, foot_r: 0xe36414, ball_r: 0xd00000, toe_r: 0x9d0208,
};

// First Action Forge pass. Orange handles scale a region. White dots follow until ticked.
export const LANDMARKS = [
  { id: "chin", label: "chin", tone: "anchor", joints: ["neck", "head", "head_top"], marker: "chin", lift: 0.025 },
  { id: "shoulder_l", label: "shoulder", side: "l", tone: "anchor", joints: ["upperarm_l", "clavicle_l"], follow: ["elbow_l"] },
  { id: "elbow_l", label: "elbow", side: "l", tone: "follow", joints: ["lowerarm_l"], parent: "shoulder_l", marker: "elbow_l" },
  { id: "wrist_l", label: "wrist", side: "l", tone: "anchor", joints: ["hand_l", "hand_tip_l"], marker: "wrist_l" },
  { id: "shoulder_r", label: "shoulder", side: "r", tone: "anchor", joints: ["upperarm_r", "clavicle_r"], follow: ["elbow_r"] },
  { id: "elbow_r", label: "elbow", side: "r", tone: "follow", joints: ["lowerarm_r"], parent: "shoulder_r", marker: "elbow_r" },
  { id: "wrist_r", label: "wrist", side: "r", tone: "anchor", joints: ["hand_r", "hand_tip_r"], marker: "wrist_r" },
  { id: "groin", label: "pelvis", tone: "anchor", joints: ["pelvis", "spine_01"], marker: "groin", lift: -0.05, follow: ["hip_l", "hip_r", "knee_l", "knee_r"] },
  { id: "hip_l", label: "hip", side: "l", tone: "follow", joints: ["thigh_l"], parent: "groin" },
  { id: "knee_l", label: "knee", side: "l", tone: "follow", joints: ["calf_l"], parent: "groin", marker: "knee_l" },
  { id: "ankle_l", label: "ankle", side: "l", tone: "anchor", joints: ["foot_l", "ball_l", "toe_l"] },
  { id: "hip_r", label: "hip", side: "r", tone: "follow", joints: ["thigh_r"], parent: "groin" },
  { id: "knee_r", label: "knee", side: "r", tone: "follow", joints: ["calf_r"], parent: "groin", marker: "knee_r" },
  { id: "ankle_r", label: "ankle", side: "r", tone: "anchor", joints: ["foot_r", "ball_r", "toe_r"] },
];

const LANDMARK_BY_ID = Object.fromEntries(LANDMARKS.map((s) => [s.id, s]));

const MIRROR = {
  shoulder_l: "shoulder_r", shoulder_r: "shoulder_l",
  elbow_l: "elbow_r", elbow_r: "elbow_l",
  wrist_l: "wrist_r", wrist_r: "wrist_l",
  hip_l: "hip_r", hip_r: "hip_l",
  knee_l: "knee_r", knee_r: "knee_l",
  ankle_l: "ankle_r", ankle_r: "ankle_l",
};

function landmarkLabel(spec) {
  return spec.side ? `${spec.side === "l" ? "L" : "R"} ${spec.label}` : spec.label;
}

function landmarkPoint(spec, joints, height) {
  const src = joints[spec.joints[0]];
  if (!src) return null;
  if (!spec.lift) return src.slice();
  return [src[0], src[1], src[2] + spec.lift * height];
}

function jointColor(name) {
  if (JOINT_COLORS[name] != null) return JOINT_COLORS[name];
  if (name.endsWith("_l")) return 0x3ddc97;
  if (name.endsWith("_r")) return 0xff6b6b;
  return 0xf0c040;
}

function withSpine(joints) {
  const J = { ...joints };
  const pel = J.pelvis, nk = J.neck;
  if (pel && nk) {
    const lerp = (t) => pel.map((c, i) => c + (nk[i] - c) * t);
    if (!J.spine_01) J.spine_01 = lerp(0.12);
    if (!J.spine_02) J.spine_02 = lerp(0.42);
    if (!J.spine_03) J.spine_03 = lerp(0.70);
    if (!J.neck_base) J.neck_base = lerp(0.93);
  }
  return J;
}

export class Viewer {
  constructor(box, mode, opts = {}) {
    this.box = box; this.mode = mode;
    this.hideClipBar = !!opts.hideClipBar;
    this.startClip = opts.startClip || null;
    this.studioDock = !!opts.studioDock;
    this.timeScale = 1;
    // Match Action Forge offset table (armSpace / armFwd in °, neutral 0).
    this.fit = { hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0 };
    this._bindQuats = null;
    this._bindPos = null;
    this._mixerQuats = null;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(devicePixelRatio);
    box.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101317);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(1, 2, 3); this.scene.add(sun);
    this.clock = new THREE.Clock();
    this.markers = {}; this.labels = {}; this.off = [];
    this.joints = {}; this.jointMeshes = {}; this.bones = null;
    this.poseHandles = {}; this.poseBones = []; this.restPose = null;
    this.animMode = "animate"; // animate | pose
    this.ready = false;
    this._resize = () => this.resize();
    addEventListener("resize", this._resize);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  load(url) {
    this.meshUrl = url;
    this._clearCharacter();
    return new Promise((resolve, reject) => new GLTFLoader().load(url, (gltf) => {
      this.root = gltf.scene;
      this.scene.add(this.root);
      this._dressBones();
      const box = new THREE.Box3().setFromObject(this.root);
      this.box3 = box;
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      this.H = size.y;
      if (this.mode === "markers") {
        this.size = size;
        this.center = c;
        this.half = Math.max(size.x, size.y) * 0.58;
        this.camera = new THREE.OrthographicCamera(-this.half, this.half, this.half, -this.half, 0.01, 100);
        this.root.traverse((o) => { if (o.isMesh) this.bodyMeshes = [...(this.bodyMeshes || []), o]; });
        this._makeViewBar();
        this.setOrthoView(this.orthoView || "front");
        this._bindDrag();
      } else {
        this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
        this.camera.position.set(c.x + size.y * 0.8, c.y + size.y * 0.2, c.z + size.y * 2.2);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.copy(c);
        this.controls.update();
        const grid = new THREE.GridHelper(size.y * 2, 20, 0x444444, 0x2a2a2a);
        grid.position.set(c.x, box.min.y, c.z);
        this.scene.add(grid);
        this.grid = grid;
      }
      if (this.mode === "anim") this._setupClips(gltf);
      this.resize();
      this.ready = true;
      resolve(this);
    }, undefined, (e) => { this.box.append(Object.assign(document.createElement("div"), { className: "drop", textContent: "Could not load the 3D file: " + e })); reject(e); }));
  }

  _clearCharacter() {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    if (this.controls) { this.controls.dispose(); this.controls = null; }
    if (this.root) { this.scene.remove(this.root); this.root = null; }
    for (const h of Object.values(this.poseHandles || {})) this.scene.remove(h);
    this.poseHandles = {};
    if (this._animBoneLines) { this.scene.remove(this._animBoneLines); this._animBoneLines = null; }
    this._animSkelOn = false;
    this._dressed = false;
    this.skeleton = null;
    this.poseBones = [];
    this.restPose = null;
    this.actions = {};
    this.current = null;
    this.playing = null;
    this._bindQuats = null;
    this._bindPos = null;
    this._mixerQuats = null;
    this._mixerPos = null;
    this.bodyMeshes = null;
    if (this.grid) { this.scene.remove(this.grid); this.grid = null; }
    if (this.modeBar) { this.modeBar.remove(); this.modeBar = null; }
    if (this.clipBar) { this.clipBar.remove(); this.clipBar = null; }
    if (this.animDock) { this.animDock.remove(); this.animDock = null; }
    if (this.viewBar) { this.viewBar.remove(); this.viewBar = null; }
  }

  // Mesh2Motion clips are a skeleton with no mesh. Capsules on the bones make a mannequin.
  _dressBones() {
    if (this._dressed || !this.root) return;
    let hasMesh = false;
    this.root.traverse((o) => { if (o.isMesh) hasMesh = true; });
    if (hasMesh) return;
    const bones = [];
    this.root.traverse((o) => { if (o.isBone) bones.push(o); });
    if (!bones.length) return;
    this._dressed = true;
    const mat = new THREE.MeshStandardMaterial({ color: 0xc4b8a8, roughness: 0.72, metalness: 0.02 });
    const body = /pelvis|spine|neck|head|clavicle|upperarm|lowerarm|hand|thigh|calf|foot|ball|index_|middle_|ring_|pinky_|thumb_/;
    const finger = /index_|middle_|ring_|pinky_|thumb_/;
    for (const b of bones) {
      if (!body.test(b.name)) continue;
      const digit = finger.test(b.name);
      for (const child of b.children) {
        if (!child.isBone) continue;
        const len = child.position.length();
        if (len < (digit ? 0.006 : 0.02)) continue;
        const radius = digit
          ? Math.min(0.012, Math.max(0.004, len * 0.22))
          : Math.min(0.045, Math.max(0.012, len * 0.16));
        const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, len - radius * 2), 3, 6);
        const mesh = new THREE.Mesh(geo, mat);
        const dir = child.position.clone().normalize();
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        mesh.position.copy(child.position).multiplyScalar(0.5);
        b.add(mesh);
      }
    }
    const head = bones.find((b) => b.name === "head");
    if (head) {
      const scalp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), mat);
      scalp.position.y = 0.08;
      head.add(scalp);
    }
  }

  demoJointPositions() {
    if (!this.root) return {};
    this.root.updateWorldMatrix(true, true);
    const byName = {};
    this.root.traverse((o) => { if (o.isBone && o.name) byName[o.name] = o; });
    const alias = { neck: "neck_01" };
    const want = ["pelvis", "neck", "head", "clavicle_l", "clavicle_r",
      "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r",
      "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r"];
    const v = new THREE.Vector3();
    const out = {};
    for (const name of want) {
      const bone = byName[name] || byName[alias[name]];
      if (!bone) continue;
      bone.getWorldPosition(v);
      out[name] = toBlender(v);
    }
    return out;
  }

  // -------------------------------------------------------------- animation + manual pose
  _setupClips(gltf) {
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    this.skeleton = null;
    this.root.traverse((o) => {
      if (o.isSkinnedMesh && o.skeleton && !this.skeleton) this.skeleton = o.skeleton;
    });
    if (!this.skeleton) {
      const bones = [];
      this.root.traverse((o) => { if (o.isBone) bones.push(o); });
      if (bones.length) {
        this.poseBones = bones;
        this.skeleton = { bones, update() {} };
      }
    }
    if (this.skeleton) {
      this.poseBones = this.skeleton.bones.slice();
      this.restPose = this.poseBones.map((b) => ({
        name: b.name,
        pos: b.position.clone(),
        quat: b.quaternion.clone(),
        scale: b.scale.clone(),
      }));
    }

    const hideClips = !!this.hideClipBar;
    const modeBar = document.createElement("div");
    modeBar.className = "clips animModes";
    for (const [id, label] of [["animate", "Animate"], ["pose", "Pose"]]) {
      const b = document.createElement("button");
      b.textContent = label; b.dataset.mode = id;
      b.onclick = () => this.setAnimMode(id);
      modeBar.append(b);
    }
    const reset = document.createElement("button");
    reset.textContent = "Reset pose"; reset.className = "ghostish";
    reset.onclick = () => this.resetPose();
    modeBar.append(reset);
    this.box.append(modeBar); this.modeBar = modeBar;
    if (hideClips || this.studioDock) modeBar.style.display = "none";

    const bar = document.createElement("div"); bar.className = "clips clipBar";
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
      const b = document.createElement("button");
      b.textContent = clip.name.replace("_", " "); b.dataset.clip = clip.name;
      b.onclick = () => this.play(clip.name);
      bar.append(b);
    }
    this.box.append(bar); this.clipBar = bar;
    if (hideClips || this.studioDock) bar.style.display = "none";

    let bones = 0, skinned = 0;
    this.root.traverse((o) => { if (o.isSkinnedMesh) { skinned++; bones = o.skeleton.bones.length; } });
    this.info = { skinned, bones, clips: gltf.animations.map((c) => c.name) };
    this._cacheBindPose();
    this._bindPoseDrag();
    if (this.studioDock) this._makeAnimDock();
    this._showAnimSkeleton(true); // AF-style: colored joints follow the playing pose
    this.setAnimMode("animate");
    const prefer = this.startClip;
    const first = (prefer && this.actions[prefer] && gltf.animations.find((c) => c.name === prefer))
      || gltf.animations.find((c) => c.name === "walk")
      || gltf.animations[0];
    if (first) this.play(first.name);
  }

  _cacheBindPose() {
    this._bindQuats = {};
    this._bindPos = {};
    this._mixerQuats = {};
    this._mixerPos = {};
    for (const b of this._allBones()) {
      this._bindQuats[b.name] = b.quaternion.clone();
      this._bindPos[b.name] = b.position.clone();
      this._mixerQuats[b.name] = b.quaternion.clone();
      this._mixerPos[b.name] = b.position.clone();
    }
  }

  _resetToBind() {
    if (!this._bindQuats) return;
    for (const b of this._allBones()) {
      const q = this._bindQuats[b.name];
      const p = this._bindPos[b.name];
      if (q) b.quaternion.copy(q);
      if (p) b.position.copy(p);
    }
  }

  _captureMixerPose() {
    if (!this._mixerQuats) this._mixerQuats = {};
    if (!this._mixerPos) this._mixerPos = {};
    for (const b of this._allBones()) {
      if (!b.name) continue;
      if (!this._mixerQuats[b.name]) this._mixerQuats[b.name] = b.quaternion.clone();
      else this._mixerQuats[b.name].copy(b.quaternion);
      if (!this._mixerPos[b.name]) this._mixerPos[b.name] = b.position.clone();
      else this._mixerPos[b.name].copy(b.position);
    }
  }

  _evalMixerAndFit(dt = 0) {
    // Bind → mixer (clip) → capture → AF offsets. Prevents fit from stacking when a
    // bone isn't written by the clip (or when scrubbing with timeScale 0).
    this._resetToBind();
    if (this.mixer) this.mixer.update(dt);
    this._captureMixerPose();
    this._applyFit();
  }

  setFit(fit) {
    this.fit = {
      hip: Number(fit?.hip) || 0,
      arms: fit?.arms == null ? 1 : Number(fit.arms),
      legs: fit?.legs == null ? 1 : Number(fit.legs),
      // AF: armSpace / armFwd in degrees, neutral 0. Legacy arm_raise maps into arm_space.
      arm_space: fit?.arm_space != null ? Number(fit.arm_space)
        : (fit?.arm_raise != null ? Number(fit.arm_raise) : 0),
      arm_fwd: Number(fit?.arm_fwd) || 0,
      turn: Number(fit?.turn) || 0,
    };
    // Live reshape from the clean mixer sample, including Pose mode.
    // Pose mode has no running action, so reapply onto the stored sample.
    if (this.animMode === "animate" && this.mixer && this.current) {
      this._evalMixerAndFit(0);
    } else if (this._mixerQuats) {
      this._applyFit();
    }
    this._syncAnimSkeleton();
  }

  _applyFit() {
    // Action Forge offset table (from AF app cache): additive ° on upperarms.
    // armSpace: axis [0,0,1], mirror, bones upperarm_l/r
    // armFwd:   axis [0,-1,0], mirror, bones upperarm_l/r
    // Always start from the last mixer pose so offsets never accumulate.
    if (!this._bindQuats) return;
    const f = this.fit || { hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0 };
    const armRe = /(clavicle|upperarm|lowerarm|hand)_([lr])$/i;
    const legRe = /(thigh|calf|foot|ball)_([lr])$/i;
    const spaceDeg = Number(f.arm_space) || 0;
    const fwdDeg = Number(f.arm_fwd) || 0;
    for (const b of this._allBones()) {
      const bindQ = this._bindQuats[b.name];
      const bindP = this._bindPos[b.name];
      if (!bindQ || !bindP) continue;
      const mixQ = this._mixerQuats && this._mixerQuats[b.name];
      const mixP = this._mixerPos && this._mixerPos[b.name];
      if (mixQ) b.quaternion.copy(mixQ);
      if (mixP) b.position.copy(mixP);
      const n = b.name;
      if (n === "pelvis") {
        b.position.y += Number(f.hip) || 0;
        if (f.turn) {
          const turn = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), f.turn * Math.PI / 180);
          b.quaternion.premultiply(turn);
        }
      }
      // Overdrive / stance: scale limb motion vs bind
      if (armRe.test(n) && f.arms !== 1) {
        const animated = b.quaternion.clone();
        b.quaternion.copy(bindQ).slerp(animated, f.arms);
      }
      if (legRe.test(n) && f.legs !== 1) {
        const animated = b.quaternion.clone();
        b.quaternion.copy(bindQ).slerp(animated, f.legs);
      }
      if (n === "upperarm_l" || n === "upperarm_r") {
        // Lockstep with export_pack._apply_fit_to_action: local q = q * R(axis, deg * mirror).
        // Arm-Space is +Z. Arms ↔ is (0, -1, 0). The right arm flips the angle.
        const mirror = n.endsWith("_r") ? -1 : 1;
        const applyOffset = (axisArr, deg) => {
          if (!deg) return;
          const off = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(axisArr[0], axisArr[1], axisArr[2]),
            deg * Math.PI / 180 * mirror);
          b.quaternion.multiply(off);
        };
        applyOffset([0, 0, 1], spaceDeg);
        applyOffset([0, -1, 0], fwdDeg);
      }
    }
    if (this.skeleton) this.skeleton.update();
  }

  _makeAnimDock() {
    const dock = document.createElement("div");
    dock.className = "animDock";
    dock.innerHTML = `
      <button type="button" data-act="play">Play</button>
      <button type="button" data-act="pause">Pause</button>
      <button type="button" data-act="pose">Pose</button>
      <button type="button" data-act="key">Key</button>
      <button type="button" data-act="skel" class="on">Rings</button>`;
    this.box.append(dock);
    this.animDock = dock;
    this._skelVisible = true;
    const bind = (act, fn) => {
      const btn = dock.querySelector(`[data-act="${act}"]`);
      if (btn) btn.onclick = fn;
    };
    bind("play", () => {
      this.resumePlay();
      const clips = (this.info && this.info.clips) || [];
      const name = (this.playing && this.actions[this.playing] && this.playing)
        || clips.find((n) => this.actions[n]);
      if (name) this.play(name);
    });
    bind("pause", () => { if (this.mixer) this.mixer.timeScale = 0; });
    bind("pose", () => {
      this.scrubTo(this.clipTime());
      this.setAnimMode("pose", { keepPose: true });
    });
    bind("key", () => { if (this.onKeyFrame) this.onKeyFrame(); });
    bind("skel", () => { this.setSkeletonVisible(!this._skelVisible); });
  }

  setSkeletonVisible(on) {
    this._skelVisible = !!on;
    if (this._skelVisible) {
      if (!this._animSkelOn) this._showAnimSkeleton(true);
      else {
        for (const s of Object.values(this.poseHandles)) s.visible = true;
        if (this._animBoneLines) this._animBoneLines.visible = true;
      }
    } else {
      for (const s of Object.values(this.poseHandles)) s.visible = false;
      if (this._animBoneLines) this._animBoneLines.visible = false;
    }
    const btn = this.animDock && this.animDock.querySelector('[data-act="skel"]');
    if (btn) btn.classList.toggle("on", this._skelVisible);
  }

  _updateAnimDock() {
    if (!this.animDock || !this.current) return;
    this._syncOverlayScrub();
  }

  _syncOverlayScrub() {
    // The frame scrub lives in the app overlay (#animScrub), not a second dock slider.
    const scrub = document.getElementById("animScrub");
    if (!scrub || document.activeElement === scrub) return;
    const fps = 30;
    const fr = Math.round(this.clipTime() * fps) + 1;
    const max = Number(scrub.max) || fr;
    const clamped = Math.min(max, Math.max(1, fr));
    scrub.value = String(clamped);
    const label = document.getElementById("animFrameVal");
    if (label) label.textContent = String(clamped);
  }

  setTimeScale(rate) {
    const r = Math.max(0.1, Math.min(3, Number(rate) || 1));
    if (this.mixer) this.mixer.timeScale = r;
    this.timeScale = r;
  }

  clipDuration() {
    if (!this.current) return 0;
    return this.current.getClip().duration || 0;
  }

  clipTime() {
    return this.current ? this.current.time : 0;
  }

  scrubTo(seconds) {
    if (!this.current || !this.mixer) return;
    const clip = this.current.getClip();
    const t = Math.max(0, Math.min(clip.duration, Number(seconds) || 0));
    this.mixer.timeScale = 0; // pause while scrubbing
    this.current.paused = false;
    this.current.time = t;
    this._evalMixerAndFit(0);
    this._syncAnimSkeleton();
  }

  resumePlay() {
    if (this.mixer) this.mixer.timeScale = this.timeScale || 1;
  }

  poseSnapshot() {
    const out = {};
    for (const b of this._allBones()) {
      if (!b.name || b.name === "root") continue;
      out[b.name] = {
        quat: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
        loc: [b.position.x, b.position.y, b.position.z],
      };
    }
    return out;
  }

  _applyPoseSnapshot(snap) {
    for (const b of this._allBones()) {
      const d = snap[b.name];
      if (!d) continue;
      b.quaternion.set(d.quat[0], d.quat[1], d.quat[2], d.quat[3]);
      b.position.set(d.loc[0], d.loc[1], d.loc[2]);
    }
    if (this.skeleton) this.skeleton.update();
    this._syncPoseHandles();
  }

  _allBones() {
    if (this.poseBones && this.poseBones.length) return this.poseBones;
    const list = [];
    this.root && this.root.traverse((o) => {
      if (o.isSkinnedMesh && o.skeleton) list.push(...o.skeleton.bones);
    });
    return list;
  }

  setAnimMode(mode, opts = {}) {
    this.animMode = mode === "pose" ? "pose" : "animate";
    if (this.modeBar) {
      this.modeBar.querySelectorAll("button[data-mode]").forEach((b) =>
        b.classList.toggle("on", b.dataset.mode === this.animMode));
    }
    if (this.clipBar) {
      this.clipBar.style.display = (this.animMode === "animate" && !this.hideClipBar) ? "flex" : "none";
    }
    if (this.animMode === "pose") {
      const snap = opts.keepPose ? this.poseSnapshot() : null;
      this.stopClips();
      if (snap) this._applyPoseSnapshot(snap);
      else this.resetPose();
      if (!this._animSkelOn) this._showAnimSkeleton(true);
      else this._syncAnimSkeleton();
      if (this.controls) this.controls.enabled = true;
    } else if (!opts.keepClip) {
      // Keep skeleton visible — it tracks the playing clip
      if (!this._animSkelOn) this._showAnimSkeleton(true);
      if (this.playing && this.actions[this.playing]) this.play(this.playing);
      else {
        const first = Object.keys(this.actions)[0];
        if (first) this.play(first);
      }
    } else if (!this._animSkelOn) {
      this._showAnimSkeleton(true);
    }
  }

  stopClips() {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.current = null;
    if (this.clipBar) this.clipBar.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
  }

  play(name) {
    if (!name || !this.actions || !this.actions[name]) return;
    if (this.animMode !== "animate") this.setAnimMode("animate", { keepClip: true });
    if (!this.actions[name]) return;
    const changed = this.playing !== name;
    if (this.current) this.current.fadeOut(0.2);
    this.current = this.actions[name].reset().fadeIn(0.2).play();
    this.playing = name;
    if (this.clipBar) {
      this.clipBar.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.clip === name));
    }
    if (changed && this._notifyClip && this.onClipChange) this.onClipChange(name);
  }

  resetPose() {
    if (!this.restPose) return;
    for (const rest of this.restPose) {
      const b = this.poseBones.find((x) => x.name === rest.name);
      if (!b) continue;
      b.position.copy(rest.pos);
      b.quaternion.copy(rest.quat);
      b.scale.copy(rest.scale);
    }
    if (this.skeleton) this.skeleton.update();
    this._syncPoseHandles();
  }

  _showAnimSkeleton(on) {
    // Control rings around the main joints, plus bone lines. Rings follow the pose.
    for (const h of Object.values(this.poseHandles)) this.scene.remove(h);
    this.poseHandles = {};
    if (this._animBoneLines) {
      this.scene.remove(this._animBoneLines);
      this._animBoneLines = null;
    }
    this._animSkelOn = !!on && !!this.poseBones.length;
    if (!this._animSkelOn) return;
    const H = this.H || 1;
    const byName = {};
    const finger = /^(index|middle|ring|pinky|thumb)_/;
    for (const bone of this.poseBones) {
      if (!bone.name || bone.name === "root") continue;
      byName[bone.name] = bone;
      if (finger.test(bone.name) || bone.name.includes("leaf") || bone.name.startsWith("ik_") || bone.name.startsWith("socket")) continue;
      const color = jointColor(bone.name);
      const big = /pelvis|spine|neck|head|thigh|clavicle/.test(bone.name);
      const s = new THREE.Mesh(
        new THREE.TorusGeometry(H * (big ? 0.05 : 0.032), H * 0.0032, 8, 24),
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      s.renderOrder = 12; s.name = bone.name; s.userData.bone = bone; s.userData.baseColor = color;
      this.scene.add(s); this.poseHandles[bone.name] = s;
    }
    // Bone sticks between joints that exist on this rig
    const pairs = [];
    for (const [a, b] of BONE_EDGES) {
      if (byName[a] && byName[b]) pairs.push([byName[a], byName[b]]);
    }
    // Also connect every bone to its parent when not already covered
    for (const bone of this.poseBones) {
      if (!bone.parent || !bone.parent.isBone || bone.name === "root") continue;
      if (!this.poseHandles[bone.name] || !this.poseHandles[bone.parent.name]) continue;
      pairs.push([bone.parent, bone]);
    }
    this._animBonePairs = pairs;
    const pos = new Float32Array(Math.max(1, pairs.length) * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this._animBoneLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0x9eb6ff, depthTest: false, transparent: true, opacity: 0.9,
    }));
    this._animBoneLines.renderOrder = 11;
    this.scene.add(this._animBoneLines);
    this._syncAnimSkeleton();
  }

  _showPoseHandles(on) {
    // Pose mode reuses the live anim skeleton; ensure it exists when entering Pose.
    if (on && !this._animSkelOn) this._showAnimSkeleton(true);
    this._syncAnimSkeleton();
  }

  _syncPoseHandles() {
    this._syncAnimSkeleton();
  }

  _syncAnimSkeleton() {
    if (!this._animSkelOn) return;
    const axis = new THREE.Vector3();
    const align = new THREE.Quaternion();
    for (const s of Object.values(this.poseHandles)) {
      const bone = s.userData.bone;
      if (!bone) continue;
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(s.position);
      axis.setFromMatrixColumn(bone.matrixWorld, 1);
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
      axis.normalize();
      align.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
      s.quaternion.copy(align);
    }
    if (this._animBoneLines && this._animBonePairs) {
      const attr = this._animBoneLines.geometry.getAttribute("position");
      const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
      let i = 0;
      for (const [a, b] of this._animBonePairs) {
        a.getWorldPosition(tmpA);
        b.getWorldPosition(tmpB);
        attr.setXYZ(i++, tmpA.x, tmpA.y, tmpA.z);
        attr.setXYZ(i++, tmpB.x, tmpB.y, tmpB.z);
      }
      attr.needsUpdate = true;
      this._animBoneLines.geometry.setDrawRange(0, i);
    }
  }

  _bindPoseDrag() {
    const cv = this.renderer.domElement, ray = new THREE.Raycaster();
    let drag = null, last = null;
    const onDown = (e) => {
      if (this.mode !== "anim" || this.animMode !== "pose") return;
      ray.setFromCamera(this._ndc(e), this.camera);
      const hit = ray.intersectObjects(Object.values(this.poseHandles), false)[0];
      if (!hit) return;
      drag = hit.object;
      last = { x: e.clientX, y: e.clientY };
      if (this.controls) this.controls.enabled = false;
      try { cv.setPointerCapture(e.pointerId); } catch { /* */ }
      e.stopPropagation();
    };
    const onMove = (e) => {
      if (!drag) return;
      const bone = drag.userData.bone;
      const dx = (e.clientX - last.x) * 0.01;
      const dy = (e.clientY - last.y) * 0.01;
      last = { x: e.clientX, y: e.clientY };
      bone.rotation.order = "XYZ";
      bone.rotation.y += dx;
      bone.rotation.x += dy;
      if (this.skeleton) this.skeleton.update();
      this._syncPoseHandles();
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      if (this.controls) this.controls.enabled = true;
    };
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    this._poseListeners = { onDown, onMove, onUp };
  }

  // ---------------------------------------------------------------- first markers (Action Forge landmark pass)
  _clearMarkerGraphics() {
    for (const m of Object.values(this.jointMeshes)) this.scene.remove(m);
    this.jointMeshes = {};
    if (this.bones) { this.scene.remove(this.bones); this.bones = null; }
    for (const m of Object.values(this.markers)) this.scene.remove(m);
    this.markers = {};
    for (const lab of Object.values(this.labels)) lab.remove();
    this.labels = {};
  }

  setLandmarks(joints, height, offJoints, offMarkers, solo, sym) {
    this._clearMarkerGraphics();
    this.jointValues = { ...(joints || {}) };
    this.landmarkPos = {};
    this.solo = new Set(solo || []);
    this.sym = sym !== false;
    this.jointsOff = offJoints || [];
    this.off = offMarkers || [];
    const H = height || this.H || 1;
    this._landmarkH = H;
    for (const spec of LANDMARKS) {
      const p = landmarkPoint(spec, this.jointValues, H);
      if (!p) continue;
      this.landmarkPos[spec.id] = p;
      const follow = spec.tone === "follow";
      const r = H * (follow ? 0.011 : 0.016);
      const base = follow ? 0xf4f4f4 : 0xff9f1c;
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({ color: base, depthTest: false, transparent: true, opacity: 0.95 }));
      s.renderOrder = 11;
      s.name = spec.id;
      s.userData.kind = "landmark";
      s.userData.tone = spec.tone;
      s.userData.follow = spec.follow || [];
      s.userData.baseColor = base;
      s.userData.drag = !follow || this.solo.has(spec.id);
      s.position.copy(toThree(p));
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r * 1.7, r * 0.16, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0x4da3ff, depthTest: false }));
      ring.visible = follow && this.solo.has(spec.id);
      s.add(ring);
      s.userData.ring = ring;
      this.scene.add(s);
      this.markers[spec.id] = s;
      const lab = document.createElement("div");
      lab.className = "label";
      lab.dataset.kind = "landmark";
      lab.textContent = landmarkLabel(spec);
      this.box.append(lab);
      this.labels[spec.id] = lab;
      this._paintLandmark(spec.id);
    }
  }

  setSym(on) {
    this.sym = !!on;
  }

  _mirrorPartner(id) {
    const other = MIRROR[id];
    const src = this.landmarkPos[id];
    const dst = other && this.landmarkPos[other];
    if (!src || !dst) return;
    const delta = [-src[0] - dst[0], src[1] - dst[1], src[2] - dst[2]];
    if (delta.some((c) => Math.abs(c) > 1e-6)) this._shiftLandmark(other, delta);
  }

  _holdSymmetry(id) {
    if (!this.sym) return;
    const spec = LANDMARK_BY_ID[id];
    const pos = this.landmarkPos[id];
    if (!spec || !pos) return;
    if (!spec.side) {
      if (Math.abs(pos[0]) > 1e-5) this._shiftLandmark(id, [-pos[0], 0, 0]);
      return;
    }
    this._mirrorPartner(id);
  }

  setSolo(names) {
    this.solo = new Set(names || []);
    for (const spec of LANDMARKS) {
      const s = this.markers[spec.id];
      if (!s) continue;
      const on = spec.tone === "follow" && this.solo.has(spec.id);
      s.userData.drag = spec.tone === "anchor" || on;
      if (s.userData.ring) s.userData.ring.visible = on;
      this._paintLandmark(spec.id);
    }
  }

  _shiftLandmark(id, delta) {
    const spec = LANDMARK_BY_ID[id];
    const cur = this.landmarkPos[id];
    const mesh = this.markers[id];
    if (!spec || !cur || !mesh) return;
    const next = cur.map((c, i) => c + delta[i]);
    this.landmarkPos[id] = next;
    mesh.position.copy(toThree(next));
    for (const jn of spec.joints) {
      if (!this.jointValues[jn]) continue;
      this.jointValues[jn] = this.jointValues[jn].map((c, i) => c + delta[i]);
    }
    this._paintLandmark(id);
  }

  _paintLandmark(id) {
    const s = this.markers[id];
    const spec = LANDMARK_BY_ID[id];
    if (!s || !spec) return;
    const listed = this.jointsOff.includes(spec.joints[0]) || (spec.marker && this.off.includes(spec.marker));
    const bad = this.bodyMeshes ? !this.onBodyAt(s.position) : listed;
    s.material.color.set(bad ? 0xe5534b : s.userData.baseColor);
    if (this.labels[id]) this.labels[id].classList.toggle("off", bad);
  }

  // ---------------------------------------------------------------- markers (legacy 8-dot set)
  setMarkers(markers, off) {
    for (const m of Object.values(this.markers)) this.scene.remove(m);
    for (const l of Object.values(this.labels)) {
      if (l.dataset && l.dataset.kind === "marker") l.remove();
    }
    this.markers = {};
    // Keep joint labels; only clear marker labels
    const keep = {};
    for (const [n, lab] of Object.entries(this.labels)) {
      if (lab.dataset && lab.dataset.kind === "joint") keep[n] = lab;
      else lab.remove();
    }
    this.labels = keep;
    const r = this.H * 0.008;
    for (const [name, p] of Object.entries(markers || {})) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x6b7280, depthTest: false, transparent: true, opacity: 0.55 }));
      s.renderOrder = 9; s.name = name; s.userData.kind = "marker"; s.userData.blender = p.slice();
      s.position.copy(toThree(p));
      this.scene.add(s); this.markers[name] = s;
    }
    this.setOffBody(off || []);
  }

  // ---------------------------------------------------------------- skeleton (AF-style joint check)
  setSkeleton(joints, off) {
    const full = withSpine(joints || {});
    this.jointValues = { ...(joints || {}) };
    const visible = Object.keys(full).filter((n) => !n.startsWith("spine_") && n !== "neck_base");
    const have = Object.keys(this.jointMeshes);
    if (have.length && have.length === visible.length && visible.every((n) => this.jointMeshes[n])) {
      for (const name of visible) {
        const p = joints[name] || full[name];
        const s = this.jointMeshes[name];
        s.userData.blender = p.slice();
        s.position.copy(toThree(p));
      }
      this._rebuildBones();
      this.setJointsOffBody(off || []);
      return;
    }
    for (const m of Object.values(this.jointMeshes)) this.scene.remove(m);
    for (const [n, lab] of Object.entries(this.labels)) {
      if (lab.dataset && lab.dataset.kind === "joint") lab.remove();
      else continue;
      delete this.labels[n];
    }
    this.jointMeshes = {};
    if (this.bones) { this.scene.remove(this.bones); this.bones = null; }

    const r = this.H * 0.012;
    for (const [name, p] of Object.entries(full)) {
      if (name.startsWith("spine_") || name === "neck_base") continue; // drawn as bone path only
      const drag = DRAG_JOINTS.has(name);
      const color = jointColor(name);
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(drag ? r : r * 0.65, 16, 12),
        new THREE.MeshBasicMaterial({
          color, depthTest: false, transparent: true, opacity: drag ? 0.95 : 0.7,
        }));
      s.renderOrder = 11; s.name = name; s.userData.kind = "joint"; s.userData.drag = drag;
      s.userData.baseColor = color;
      s.userData.blender = (joints[name] || p).slice();
      s.position.copy(toThree(joints[name] || p));
      this.scene.add(s); this.jointMeshes[name] = s;
      if (LABEL_JOINTS.has(name)) {
        const lab = document.createElement("div");
        lab.className = "label"; lab.dataset.kind = "joint";
        lab.textContent = name.replace(/_/g, " ");
        this.box.append(lab); this.labels[name] = lab;
      }
    }
    this._rebuildBones();
    this.setJointsOffBody(off || []);
  }

  _rebuildBones() {
    if (this.bones) { this.scene.remove(this.bones); this.bones = null; }
    const full = withSpine(this.jointValues || {});
    const pos = [];
    for (const [a, b] of BONE_EDGES) {
      if (!full[a] || !full[b]) continue;
      const A = toThree(full[a]), B = toThree(full[b]);
      pos.push(A.x, A.y, A.z, B.x, B.y, B.z);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.bones = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0x9eb6ff, depthTest: false, transparent: true, opacity: 0.85,
    }));
    this.bones.renderOrder = 10;
    this.scene.add(this.bones);
  }

  setOffBody(off) {
    this.off = off || [];
    for (const [n, s] of Object.entries(this.markers)) {
      const bad = this.off.includes(n);
      s.material.color.set(bad ? 0xe5534b : 0x6b7280);
    }
  }

  setJointsOffBody(off) {
    this.jointsOff = off || [];
    for (const [n, s] of Object.entries(this.jointMeshes)) {
      const bad = this.jointsOff.includes(n);
      s.material.color.set(bad ? 0xe5534b : (s.userData.baseColor || jointColor(n)));
      if (this.labels[n]) this.labels[n].classList.toggle("off", bad);
    }
  }

  markerValues() {
    const out = {};
    for (const [n, s] of Object.entries(this.markers)) out[n] = toBlender(s.position);
    return out;
  }

  skeletonValues() {
    const out = {};
    for (const [n, s] of Object.entries(this.jointMeshes)) {
      if (!DRAG_JOINTS.has(n) && !this.jointValues[n]) continue;
      out[n] = toBlender(s.position);
    }
    // Always send the stored set so tips stay put unless dragged parents moved them in jointValues
    return { ...this.jointValues, ...out };
  }

  // Front / Left / Right / Back / Free for skeleton adjustment
  _makeViewBar() {
    const bar = document.createElement("div");
    bar.className = "clips skelViews";
    for (const [id, label] of [
      ["front", "Front"], ["left", "Left"], ["right", "Right"], ["back", "Back"], ["free", "Free"],
    ]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.view = id;
      b.onclick = () => this.setOrthoView(id);
      bar.append(b);
    }
    this.box.append(bar);
    this.viewBar = bar;
  }

  setOrthoView(name) {
    this.orthoView = name || "front";
    const size = this.size || new THREE.Vector3(1, 1, 1);
    const c = this.center;
    if (this.orthoView === "free") {
      if (this.controls) { this.controls.dispose(); this.controls = null; }
      const dist = (size.y || 1) * 2.2;
      this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
      this.camera.position.set(c.x + size.y * 0.8, c.y + size.y * 0.2, c.z + dist);
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.copy(c);
      this.controls.update();
    } else {
      if (this.controls) { this.controls.dispose(); this.controls = null; }
      if (this.orthoView === "left" || this.orthoView === "right") {
        this.half = Math.max(size.z, size.y) * 0.58;
      } else {
        this.half = Math.max(size.x, size.y) * 0.58;
      }
      this.camera = new THREE.OrthographicCamera(-this.half, this.half, this.half, -this.half, 0.01, 100);
      this._placeOrthoCamera();
    }
    this.resize();
    if (this.viewBar) {
      this.viewBar.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.view === this.orthoView));
    }
  }

  _placeOrthoCamera() {
    if (!this.camera || !this.center || !this.box3 || this.orthoView === "free") return;
    if (!this.camera.isOrthographicCamera) return;
    const c = this.center, box = this.box3, dist = 5;
    this.camera.up.set(0, 1, 0);
    if (this.orthoView === "left") {
      this.camera.position.set(box.max.x + dist, c.y, c.z);
    } else if (this.orthoView === "right") {
      this.camera.position.set(box.min.x - dist, c.y, c.z);
    } else if (this.orthoView === "back") {
      this.camera.position.set(c.x, c.y, box.min.z - dist);
    } else {
      this.camera.position.set(c.x, c.y, box.max.z + dist);
    }
    this.camera.lookAt(c.x, c.y, c.z);
  }

  _dragPlane(pos) {
    if (this.orthoView === "free") {
      const n = new THREE.Vector3();
      this.camera.getWorldDirection(n);
      return new THREE.Plane().setFromNormalAndCoplanarPoint(n, pos);
    }
    if (this.orthoView === "left" || this.orthoView === "right") {
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), -pos.x);
    }
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), -pos.z);
  }

  onBodyAt(v) {
    const pad = 1;
    let origin, dir;
    if (this.orthoView === "free") {
      dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      origin = v.clone().addScaledVector(dir, -2);
    } else if (this.orthoView === "left") {
      origin = new THREE.Vector3(this.box3.max.x + pad, v.y, v.z);
      dir = new THREE.Vector3(-1, 0, 0);
    } else if (this.orthoView === "right") {
      origin = new THREE.Vector3(this.box3.min.x - pad, v.y, v.z);
      dir = new THREE.Vector3(1, 0, 0);
    } else if (this.orthoView === "back") {
      origin = new THREE.Vector3(v.x, v.y, this.box3.min.z - pad);
      dir = new THREE.Vector3(0, 0, 1);
    } else {
      origin = new THREE.Vector3(v.x, v.y, this.box3.max.z + pad);
      dir = new THREE.Vector3(0, 0, -1);
    }
    return new THREE.Raycaster(origin, dir).intersectObjects(this.bodyMeshes || [], false).length > 0;
  }

  _ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  _dragTargets() {
    const joints = Object.values(this.jointMeshes).filter((s) => s.userData.drag);
    if (joints.length) return joints;
    return Object.values(this.markers).filter((s) => s.userData.drag);
  }

  _bindDrag() {
    const cv = this.renderer.domElement, ray = new THREE.Raycaster();
    let drag = null;
    cv.onpointerdown = (e) => {
      ray.setFromCamera(this._ndc(e), this.camera);
      const hit = ray.intersectObjects(this._dragTargets(), false)[0];
      if (!hit) return;
      drag = hit.object;
      if (this.controls) this.controls.enabled = false;
      try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    };
    cv.onpointermove = (e) => {
      if (!drag) {
        ray.setFromCamera(this._ndc(e), this.camera);
        cv.style.cursor = ray.intersectObjects(this._dragTargets(), false).length ? "grab" : "default";
        return;
      }
      ray.setFromCamera(this._ndc(e), this.camera);
      const plane = this._dragPlane(drag.position);
      const p = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, p)) {
        if (drag.userData.kind === "landmark") {
          const next = toBlender(p);
          const prev = this.landmarkPos[drag.name];
          if (!prev) return;
          const delta = next.map((c, i) => c - prev[i]);
          const spec = LANDMARK_BY_ID[drag.name];
          if (this.sym && spec && !spec.side) delta[0] = 0;
          this._shiftLandmark(drag.name, delta);
          const moved = [drag.name];
          if (drag.userData.tone === "anchor") {
            for (const child of drag.userData.follow) {
              if (this.solo && this.solo.has(child)) continue;
              this._shiftLandmark(child, delta);
              moved.push(child);
            }
          }
          if (this.sym) {
            for (const id of moved) this._holdSymmetry(id);
          }
        } else {
          drag.position.copy(p);
          const bad = !this.onBodyAt(drag.position);
          if (drag.userData.kind === "joint") {
            this.jointValues[drag.name] = toBlender(drag.position);
            drag.material.color.set(bad ? 0xe5534b : (drag.userData.baseColor || jointColor(drag.name)));
            if (this.labels[drag.name]) this.labels[drag.name].classList.toggle("off", bad);
            this._rebuildBones();
          } else {
            drag.material.color.set(bad ? 0xe5534b : 0x6b7280);
          }
        }
      }
    };
    cv.onpointerup = () => {
      if (!drag) return;
      const kind = drag.userData.kind;
      drag = null;
      if (this.controls) this.controls.enabled = true;
      if (kind === "joint" || kind === "landmark") {
        this.onJointsChanged && this.onJointsChanged(this.skeletonValues());
      } else {
        this.onMarkersChanged && this.onMarkersChanged(this.markerValues());
      }
    };
  }

  // test hook: move a marker by an offset in Blender units, as a drag would
  nudge(name, dx, dz) {
    const s = this.jointMeshes[name] || this.markers[name];
    if (!s) return;
    s.position.x += dx; s.position.y += dz;
    if (s.userData.kind === "joint") {
      this.jointValues[name] = toBlender(s.position);
      this._rebuildBones();
      this.onJointsChanged && this.onJointsChanged(this.skeletonValues());
    } else {
      this.onMarkersChanged && this.onMarkersChanged(this.markerValues());
    }
  }

  // ------------------------------------------------------------------ frame
  resize() {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    if (!w || !h || !this.camera) return;
    this.renderer.setSize(w, h);
    if (this.camera.isPerspectiveCamera) { this.camera.aspect = w / h; }
    else {
      const a = w / h, half = this.half;
      Object.assign(this.camera, { left: -half * a, right: half * a, top: half, bottom: -half });
      this._placeOrthoCamera();
    }
    this.camera.updateProjectionMatrix();
  }

  frame() {
    if (!this.camera) return;
    const dt = this.clock.getDelta();
    if (this.mixer && this.animMode === "animate") {
      this._evalMixerAndFit(dt);
      this._updateAnimDock();
    }
    if (this.controls) this.controls.update();
    // Skeleton sticks to the animated pose every frame (AF-style)
    this._syncAnimSkeleton();
    this.renderer.render(this.scene, this.camera);
    if (this.mode === "markers") {
      const w = this.box.clientWidth, h = this.box.clientHeight;
      const dots = { ...this.jointMeshes, ...this.markers };
      for (const [n, s] of Object.entries(dots)) {
        const lab = this.labels[n];
        if (!lab) continue;
        const v = s.position.clone().project(this.camera);
        Object.assign(lab.style, { left: `${(v.x + 1) / 2 * w}px`, top: `${(1 - v.y) / 2 * h}px` });
      }
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    removeEventListener("resize", this._resize);
    if (this.controls) { this.controls.dispose(); this.controls = null; }
    if (this._poseListeners) {
      const cv = this.renderer.domElement;
      cv.removeEventListener("pointerdown", this._poseListeners.onDown);
      cv.removeEventListener("pointermove", this._poseListeners.onMove);
      cv.removeEventListener("pointerup", this._poseListeners.onUp);
    }
    this.renderer.dispose();
    this.box.replaceChildren();
  }
}

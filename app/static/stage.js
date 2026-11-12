import * as THREE from "three";
import { OrbitControls } from "/static/vendor/three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "/static/vendor/three/addons/loaders/GLTFLoader.js";

const toThree = (m) => new THREE.Vector3(m[0], m[2], -m[1]);
const toBlender = (v) => [v.x, -v.z, v.y];

const LANDMARKS = [
  { id: "chin", label: "chin", tone: "anchor", joints: ["neck", "head", "head_top"], lift: 0.025 },
  { id: "shoulder_l", label: "shoulder", tone: "anchor", joints: ["upperarm_l", "clavicle_l"], follow: ["elbow_l"] },
  { id: "elbow_l", label: "elbow", tone: "follow", joints: ["lowerarm_l"], parent: "shoulder_l" },
  { id: "wrist_l", label: "wrist", tone: "anchor", joints: ["hand_l"], follow: ["fingertip_l"] },
  { id: "fingertip_l", label: "fingertip", tone: "follow", joints: ["hand_tip_l"], parent: "wrist_l" },
  { id: "shoulder_r", label: "shoulder", tone: "anchor", joints: ["upperarm_r", "clavicle_r"], follow: ["elbow_r"] },
  { id: "elbow_r", label: "elbow", tone: "follow", joints: ["lowerarm_r"], parent: "shoulder_r" },
  { id: "wrist_r", label: "wrist", tone: "anchor", joints: ["hand_r"], follow: ["fingertip_r"] },
  { id: "fingertip_r", label: "fingertip", tone: "follow", joints: ["hand_tip_r"], parent: "wrist_r" },
  { id: "groin", label: "groin", tone: "anchor", joints: ["pelvis", "spine_01"], lift: -0.05, follow: ["hip_l", "hip_r", "knee_l", "knee_r"] },
  { id: "hip_l", label: "hip", tone: "follow", joints: ["thigh_l"], parent: "groin" },
  { id: "knee_l", label: "knee", tone: "follow", joints: ["calf_l"], parent: "groin" },
  { id: "ankle_l", label: "ankle", tone: "anchor", joints: ["foot_l", "ball_l", "toe_l"] },
  { id: "hip_r", label: "hip", tone: "follow", joints: ["thigh_r"], parent: "groin" },
  { id: "knee_r", label: "knee", tone: "follow", joints: ["calf_r"], parent: "groin" },
  { id: "ankle_r", label: "ankle", tone: "anchor", joints: ["foot_r", "ball_r", "toe_r"] },
];
const BY_ID = Object.fromEntries(LANDMARKS.map((s) => [s.id, s]));

function jointLabel(name) {
  let side = "";
  let text = name;
  if (text.endsWith("_l")) {
    side = " (L)";
    text = text.slice(0, -2);
  } else if (text.endsWith("_r")) {
    side = " (R)";
    text = text.slice(0, -2);
  }
  text = text.replace("upperarm", "upper arm").replace("lowerarm", "lower arm").replaceAll("_", " ");
  return text.replace(/\b\w/g, (ch) => ch.toUpperCase()) + side;
}

const AF_VIEW = {
  pelvis: "Hips",
  spine_01: "Low belly",
  spine_02: "Mid belly",
  spine_03: "Chest",
  neck_base: "Neck",
  head: "Head",
  head_top: "Crown",
  clavicle_l: "Collarbone",
  clavicle_r: "Collarbone",
  upperarm_l: "Shoulder",
  upperarm_r: "Shoulder",
  lowerarm_l: "Elbow",
  lowerarm_r: "Elbow",
  hand_l: "Wrist",
  hand_r: "Wrist",
  hand_tip_l: "Fingertip",
  hand_tip_r: "Fingertip",
  thigh_l: "Hip",
  thigh_r: "Hip",
  calf_l: "Knee",
  calf_r: "Knee",
  foot_l: "Ankle",
  foot_r: "Ankle",
  ball_l: "Toes",
  ball_r: "Toes",
  toe_l: "Toe tips",
  toe_r: "Toe tips",
};
const PLACE = {
  pelvis: "Center of the hips, where the legs meet the body",
  spine_01: "Low on the belly, just above the hips",
  spine_02: "On the belly, halfway up to the chest",
  spine_03: "On the chest",
  neck_base: "At the base of the neck, between the collarbones",
  head: "On the head, level with the jaw",
  head_top: "At the top of the head",
  clavicle_l: "On the left collarbone, from the base of the neck out to the shoulder",
  clavicle_r: "On the right collarbone, from the base of the neck out to the shoulder",
  upperarm_l: "On the left shoulder, where the arm leaves the body",
  upperarm_r: "On the right shoulder, where the arm leaves the body",
  lowerarm_l: "On the left elbow, at the bend of the arm",
  lowerarm_r: "On the right elbow, at the bend of the arm",
  hand_l: "On the left wrist",
  hand_r: "On the right wrist",
  hand_tip_l: "At the end of the left fingers",
  hand_tip_r: "At the end of the right fingers",
  thigh_l: "On the outside of the left hip",
  thigh_r: "On the outside of the right hip",
  calf_l: "On the left knee",
  calf_r: "On the right knee",
  foot_l: "On the left ankle",
  foot_r: "On the right ankle",
  ball_l: "Across the base of the left toes",
  ball_r: "Across the base of the right toes",
  toe_l: "At the tips of the left toes",
  toe_r: "At the tips of the right toes",
};
const ENDS = new Set(["head_top", "hand_tip_l", "hand_tip_r", "toe_l", "toe_r"]);
const SIDE = { c: 0xf5c542, l: 0x3d8bfd, r: 0xe23b3b };
const SIDE_END = { c: 0xc9a84a, l: 0x9ec1ff, r: 0xf0a0a0 };

export const SKELETON_DOTS = [
  "pelvis", "spine_01", "spine_02", "spine_03", "neck_base", "head", "head_top",
  "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "hand_tip_l",
  "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "hand_tip_r",
  "thigh_l", "calf_l", "foot_l", "ball_l", "toe_l",
  "thigh_r", "calf_r", "foot_r", "ball_r", "toe_r",
];

export function bonePlace(name) {
  const where = PLACE[name];
  return where ? where + ". It should sit on the body." : "It should sit on the body.";
}

export function boneLabel(name) {
  const base = AF_VIEW[name] || name;
  if (name.endsWith("_l")) return base + " (L)";
  if (name.endsWith("_r")) return base + " (R)";
  return base;
}

function sideKey(name) {
  if (name.endsWith("_l")) return "l";
  if (name.endsWith("_r")) return "r";
  return "c";
}

export function dotColor(name) {
  const key = sideKey(name);
  return ENDS.has(name) ? SIDE_END[key] : SIDE[key];
}

export function dotColorCss(name) {
  return "#" + dotColor(name).toString(16).padStart(6, "0");
}

export function visibleDots(joints) {
  const have = new Set(Object.keys(joints || {}).filter((name) => !name.includes("leaf") && name !== "neck"));
  const listed = SKELETON_DOTS.filter((id) => have.has(id));
  const extra = [...have].filter((id) => !SKELETON_DOTS.includes(id)).sort();
  return [...listed, ...extra];
}

const FINGER_WORD = { index: "Index", middle: "Middle", ring: "Ring", pinky: "Pinky", thumb: "Thumb" };

function keptFingers(fingers) {
  const drop = fingers === "mitten" ? ["index", "middle", "ring", "pinky", "thumb"]
    : fingers === "three" ? ["pinky", "ring"]
    : fingers === "four" ? ["pinky"]
    : [];
  return ["index", "middle", "ring", "pinky", "thumb"].filter((name) => !drop.includes(name));
}

function fingerLayout(joints, fingers, saved) {
  const digits = keptFingers(fingers).filter((name) => name !== "thumb");
  const lines = [];
  const dots = {};
  for (const side of ["l", "r"]) {
    const hand = joints[`hand_${side}`];
    const tip = joints[`hand_tip_${side}`];
    if (!hand || !tip) continue;
    const along = tip.map((value, i) => value - hand[i]);
    const len = Math.hypot(...along) || 1;
    const dir = along.map((value) => value / len);
    let sx = dir[1];
    let sy = -dir[0];
    let sz = 0;
    const span = Math.hypot(sx, sy, sz);
    if (span < 1e-4) { sx = 1; sy = 0; sz = 0; }
    else { sx /= span; sy /= span; }
    const axis = [-sx, -sy, -sz];
    const gap = len * 0.2;
    const addDigit = (name, index, count, endOf) => {
      const spread = (index - (count - 1) / 2) * gap;
      const knuckle = hand.map((value, i) => value + dir[i] * len * 0.22 + axis[i] * spread * 0.35);
      const id = `${name}_${side}`;
      const end = saved && saved[id] ? saved[id].slice() : endOf(spread);
      lines.push([knuckle, end]);
      dots[id] = end;
    };
    digits.forEach((name, index) => {
      addDigit(name, index, digits.length, (spread) => hand.map((value, i) => value + dir[i] * len + axis[i] * spread));
    });
    if (keptFingers(fingers).includes("thumb")) {
      const inward = -(Math.sign(hand[0]) || 1);
      const id = `thumb_${side}`;
      const knuckle = hand.map((value, i) => value + dir[i] * len * 0.08);
      const end = saved && saved[id]
        ? saved[id].slice()
        : hand.map((value, i) => value + dir[i] * len * 0.46 + axis[i] * inward * gap * 1.8 + (i === 2 ? -len * 0.12 : 0));
      lines.push([knuckle, end]);
      dots[id] = end;
    }
  }
  return { lines, dots };
}

function mirrorId(name) {
  if (name.endsWith("_l")) return name.slice(0, -1) + "r";
  if (name.endsWith("_r")) return name.slice(0, -1) + "l";
  return "";
}

function rotateAround(point, pivot, axis, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const v = point.map((value, i) => value - pivot[i]);
  const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const cross = [
    axis[1] * v[2] - axis[2] * v[1],
    axis[2] * v[0] - axis[0] * v[2],
    axis[0] * v[1] - axis[1] * v[0],
  ];
  return pivot.map((value, i) => value + v[i] * c + cross[i] * s + axis[i] * dot * (1 - c));
}

function unit(v) {
  const len = Math.hypot(...v) || 1;
  return v.map((value) => value / len);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const CHILD_OF = {};
for (const [parent, child] of [
  ["pelvis", "spine_01"], ["spine_01", "spine_02"], ["spine_02", "spine_03"],
  ["spine_03", "neck_base"], ["neck_base", "head"], ["head", "head_top"],
  ["neck_base", "clavicle_l"], ["clavicle_l", "upperarm_l"], ["upperarm_l", "lowerarm_l"], ["lowerarm_l", "hand_l"], ["hand_l", "hand_tip_l"],
  ["neck_base", "clavicle_r"], ["clavicle_r", "upperarm_r"], ["upperarm_r", "lowerarm_r"], ["lowerarm_r", "hand_r"], ["hand_r", "hand_tip_r"],
  ["pelvis", "thigh_l"], ["thigh_l", "calf_l"], ["calf_l", "foot_l"], ["foot_l", "ball_l"], ["ball_l", "toe_l"],
  ["pelvis", "thigh_r"], ["thigh_r", "calf_r"], ["calf_r", "foot_r"], ["foot_r", "ball_r"], ["ball_r", "toe_r"],
]) {
  (CHILD_OF[parent] ||= []).push(child);
}

function descendants(name) {
  const out = [];
  const walk = (id) => {
    for (const child of CHILD_OF[id] || []) {
      out.push(child);
      walk(child);
    }
  };
  walk(name);
  return out;
}

function limbAxis(joints, name, kind) {
  const child = (CHILD_OF[name] || []).map((id) => joints[id]).find(Boolean);
  const origin = joints[name];
  const dir = origin && child ? unit(child.map((value, i) => value - origin[i])) : [0, 1, 0];
  let bend = cross(dir, [0, 0, 1]);
  if (Math.hypot(...bend) < 1e-4) bend = cross(dir, [0, 1, 0]);
  bend = unit(bend);
  const swing = unit(cross(bend, dir));
  if (kind === "twist") return dir;
  if (kind === "swing") return swing;
  return bend;
}

export function poseLabel(name) {
  const word = FINGER_WORD[name.split("_")[0]];
  if (word) return word + (name.endsWith("_l") ? " (L)" : name.endsWith("_r") ? " (R)" : "");
  return boneLabel(name);
}

export { jointLabel };
const LINKS = [
  ["pelvis", "spine_01"], ["spine_01", "spine_02"], ["spine_02", "spine_03"],
  ["spine_03", "neck_base"], ["neck_base", "head"], ["head", "head_top"],
  ["neck_base", "clavicle_l"], ["clavicle_l", "upperarm_l"], ["upperarm_l", "lowerarm_l"], ["lowerarm_l", "hand_l"], ["hand_l", "hand_tip_l"],
  ["neck_base", "clavicle_r"], ["clavicle_r", "upperarm_r"], ["upperarm_r", "lowerarm_r"], ["lowerarm_r", "hand_r"], ["hand_r", "hand_tip_r"],
  ["pelvis", "thigh_l"], ["thigh_l", "calf_l"], ["calf_l", "foot_l"], ["foot_l", "ball_l"], ["ball_l", "toe_l"],
  ["pelvis", "thigh_r"], ["thigh_r", "calf_r"], ["calf_r", "foot_r"], ["foot_r", "ball_r"], ["ball_r", "toe_r"],
];
const MIRROR = { l: "r", r: "l" };

export class Stage {
  constructor(box) {
    this.box = box;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c10);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    box.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enableZoom = true;
    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("change", () => this._layoutLabels());
    this.loader = new GLTFLoader();
    this.clock = new THREE.Clock();
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.paused = false;
    this.timeScale = 1;
    this.hold = false;
    this.fit = { hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0, leg_space: 0 };
    this.view = "front";
    this.mode = "mesh";
    this.H = 1;
    this.joints = {};
    this.dots = {};
    this.bones = null;
    this.unlocked = new Set();
    this.sym = true;
    this.fingerTips = null;
    this.picked = null;
    this.rotating = false;
    this.labels = {};
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drag = null;
    this.plane = new THREE.Plane();
    this.hit = new THREE.Vector3();
    this.envelopes = new THREE.Group();
    this.scene.add(this.envelopes);
    this.light = new THREE.HemisphereLight(0xffffff, 0x223, 1.2);
    this.scene.add(this.light);
    this.grid = new THREE.GridHelper(4, 16, 0x445066, 0x2a3140);
    this.grid.visible = false;
    this.scene.add(this.grid);
    this._bind = {};
    this._posed = {};
    this.root = null;
    box.addEventListener("pointerdown", (e) => this._down(e));
    box.addEventListener("pointermove", (e) => this._move(e));
    window.addEventListener("pointerup", (e) => this._up(e));
    box.addEventListener("pointermove", (e) => this._hover(e));
    box.addEventListener("pointerleave", () => { if (!this.drag) this._beginHintFade(); });
    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    this.resize();
    this.setView("front");
    this._frame();
  }

  resize() {
    const w = this.box.clientWidth || 1;
    const h = this.box.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clearModel() {
    if (this.root) this.scene.remove(this.root);
    this.root = null;
    this._pivot = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this._bind = {};
    this._posed = {};
    this.mode = "empty";
    if (this.grid) this.grid.visible = false;
    this.clearOverlay();
  }

  clearOverlay() {
    this._clearDots();
    if (this.bones) {
      this.scene.remove(this.bones);
      this.bones = null;
    }
    this.envelopes.clear();
    this.fingerTips = null;
    this.picked = null;
    this._hideGrabLabel();
  }

  async loadMesh(url) {
    this.clearModel();
    const gltf = await this.loader.loadAsync(url);
    this.root = gltf.scene;
    this.scene.add(this.root);
    this._frameObject(this.root);
    this._placeGrid();
    this.mode = "mesh";
  }

  async loadRig(url, hold) {
    this.clearModel();
    const gltf = await this.loader.loadAsync(url);
    this.root = gltf.scene;
    this.scene.add(this.root);
    this.frameCharacter();
    this.hold = !!hold;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      this.actions[clip.name] = action;
    }
    this._cacheBind();
    this._placeGrid();
    this.mode = hold ? "pose" : "play";
  }

  actionName(name) {
    if (this.actions[name]) return name;
    const want = String(name || "").toLowerCase();
    return Object.keys(this.actions).find((key) => key.toLowerCase() === want) || "";
  }

  async playClip(name, url) {
    if (!this.mixer) return;
    let key = this.actionName(name);
    if (!key && url) {
      const gltf = await this.loader.loadAsync(url);
      const src = gltf.animations[0];
      if (!src) return;
      const clip = src.clone();
      clip.name = name;
      this._retargetClip(clip, gltf.scene);
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      this.actions[name] = action;
      key = name;
    }
    if (key) {
      this.play(key);
      this.mixer.update(0);
      this._snapshot();
      this._applyFit();
      this.frameCharacter();
    }
  }

  _retargetClip(clip, srcScene) {
    const srcBind = new Map();
    if (srcScene) {
      srcScene.updateMatrixWorld(true);
      srcScene.traverse((obj) => {
        if (obj.isBone) srcBind.set(obj.name, obj.quaternion.clone());
      });
    }
    if (!srcBind.size) return;
    let srcH = 0;
    if (srcScene) {
      const box = new THREE.Box3();
      srcScene.traverse((obj) => {
        if (obj.isBone) {
          const p = new THREE.Vector3();
          obj.getWorldPosition(p);
          box.expandByPoint(p);
        }
      });
      if (!box.isEmpty()) srcH = box.max.y - box.min.y;
    }
    const scale = srcH > 0 ? this.H / srcH : 1;
    const kept = [];
    for (const track of clip.tracks) {
      let parsed = null;
      try {
        parsed = THREE.PropertyBinding.parseTrackName(track.name);
      } catch (err) {
        parsed = null;
      }
      const bone = parsed ? parsed.nodeName : track.name.split(".")[0];
      const prop = parsed ? parsed.propertyName : track.name.split(".").pop();
      if (prop === "quaternion") {
        const qSrc = srcBind.get(bone);
        const bind = this._bind[bone];
        if (qSrc && bind) {
          const offset = bind.q.clone().multiply(qSrc.clone().invert());
          const values = track.values;
          for (let i = 0; i < values.length; i += 4) {
            const q = new THREE.Quaternion(values[i], values[i + 1], values[i + 2], values[i + 3]);
            q.premultiply(offset);
            values[i] = q.x;
            values[i + 1] = q.y;
            values[i + 2] = q.z;
            values[i + 3] = q.w;
          }
        }
        kept.push(track);
      } else if (prop === "position") {
        if (bone === "root") {
          if (scale !== 1) {
            const values = track.values;
            for (let i = 0; i < values.length; i += 3) {
              values[i] *= scale;
              values[i + 1] *= scale;
              values[i + 2] *= scale;
            }
          }
          kept.push(track);
        }
      }
    }
    clip.tracks = kept;
  }

  _characterCenter() {
    if (!this.root) return null;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    let count = 0;
    this.root.traverse((obj) => {
      if (!obj.isBone) return;
      obj.getWorldPosition(point);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return;
      box.expandByPoint(point);
      count += 1;
    });
    if (!count || box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    this.H = Math.max(size.y, 0.2);
    return box.getCenter(new THREE.Vector3());
  }

  _placeGrid() {
    if (!this.root || !this.grid) return;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, size.y, 0.5) * 4;
    this.grid.scale.setScalar(span / 4);
    this.grid.position.set(box.getCenter(new THREE.Vector3()).x, box.min.y, box.getCenter(new THREE.Vector3()).z);
    this.grid.visible = true;
  }

  frameCharacter() {
    const center = this._characterCenter();
    if (!center) {
      if (this.root) this._frameObject(this.root);
      return;
    }
    this.center = center;
    this._pivot = center.clone();
    this.controls.target.copy(center);
    if (this.view === "free") {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      this.camera.position.copy(center).add(dir.normalize().multiplyScalar(-Math.max(this.H * 1.8, 0.4)));
      this.camera.lookAt(center);
      this.controls.update();
      return;
    }
    this.setView(this.view);
  }

  _holdFrame() {
    const center = this._characterCenter();
    if (!center || !this._pivot) return;
    const delta = center.clone().sub(this._pivot);
    if (delta.lengthSq() < 1e-8) return;
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this._pivot.copy(center);
    this.center = center;
  }

  _frameObject(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.H = Math.max(size.y, 0.2);
    this.controls.target.copy(center);
    this.center = center;
    this.setView(this.view);
  }

  setView(name) {
    this.view = name;
    const center = this.center || new THREE.Vector3(0, this.H * 0.5, 0);
    const d = this.H * 1.8;
    const spots = {
      front: [center.x, center.y, center.z + d],
      back: [center.x, center.y, center.z - d],
      left: [center.x + d, center.y, center.z],
      right: [center.x - d, center.y, center.z],
    };
    this.controls.enabled = true;
    if (spots[name]) {
      this.camera.position.set(...spots[name]);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(center);
      this.controls.target.copy(center);
    }
    this.controls.update();
    document.querySelectorAll(".views button").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
  }

  _releaseView() {
    if (this.view === "free") return;
    this.view = "free";
    document.querySelectorAll(".views button").forEach((b) => b.classList.toggle("on", b.dataset.view === "free"));
  }

  setDots(joints, height, offJoints, offMarkers, unlocked) {
    if (this.drag) return;
    const stamp = JSON.stringify([joints, height, offJoints, offMarkers, unlocked]);
    if (stamp === this._dotsStamp && Object.keys(this.dots).length) {
      this.offJoints = offJoints || [];
      this.offMarkers = offMarkers || [];
      this._paintDots();
      return;
    }
    this._dotsStamp = stamp;
    this.joints = JSON.parse(JSON.stringify(joints || {}));
    this.H = height || this.H;
    this.offJoints = offJoints || [];
    this.offMarkers = offMarkers || [];
    this.unlocked = new Set(unlocked || []);
    this._clearDots();
    if (this.bones) {
      this.scene.remove(this.bones);
      this.bones = null;
    }
    for (const spec of LANDMARKS) {
      const src = this.joints[spec.joints[0]];
      if (!src) continue;
      const at = spec.lift ? [src[0], src[1], src[2] + spec.lift * this.H] : src.slice();
      const free = spec.tone === "anchor" || this.unlocked.has(spec.id);
      const color = free ? 0xff9f1c : 0xf4f4f4;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(this.H * 0.012, 16, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      mesh.position.copy(toThree(at));
      mesh.userData = { kind: "dot", id: spec.id, blender: at };
      mesh.renderOrder = 5;
      this.scene.add(mesh);
      this.dots[spec.id] = mesh;
    }
    this._paintDots();
  }

  setBones(joints, height, fingers, tips, live) {
    if ((this.drag || this.rotating) && !live) return;
    this.joints = JSON.parse(JSON.stringify(joints || {}));
    this.H = height || this.H;
    if (fingers) this.fingers = fingers;
    if (tips && !live) this.fingerTips = JSON.parse(JSON.stringify(tips));
    if (this.bones) this.scene.remove(this.bones);
    const fingersDrawn = fingerLayout(this.joints, this.fingers || "five", this.fingerTips);
    this.fingerTips = fingersDrawn.dots;
    const pos = [];
    const add = (a, b) => pos.push(...toThree(a).toArray(), ...toThree(b).toArray());
    for (const [a, b] of LINKS) {
      if (!this.joints[a] || !this.joints[b]) continue;
      add(this.joints[a], this.joints[b]);
    }
    for (const [a, b] of fingersDrawn.lines) add(a, b);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.bones = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.bones.renderOrder = 5;
    this.scene.add(this.bones);
    this._clearDots();
    for (const name of visibleDots(this.joints)) {
      const value = this.joints[name];
      if (!value) continue;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(this.H * 0.01, 12, 10),
        new THREE.MeshBasicMaterial({ color: dotColor(name), depthTest: false }),
      );
      mesh.position.copy(toThree(value));
      mesh.userData = { kind: "joint", id: name, blender: value.slice() };
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      this.dots[name] = mesh;
    }
    for (const [id, at] of Object.entries(this.fingerTips || {})) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(this.H * 0.011, 12, 10),
        new THREE.MeshBasicMaterial({ color: dotColor(id), depthTest: false }),
      );
      mesh.position.copy(toThree(at));
      mesh.userData = { kind: "finger", id, blender: at.slice() };
      mesh.renderOrder = 7;
      if (id === this.picked) mesh.scale.setScalar(1.6);
      this.scene.add(mesh);
      this.dots[id] = mesh;
    }
    const picked = this.dots[this.picked];
    if (picked && picked.userData.kind === "joint") picked.scale.setScalar(1.45);
  }

  showEnvelopes(on, scales) {
    this.envelopes.clear();
    if (!on) return;
    for (const name of ["pelvis", "spine_01", "spine_02", "spine_03", "thigh_l", "thigh_r"]) {
      if (!this.joints[name]) continue;
      const sc = (scales && scales[name]) || 1;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(this.H * 0.08 * sc, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      sphere.position.copy(toThree(this.joints[name]));
      this.envelopes.add(sphere);
    }
  }

  _clearDots() {
    for (const mesh of Object.values(this.dots)) this.scene.remove(mesh);
    for (const lab of Object.values(this.labels)) lab.remove();
    this.dots = {};
    this.labels = {};
  }

  _paintDots() {
    for (const spec of LANDMARKS) {
      const mesh = this.dots[spec.id];
      if (!mesh) continue;
      const free = spec.tone === "anchor" || this.unlocked.has(spec.id);
      const bad = this.offJoints.includes(spec.joints[0]) || this.offMarkers.includes(spec.id);
      mesh.material.color.set(bad ? 0xe5534b : free ? 0xff9f1c : 0xf4f4f4);
    }
  }

  dismissHint() {
    clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.hintFading = false;
    this._hideGrabLabel();
  }

  _hover(ev) {
    if (this.drag) return;
    const hit = this._pick(ev);
    if (hit) {
      this._showGrabLabel(hit.userData.id);
      return;
    }
    this._beginHintFade();
  }

  _labelPoint(mesh) {
    if (!mesh) return null;
    this.camera.updateWorldMatrix(true, false);
    const p = mesh.getWorldPosition(new THREE.Vector3()).project(this.camera);
    if (![p.x, p.y, p.z].every(Number.isFinite) || p.z < -1 || p.z > 1) return null;
    const canvas = this.renderer.domElement.getBoundingClientRect();
    const host = this.box.getBoundingClientRect();
    const x = (p.x * 0.5 + 0.5) * canvas.width + (canvas.left - host.left);
    const y = (-p.y * 0.5 + 0.5) * canvas.height + (canvas.top - host.top);
    if (x < 0 || y < 0 || x > host.width || y > host.height) return null;
    if (y < 38 && x < 300) return null;
    return { x, y };
  }

  _layoutLabels() {
    if (this.grabLabel && !this.grabLabel.hidden) this._placeGrabLabel();
  }

  _pick(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(Object.values(this.dots), false);
    return hits[0] ? hits[0].object : null;
  }

  _down(ev) {
    const hit = this._pick(ev);
    if (!hit) {
      if (ev.button === 0) this._releaseView();
      return;
    }
    this.controls.enabled = false;
    const spec = BY_ID[hit.userData.id];
    if (spec && spec.tone === "follow" && !this.unlocked.has(spec.id)) {
      this.unlocked.add(spec.id);
      this._paintDots();
      this.onUnlocked && this.onUnlocked(spec.id);
    }
    this.drag = { id: hit.userData.id, kind: hit.userData.kind, last: hit.userData.blender.slice() };
    this.picked = this.drag.id;
    this.onPick && this.onPick(this.picked);
    this._showGrabLabel(this.drag.id);
    this._planeThrough(hit.position);
    ev.preventDefault();
  }

  _planeThrough(point) {
    const normal = new THREE.Vector3();
    if (this.view === "left" || this.view === "right") normal.set(1, 0, 0);
    else if (this.view === "front" || this.view === "back") normal.set(0, 0, 1);
    else this.camera.getWorldDirection(normal);
    this.plane.setFromNormalAndCoplanarPoint(normal, point);
  }

  _move(ev) {
    if (!this.drag) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
    const next = toBlender(this.hit);
    const prev = this.drag.last;
    const delta = next.map((c, i) => c - prev[i]);
    if (Math.hypot(...delta) > this.H * 0.5) return;
    if (this.view === "front" || this.view === "back") delta[1] = 0;
    if (this.view === "left" || this.view === "right") delta[0] = 0;
    this.drag.last = prev.map((c, i) => c + delta[i]);
    if (this.drag.kind === "dot") this._shiftDot(this.drag.id, delta);
    else if (this.drag.kind === "finger") this._shiftFinger(this.drag.id, delta);
    else this._shiftJoint(this.drag.id, delta);
    if (this.sym) this._mirrorShift(this.drag.id, delta);
    this._placeGrabLabel();
  }

  _shiftDot(id, delta) {
    const spec = BY_ID[id];
    if (!spec) return;
    const mesh = this.dots[id];
    const at = mesh.userData.blender.map((c, i) => c + delta[i]);
    if (id === "chin" || id === "groin") at[0] = 0;
    mesh.userData.blender = at;
    mesh.position.copy(toThree(at));
    for (const name of spec.joints) {
      if (this.joints[name]) this.joints[name] = this.joints[name].map((c, i) => c + (name.startsWith("head") || name === "neck" || name === "pelvis" || name.startsWith("spine") ? delta[i] : delta[i]));
    }
    for (const child of spec.follow || []) {
      if (this.unlocked.has(child)) continue;
      this._shiftDot(child, delta);
    }
  }

  _shiftJoint(name, delta) {
    if (!this.joints[name]) return;
    this.joints[name] = this.joints[name].map((c, i) => c + delta[i]);
    const mesh = this.dots[name];
    if (mesh) {
      mesh.userData.blender = this.joints[name].slice();
      mesh.position.copy(toThree(this.joints[name]));
    }
    this.setBones(this.joints, this.H, this.fingers, null, true);
  }

  _shiftFinger(id, delta) {
    if (!this.fingerTips?.[id]) return;
    this.fingerTips[id] = this.fingerTips[id].map((value, i) => value + delta[i]);
    this.setBones(this.joints, this.H, this.fingers, null, true);
  }

  rotateSelection(axis, deltaDeg) {
    if (!this.picked || !deltaDeg) return;
    if (this.fingerTips?.[this.picked]) this._spinFinger(this.picked, axis, deltaDeg);
    else this._spinLimb(this.picked, axis, deltaDeg);
    this.setBones(this.joints, this.H, this.fingers, null, true);
  }

  _spinLimb(name, axis, deg) {
    const pivot = this.joints[name];
    if (!pivot) return;
    const ids = descendants(name);
    const side = name.endsWith("_l") ? "l" : name.endsWith("_r") ? "r" : "";
    const tips = [];
    if (side && (name === `hand_${side}` || ids.includes(`hand_${side}`))) {
      for (const key of Object.keys(this.fingerTips || {})) {
        if (key.endsWith(`_${side}`)) tips.push(key);
      }
    }
    const rad = deg * Math.PI / 180;
    const ax = limbAxis(this.joints, name, axis);
    for (const id of ids) {
      if (this.joints[id]) this.joints[id] = rotateAround(this.joints[id], pivot, ax, rad);
    }
    for (const id of tips) {
      if (this.fingerTips[id]) this.fingerTips[id] = rotateAround(this.fingerTips[id], pivot, ax, rad);
    }
    this._mirrorSpin(name, ids, tips);
  }

  _spinFinger(id, axis, deg) {
    const side = id.endsWith("_l") ? "l" : "r";
    const pivotName = `hand_${side}`;
    const pivot = this.joints[pivotName];
    const tip = this.fingerTips[id];
    if (!pivot || !tip) return;
    const dir = unit(tip.map((value, i) => value - pivot[i]));
    let bend = cross(dir, [0, 0, 1]);
    if (Math.hypot(...bend) < 1e-4) bend = cross(dir, [0, 1, 0]);
    bend = unit(bend);
    const swing = unit(cross(bend, dir));
    const ax = axis === "twist" ? dir : axis === "swing" ? swing : bend;
    this.fingerTips[id] = rotateAround(tip, pivot, ax, deg * Math.PI / 180);
    this._mirrorSpin(pivotName, [], [id]);
  }

  _mirrorSpin(pivotName, ids, tips) {
    if (!this.sym) return;
    const other = mirrorId(pivotName);
    const pivot = this.joints[pivotName];
    const opivot = other && this.joints[other];
    if (!pivot || !opivot) return;
    const copy = (id, book) => {
      const mirrored = mirrorId(id);
      if (!mirrored || !book[id] || !book[mirrored]) return;
      const delta = book[id].map((value, i) => value - pivot[i]);
      delta[0] = -delta[0];
      book[mirrored] = opivot.map((value, i) => value + delta[i]);
    };
    for (const id of ids) copy(id, this.joints);
    for (const id of tips) copy(id, this.fingerTips);
  }

  _mirrorShift(id, delta) {
    const flip = delta.slice();
    flip[0] = -delta[0];
    if (id.endsWith("_l") || id.endsWith("_r")) {
      const other = id.slice(0, -1) + (id.endsWith("_l") ? "r" : "l");
      if (this.drag.kind === "dot" && BY_ID[other]) this._shiftDot(other, flip);
      if (this.drag.kind === "joint" && this.joints[other]) this._shiftJoint(other, flip);
      if (this.drag.kind === "finger" && this.fingerTips?.[other]) this._shiftFinger(other, flip);
    }
  }

  _up() {
    this.controls.enabled = true;
    if (!this.drag) return;
    const moved = this.drag.id;
    this.drag = null;
    this._beginHintFade();
    this.onJoints && this.onJoints(this.joints, moved);
  }

  _showGrabLabel(id) {
    if (!this.grabLabel) {
      const lab = document.createElement("div");
      lab.className = "label";
      this.box.appendChild(lab);
      this.grabLabel = lab;
    }
    const changed = this.hintId !== id || this.grabLabel.hidden || this.hintFading;
    clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.hintFading = false;
    this.grabLabel.hidden = false;
    this.grabLabel.style.opacity = "1";
    if (changed) {
      this.grabLabel.replaceChildren();
      const landmark = BY_ID[id];
      const finger = FINGER_WORD[id.split("_")[0]];
      const name = document.createElement("b");
      name.textContent = finger ? poseLabel(id) : landmark ? jointLabel(id) : boneLabel(id);
      name.style.color = landmark || finger ? "#ffffff" : dotColorCss(id);
      this.grabLabel.append(name);
      if (!landmark && !finger) {
        const where = document.createElement("small");
        where.textContent = bonePlace(id);
        this.grabLabel.append(where);
      }
    }
    this.hintId = id;
    this._placeGrabLabel();
  }

  _beginHintFade() {
    if (this.hintFading || !this.grabLabel || this.grabLabel.hidden) return;
    this.hintFading = true;
    clearTimeout(this.hintTimer);
    this.grabLabel.style.opacity = "0";
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null;
      this.hintFading = false;
      this._hideGrabLabel();
    }, 400);
  }

  _placeGrabLabel() {
    const mesh = this.dots[this.hintId];
    const lab = this.grabLabel;
    if (!mesh || !lab || lab.hidden) return;
    const at = this._labelPoint(mesh);
    if (!at) {
      lab.hidden = true;
      return;
    }
    lab.hidden = false;
    lab.style.left = `${at.x}px`;
    lab.style.top = `${at.y}px`;
  }

  _hideGrabLabel() {
    this.hintId = null;
    if (this.grabLabel) this.grabLabel.hidden = true;
  }

  play(name) {
    const action = this.actions[name];
    if (!action) return;
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    if (this.current === action) {
      action.paused = false;
      this.paused = false;
      return;
    }
    if (this.current) this.current.stop();
    action.reset().setEffectiveWeight(1).play();
    this.current = action;
    this.paused = false;
    this.mode = "play";
  }

  pause() {
    this.paused = true;
    if (this.current) this.current.paused = true;
  }

  restart() {
    if (!this.current) return;
    this.current.reset().setEffectiveWeight(1).play();
    this.current.time = 0;
    this.paused = false;
    this.current.paused = false;
    this.mixer.update(0);
    this._snapshot();
    this._applyFit();
  }

  playback() {
    const duration = this.current ? this.current.getClip().duration : 0;
    const time = this.current ? this.current.time % (duration || 1) : 0;
    return { time, duration, paused: this.paused || !this.current, speed: this.timeScale || 1 };
  }

  scrub(seconds) {
    if (!this.current) return;
    this.paused = true;
    this.current.paused = true;
    this.current.time = Math.max(0, seconds);
    this.mixer.update(0);
  }

  setSpeed(scale) {
    this.timeScale = scale;
  }

  setFit(fit) {
    this.fit = { ...this.fit, ...fit };
  }

  _cacheBind() {
    this.root.traverse((obj) => {
      if (obj.isBone) this._bind[obj.name] = { q: obj.quaternion.clone(), p: obj.position.clone() };
    });
  }

  _snapshot() {
    this.root.traverse((obj) => {
      if (obj.isBone) {
        this._posed[obj.name] = { q: obj.quaternion.clone(), p: obj.position.clone() };
      }
    });
  }

  _applyFit() {
    const armNames = ["upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "clavicle_l", "clavicle_r"];
    const legNames = ["thigh_l", "thigh_r", "calf_l", "calf_r"];
    if (!this.root) return;
    this.root.traverse((obj) => {
      if (!obj.isBone || !this._bind[obj.name]) return;
      const bind = this._bind[obj.name];
      const posed = (this._posed[obj.name] || bind).q;
      let scale = 1;
      if (armNames.includes(obj.name)) scale = this.fit.arms;
      if (legNames.includes(obj.name)) scale = this.fit.legs;
      obj.quaternion.copy(bind.q).slerp(posed, scale);
      const base = (this._posed[obj.name] || bind).p;
      obj.position.copy(base);
      if (obj.name === "pelvis") obj.position.y += this.fit.hip;
      if (obj.name === "root" || obj.name === "pelvis") {
        obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(this.fit.turn)));
      }
      const side = obj.name.endsWith("_l") ? 1 : obj.name.endsWith("_r") ? -1 : 0;
      if (obj.name.startsWith("thigh")) {
        obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad((this.fit.leg_space || 0) * side)));
      }
      if (obj.name.startsWith("upperarm")) {
        obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(this.fit.arm_space * side)));
        obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(this.fit.arm_fwd)));
      }
    });
  }

  _restorePose() {
    if (!this.root) return;
    this.root.traverse((obj) => {
      const pose = this._posed[obj.name];
      if (!obj.isBone || !pose) return;
      obj.quaternion.copy(pose.q);
      obj.position.copy(pose.p);
    });
  }

  _frame() {
    requestAnimationFrame(() => this._frame());
    const dt = this.clock.getDelta();
    if (this.mixer && this.mode === "play" && !this.paused) {
      this._restorePose();
      this.mixer.update(dt * (this.timeScale || 1));
      this._snapshot();
      this._holdFrame();
    }
    if (this.mode === "play" || this.mode === "pose") this._applyFit();
    if (this.onPlayback) this.onPlayback(this.playback());
    this.controls.update();
    this._layoutLabels();
    this.renderer.render(this.scene, this.camera);
  }
}

export { LANDMARKS };

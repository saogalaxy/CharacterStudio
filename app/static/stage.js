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
  neck_01: "Neck",
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
  breast_l: "Breast",
  breast_r: "Breast",
  glute_l: "Butt",
  glute_r: "Butt",
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
  pelvis: "Center of the hips where the legs meet the body — pelvic core, slightly behind the front crease",
  spine_01: "Low belly, just above the hips — keep toward the back of the torso, not on the front wall",
  spine_02: "Mid torso / ribcage — about 60–70% back from the front so the sides stay full",
  spine_03: "Chest / upper spine — sit deep in the torso; too far forward collapses the chest",
  breast_l: "Left breast tissue — added at bind, no dot to place; mark J on Rig to jiggle it",
  breast_r: "Right breast tissue — added at bind, no dot to place; mark J on Rig to jiggle it",
  glute_l: "Left butt tissue — added at bind, no dot to place; mark J on Rig to jiggle it",
  glute_r: "Right butt tissue — added at bind, no dot to place; mark J on Rig to jiggle it",
  neck_base: "Base of the neck between the collarbones, slightly toward the back of the neck",
  head: "Head pivot at jaw / ear height, inside the skull",
  head_top: "Top of the head, centered over the skull vault",
  clavicle_l: "Left collarbone from the neck base out toward the shoulder",
  clavicle_r: "Right collarbone from the neck base out toward the shoulder",
  upperarm_l: "Left shoulder socket where the arm leaves the body, inside the deltoid",
  upperarm_r: "Right shoulder socket where the arm leaves the body, inside the deltoid",
  lowerarm_l: "Left elbow at the bend — slight back bias so the arm folds forward",
  lowerarm_r: "Right elbow at the bend — slight back bias so the arm folds forward",
  hand_l: "Left wrist crease, not inside the palm",
  hand_r: "Right wrist crease, not inside the palm",
  hand_tip_l: "Tips of the left fingers",
  hand_tip_r: "Tips of the right fingers",
  thigh_l: "Outside of the left hip / femur head — not on the front hip crease",
  thigh_r: "Outside of the right hip / femur head — not on the front hip crease",
  calf_l: "Left knee, slightly forward of the hip-to-ankle line",
  calf_r: "Right knee, slightly forward of the hip-to-ankle line",
  foot_l: "Left ankle toward the heel / rear shin",
  foot_r: "Right ankle toward the heel / rear shin",
  ball_l: "Base of the left toes (ball of the foot)",
  ball_r: "Base of the right toes (ball of the foot)",
  toe_l: "Tips of the left toes",
  toe_r: "Tips of the right toes",
};
const ENDS = new Set(["head_top", "hand_tip_l", "hand_tip_r", "toe_l", "toe_r"]);
const SIDE = { c: 0xf5c542, l: 0x3d8bfd, r: 0xe23b3b };
const SIDE_END = { c: 0xc9a84a, l: 0x9ec1ff, r: 0xf0a0a0 };

export const ENVELOPE_BONES = [
  "head", "neck_01", "clavicle_l", "clavicle_r", "spine_03",
  "upperarm_l", "lowerarm_l", "hand_l",
  "upperarm_r", "lowerarm_r", "hand_r",
  "spine_02", "spine_01", "pelvis",
  "thigh_l", "calf_l", "foot_l",
  "thigh_r", "calf_r", "foot_r",
  "breast_l", "breast_r", "glute_l", "glute_r",
];
// Tissue bones have no markers.json joints: their envelope runs from the
// parent joint to the bind pivot (see extra_bone_frames).
const ENVELOPE_TISSUE_PARENT = {
  breast_l: "spine_03",
  breast_r: "spine_03",
  glute_l: "pelvis",
  glute_r: "pelvis",
};
const ENVELOPE_COLOR = {
  pelvis: 0xf5c542,
  spine_01: 0x8fd14f,
  spine_02: 0x3dcc9a,
  spine_03: 0x3d8bfd,
  breast_l: 0xf472b6,
  breast_r: 0xfb7185,
  glute_l: 0xc084fc,
  glute_r: 0xa78bfa,
  neck_01: 0xb07cff,
  head: 0xf0a0ff,
  clavicle_l: 0x5ec8ff,
  upperarm_l: 0x6256e8,
  lowerarm_l: 0x2ec4b6,
  hand_l: 0x7d8cff,
  clavicle_r: 0xff8a5b,
  upperarm_r: 0xe23b3b,
  lowerarm_r: 0xff5e8a,
  hand_r: 0xffb020,
  thigh_l: 0x4aa3ff,
  calf_l: 0x20d0c8,
  foot_l: 0x8b7cff,
  thigh_r: 0xff6b4a,
  calf_r: 0xff4d6d,
  foot_r: 0xffc14d,
};

export function envelopeColorCss(name) {
  const color = ENVELOPE_COLOR[name] || 0xd4c8d8;
  return "#" + color.toString(16).padStart(6, "0");
}
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _envA = new THREE.Vector3();
const _envB = new THREE.Vector3();
const _envDir = new THREE.Vector3();

function envelopeRadius(height, scale) {
  return Math.max(height, 0.2) * 0.08 * (scale || 1);
}

function placeCapsule(hold, from, to, radius) {
  const length = from.distanceTo(to);
  const tube = hold.children[0];
  const capA = hold.children[1];
  const capB = hold.children[2];
  if (!tube || length < 1e-4) {
    hold.visible = false;
    return false;
  }
  hold.scale.set(1, 1, 1);
  hold.position.copy(from).lerp(to, 0.5);
  _envDir.subVectors(to, from).normalize();
  hold.quaternion.setFromUnitVectors(Y_AXIS, _envDir);
  tube.scale.set(radius, length, radius);
  capA.position.set(0, length * 0.5, 0);
  capB.position.set(0, -length * 0.5, 0);
  capA.scale.setScalar(radius);
  capB.scale.setScalar(radius);
  hold.visible = !hold.userData.hidden;
  return true;
}

function makeCapsule(tubeGeo, capGeo, color) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.34, depthWrite: false });
  const hold = new THREE.Group();
  hold.renderOrder = 2;
  hold.userData.mat = mat;
  for (const geo of [tubeGeo, capGeo, capGeo]) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    hold.add(mesh);
  }
  return hold;
}

// Unit octahedral bone along +Y from head (0) to tip (1), Blender proportions.
const OCTA_WIDTH = 0.12;
let _octaGeo = null;
function octaBoneGeo() {
  if (_octaGeo) return _octaGeo;
  const s = OCTA_WIDTH;
  const verts = new Float32Array([
    0, 0, 0,
    s, s, 0,
    0, s, s,
    -s, s, 0,
    0, s, -s,
    0, 1, 0,
  ]);
  const idx = [
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1,
    5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  _octaGeo = geo;
  return geo;
}

function placeOctaBone(mesh, from, to) {
  const length = from.distanceTo(to);
  if (length < 1e-4) {
    mesh.visible = false;
    return false;
  }
  mesh.position.copy(from);
  _envDir.subVectors(to, from).normalize();
  mesh.quaternion.setFromUnitVectors(Y_AXIS, _envDir);
  mesh.scale.setScalar(length);
  mesh.visible = true;
  return true;
}

const ENVELOPE_JOINT = { neck_01: "neck_base" };
const ENVELOPE_TAIL = {
  pelvis: "spine_01",
  spine_01: "spine_02",
  spine_02: "spine_03",
  spine_03: "neck_01",
  neck_01: "head",
  head: "head_top",
  clavicle_l: "upperarm_l",
  upperarm_l: "lowerarm_l",
  lowerarm_l: "hand_l",
  hand_l: "hand_tip_l",
  clavicle_r: "upperarm_r",
  upperarm_r: "lowerarm_r",
  lowerarm_r: "hand_r",
  hand_r: "hand_tip_r",
  thigh_l: "calf_l",
  calf_l: "foot_l",
  foot_l: "ball_l",
  thigh_r: "calf_r",
  calf_r: "foot_r",
  foot_r: "ball_r",
};
const ENVELOPE_END = {
  pelvis: "spine_01",
  spine_01: "spine_02",
  spine_02: "spine_03",
  spine_03: "neck_base",
  neck_01: "head",
  head: "head_top",
  clavicle_l: "upperarm_l",
  upperarm_l: "lowerarm_l",
  lowerarm_l: "hand_l",
  hand_l: "hand_tip_l",
  clavicle_r: "upperarm_r",
  upperarm_r: "lowerarm_r",
  lowerarm_r: "hand_r",
  hand_r: "hand_tip_r",
  thigh_l: "calf_l",
  calf_l: "foot_l",
  foot_l: "ball_l",
  thigh_r: "calf_r",
  calf_r: "foot_r",
  foot_r: "ball_r",
};
const JOINT_TO_SKIN = {
  neck_base: "neck_01",
  head_top: "head",
  hand_tip_l: "hand_l",
  hand_tip_r: "hand_r",
  ball_l: "foot_l",
  ball_r: "foot_r",
  toe_l: "foot_l",
  toe_r: "foot_r",
};

function heatRamp(weight, out, offset) {
  const t = Math.min(1, Math.max(0, weight));
  const x = t * 3;
  const i = Math.min(2, Math.floor(x));
  const f = x - i;
  const stops = [
    0.12, 0.28, 0.72,
    0.10, 0.78, 0.72,
    0.98, 0.86, 0.20,
    0.86, 0.18, 0.16,
  ];
  const a = i * 3;
  out[offset] = stops[a] + (stops[a + 3] - stops[a]) * f;
  out[offset + 1] = stops[a + 1] + (stops[a + 4] - stops[a + 1]) * f;
  out[offset + 2] = stops[a + 2] + (stops[a + 5] - stops[a + 2]) * f;
}

function hashColor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360;
  const sat = 0.62;
  const lit = 0.52;
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = lit - c / 2;
  return [r + m, g + m, b + m];
}

export const SKELETON_DOTS = [
  "head_top", "head", "neck_base", "clavicle_l", "clavicle_r", "spine_03",
  "upperarm_l", "lowerarm_l", "hand_l", "hand_tip_l",
  "upperarm_r", "lowerarm_r", "hand_r", "hand_tip_r",
  "spine_02", "spine_01", "pelvis",
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
    let axis = [-sx, -sy, -sz];
    if (axis[1] < 0) axis = axis.map((value) => -value);
    const gap = len * 0.25;
    const onDigit = (name, spread, along, drop) => {
      const id = `${name}_${side}`;
      if (saved && saved[id]) return saved[id].slice();
      return hand.map((value, i) => value + dir[i] * len * along + axis[i] * spread + (i === 2 ? drop : 0));
    };
    const alongDigit = (end, from) => hand.map((value, i) => value + (end[i] - hand[i]) * from);
    digits.forEach((name, index) => {
      const spread = (index - (digits.length - 1) / 2) * gap;
      const id = `${name}_${side}`;
      const end = onDigit(name, spread, 1.12, 0);
      lines.push([alongDigit(end, 0.62), end]);
      dots[id] = end;
    });
    if (keptFingers(fingers).includes("thumb")) {
      const id = `thumb_${side}`;
      const end = onDigit("thumb", -gap * 2.0, 0.65, -len * 0.42);
      lines.push([alongDigit(end, 0.45), end]);
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

// Axis-angle vector of a quaternion (shortest arc), used by the jiggle springs.
function swingAxis(q) {
  let x = q.x;
  let y = q.y;
  let z = q.z;
  let w = q.w;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.hypot(x, y, z);
  if (s < 1e-8) return new THREE.Vector3();
  const k = (2 * Math.atan2(s, w)) / s;
  return new THREE.Vector3(x * k, y * k, z * k);
}

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
    this.followCharacter = true;
    this.fit = { hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0, leg_space: 0 };
    this.view = "front";
    this.locked = false;
    this.showSkeleton = false;
    this.skel = null;
    this.skelDots = null;
    this.showAnimEnv = false;
    this.envScales = {};
    this.animEnv = null;
    this.mode = "mesh";
    this.H = 1;
    this.joints = {};
    this.dots = {};
    this.extraFrames = {};
    this.extraDots = {};
    this.wantEstimate = false;
    this._estOwners = null;
    this._estSegs = [];
    this._estStamp = "";
    this._estMesh = null;
    this._estToken = 0;
    this.wantArrows = false;
    this.arrowGroup = null;
    this.bones = null;
    this.boneStyle = "stick";
    this.boneOverlay = true;
    this.soloBone = "";
    this.soloEnv = "";
    this.hiddenBones = new Set();
    this.hiddenEnvs = new Set();
    this._fingerSegs = [];
    this.jiggleOn = false;
    this._jiggleRoots = [];
    this._jiggleKey = "";
    this._jiggleBones = [];
    this._jiggleState = new Map();
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
    this.heatOn = false;
    this.heatBone = "";
    this.heatRoot = null;
    this.heatMesh = null;
    this.heatUrl = "";
    this.heatLive = false;
    this.wantAnimHeat = false;
    this.animHeat = false;
    this.animHeatMeshes = null;
    this._heatTask = null;
    this._heatToken = 0;
    this._heatPainted = null;
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
    this._restoreAnimWeights();
    this._heatToken++;
    this._dropHeat();
    this._dropAnimEnvelopes();
    this._dropSkeleton();
    if (this.root) this.scene.remove(this.root);
    this.root = null;
    this._pivot = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this._bind = {};
    this._posed = {};
    this.mode = "empty";
    this._jiggleBones = [];
    this._jiggleState = new Map();
    if (this.grid) this.grid.visible = false;
    this.clearOverlay();
  }

  clearOverlay() {
    this._clearDots();
    this._dropBones();
    this._dropArrows();
    this.extraFrames = {};
    this._estOwners = null;
    this._estSegs = [];
    this._estStamp = "";
    this._estMesh = null;
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
    this._syncSkeleton();
    this._syncAnimEnvelopes();
    this._buildJiggle();
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
      this._resetJiggle();
      this.frameCharacter();
    }
  }

  setJiggle(config) {
    const next = config || {};
    this.jiggleOn = !!next.enabled;
    const roots = Array.isArray(next.chains) ? next.chains.map(String) : [];
    const key = roots.slice().sort().join(",");
    if (key !== this._jiggleKey) {
      this._jiggleKey = key;
      this._jiggleRoots = roots;
      this._buildJiggle();
    }
    if (!this.jiggleOn) this._resetJiggle();
  }

  // A chain is the marked bone plus every bone below it. Parents come first,
  // so the springs cascade down the chain while the clip plays.
  _buildJiggle() {
    this._jiggleBones = [];
    this._jiggleState = new Map();
    if (!this.root) return;
    const seen = new Set();
    for (const name of this._jiggleRoots) {
      const start = this.root.getObjectByName(name);
      if (!start || !start.isBone) continue;
      const queue = [start];
      while (queue.length) {
        const bone = queue.shift();
        if (!bone.isBone || seen.has(bone.name)) continue;
        seen.add(bone.name);
        this._jiggleBones.push(bone);
        this._jiggleState.set(bone.name, {
          swing: new THREE.Quaternion(),
          base: new THREE.Quaternion(),
          moves: undefined,
          angle: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          prevParent: new THREE.Quaternion(),
          prevPos: new THREE.Vector3(),
          prevPvel: new THREE.Vector3(),
          pvel: new THREE.Vector3(),
          pacc: new THREE.Vector3(),
          len: 0.04,
          ready: false,
        });
        for (const child of bone.children) if (child.isBone) queue.push(child);
      }
    }
  }

  _resetJiggle() {
    for (const state of this._jiggleState.values()) {
      state.swing.identity();
      state.angle.set(0, 0, 0);
      state.vel.set(0, 0, 0);
      state.pvel.set(0, 0, 0);
      state.prevPvel.set(0, 0, 0);
      state.pacc.set(0, 0, 0);
      state.ready = false;
    }
  }

  // True when the clip's own track actually moves this bone. A bone the clip
  // leaves alone keeps whatever quaternion it has, so the swing would stick.
  _clipMovesBone(name) {
    const clip = this.current && this.current.getClip ? this.current.getClip() : null;
    if (!clip) return true;
    const track = clip.tracks.find((t) => t.name === `${name}.quaternion`);
    if (!track || track.values.length < 8) return false;
    const v = track.values;
    for (let i = 4; i < v.length; i++) {
      if (Math.abs(v[i] - v[i % 4]) > 1e-5) return true;
    }
    return false;
  }

  // Spring-bone secondary motion. Runs after the clip and the fit are applied,
  // so the baked clip itself is never modified and no unmarked bone moves.
  _jiggleStep(dt) {
    if (!this.jiggleOn || !this.root || !this._jiggleBones.length) return;
    const step = Math.min(Math.max(dt, 1 / 240), 1 / 24);
    const stiffness = 9;
    const damping = 2.5;
    const drive = 10;
    const linDrive = 0.8;
    const maxSwing = 1.1;
    const maxVel = 24;
    const maxStep = 8;
    const parentNow = new THREE.Quaternion();
    const boneNow = new THREE.Quaternion();
    const boneInv = new THREE.Quaternion();
    const prevInv = new THREE.Quaternion();
    const delta = new THREE.Quaternion();
    const local = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const parentPos = new THREE.Vector3();
    const rawVel = new THREE.Vector3();
    const rawAcc = new THREE.Vector3();
    const headW = new THREE.Vector3();
    const tipW = new THREE.Vector3();
    const boneDir = new THREE.Vector3();
    const force = new THREE.Vector3();
    this.root.updateMatrixWorld(true);
    for (const bone of this._jiggleBones) {
      const state = this._jiggleState.get(bone.name);
      const parent = bone.parent;
      if (!state || !parent) continue;
      parent.getWorldQuaternion(parentNow);
      parent.getWorldPosition(parentPos);
      if (!state.ready) {
        state.prevParent.copy(parentNow);
        state.prevPos.copy(parentPos);
        state.prevPvel.set(0, 0, 0);
        state.pvel.set(0, 0, 0);
        state.pacc.set(0, 0, 0);
        state.len = 0.04 * (this.H || 1);
        const firstChild = (bone.children || []).find((c) => c.isBone);
        if (firstChild) {
          bone.getWorldPosition(headW);
          firstChild.getWorldPosition(tipW);
          const span = headW.distanceTo(tipW);
          if (span > 1e-4) state.len = span;
        }
        state.moves = this._clipMovesBone(bone.name);
        state.base.copy(bone.quaternion);
        state.ready = true;
        continue;
      }
      // The mixer does not always fully overwrite a bone the clip leaves
      // alone, so last frame's swing can still be on it. Put the clip's own
      // pose back for those bones; the swing is applied fresh below.
      if (!state.moves) bone.quaternion.copy(state.base);
      bone.getWorldQuaternion(boneNow);
      prevInv.copy(state.prevParent).invert();
      delta.copy(parentNow).multiply(prevInv);
      boneInv.copy(boneNow).invert();
      local.copy(boneInv).multiply(delta).multiply(boneNow);
      axis.copy(swingAxis(local)).multiplyScalar(1 / step);
      if (axis.length() > maxVel) axis.setLength(maxVel);
      // The spring pulls the swing back to rest; the parent's motion pushes it
      // the other way, so the chain trails the body.
      state.vel.addScaledVector(state.angle, -stiffness * step);
      state.vel.addScaledVector(axis, -drive * step);
      // Pivot acceleration (stride bob) the twist above cannot feel: the tip
      // lags opposite the acceleration, torque (r x a) / L. Smoothed, with a
      // teleport guard so clip loop wraps coast instead of kicking.
      rawVel.copy(parentPos).sub(state.prevPos).divideScalar(step);
      if (rawVel.length() > maxStep) {
        state.prevPos.copy(parentPos);
        state.pvel.set(0, 0, 0);
        state.prevPvel.set(0, 0, 0);
        state.pacc.set(0, 0, 0);
      } else {
        state.pvel.lerp(rawVel, 1 - Math.exp(-25 * step));
        rawAcc.copy(state.pvel).sub(state.prevPvel).divideScalar(step);
        state.prevPvel.copy(state.pvel);
        state.pacc.lerp(rawAcc, 1 - Math.exp(-18 * step));
        bone.getWorldPosition(headW);
        const tipBone = (bone.children || []).find((c) => c.isBone);
        if (tipBone) tipBone.getWorldPosition(tipW);
        else {
          bone.getWorldQuaternion(boneNow);
          tipW.set(0, 1, 0).applyQuaternion(boneNow).multiplyScalar(state.len).add(headW);
        }
        boneDir.copy(tipW).sub(headW);
        const span = boneDir.length();
        if (span > 1e-6 && state.pacc.lengthSq() > 1e-10) {
          boneDir.divideScalar(span);
          force.crossVectors(boneDir, state.pacc);
          state.vel.addScaledVector(force, -(linDrive / Math.max(state.len, 1e-3)) * step);
        }
        state.prevPos.copy(parentPos);
      }
      state.vel.multiplyScalar(Math.exp(-damping * step));
      if (state.vel.length() > maxVel) state.vel.setLength(maxVel);
      state.angle.addScaledVector(state.vel, step);
      if (state.angle.length() > maxSwing) state.angle.setLength(maxSwing);
      const total = state.angle.length();
      if (total > 1e-6) {
        axis.copy(state.angle).divideScalar(total);
        state.swing.setFromAxisAngle(axis, total);
        bone.quaternion.multiply(state.swing);
      } else {
        state.swing.identity();
      }
      bone.updateMatrixWorld(true);
      state.prevParent.copy(parentNow);
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

  setFollowCharacter(on) {
    this.followCharacter = !!on;
    if (this.followCharacter) {
      const center = this._characterCenter();
      if (center) {
        this._pivot = center.clone();
        this.center = center;
      }
    }
  }

  _holdFrame() {
    if (!this.followCharacter) return;
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
    if (spots[name]) {
      this.camera.position.set(...spots[name]);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(center);
      this.controls.target.copy(center);
    }
    this.controls.enabled = !this.locked;
    this.controls.update();
    document.querySelectorAll(".views button[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
  }

  setLocked(on) {
    this.locked = !!on;
    this.controls.enabled = !this.locked;
    if (this.locked) {
      this.controls._sphericalDelta.set(0, 0, 0);
      this.controls._panOffset.set(0, 0, 0);
      this.controls._scale = 1;
    }
  }

  setSymmetry(on) {
    this.sym = !!on;
    if (this.soloBone) {
      this._applyBoneVisibility();
      this._drawBones();
    }
  }

  _releaseView() {
    if (this.locked || this.view === "free") return;
    this.view = "free";
    document.querySelectorAll(".views button[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === "free"));
  }

  setSkeleton(on) {
    this.showSkeleton = !!on;
    this._syncSkeleton();
  }

  _dropSkeleton() {
    if (this.skel) {
      this.scene.remove(this.skel);
      if (this.skel.geometry) this.skel.geometry.dispose();
      if (this.skel.material) this.skel.material.dispose();
      this.skel = null;
    }
    if (this.skelOcta) {
      const shared = this.skelOcta.userData.octa;
      this.scene.remove(this.skelOcta);
      if (shared) {
        shared.mat?.dispose();
        shared.edgeMat?.dispose();
        shared.edges?.dispose();
      }
      this.skelOcta = null;
    }
    if (this.skelDots) {
      this.scene.remove(this.skelDots.group);
      this.skelDots.geo.dispose();
      this.skelDots.mat.dispose();
      this.skelDots = null;
    }
    if (this.hintId && !this.dots[this.hintId]) this._hideGrabLabel();
  }

  _syncSkeleton() {
    const live = this.showSkeleton && this.root && (this.mode === "play" || this.mode === "pose");
    if (!live) {
      this._dropSkeleton();
      return;
    }
    if (this.skel || this.skelOcta) return;
    if (this.boneStyle === "blender") {
      const group = new THREE.Group();
      const geo = octaBoneGeo();
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.82,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0xfff0c8,
        transparent: true,
        opacity: 0.98,
        depthTest: false,
      });
      const edges = new THREE.EdgesGeometry(geo);
      const holds = [];
      this.root.traverse((obj) => {
        if (!obj.isBone || !obj.parent || !obj.parent.isBone) return;
        if (!this._playBoneVisible(obj.parent.name, obj.name)) return;
        if (obj.name && (obj.name.includes("_leaf") || obj.name.startsWith("ik_") || obj.name.startsWith("socket"))) return;
        const hold = new THREE.Group();
        hold.add(new THREE.Mesh(geo, mat), new THREE.LineSegments(edges, edgeMat));
        hold.renderOrder = 8;
        hold.userData = { bone: obj.parent, tip: obj };
        group.add(hold);
        holds.push(hold);
      });
      group.userData.octa = { mat, edgeMat, edges, holds };
      this.scene.add(group);
      this.skelOcta = group;
    } else {
      const helper = new THREE.SkeletonHelper(this.root);
      helper.material.vertexColors = false;
      helper.material.needsUpdate = true;
      helper.material.color.set(0xffd27a);
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.95;
      helper.frustumCulled = false;
      helper.renderOrder = 8;
      this.scene.add(helper);
      this.skel = helper;
    }
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe1a8, depthTest: false });
    const byName = {};
    this.root.traverse((obj) => {
      if (!obj.isBone) return;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 9;
      mesh.userData = { id: obj.name, bone: obj };
      group.add(mesh);
      if (obj.name && !byName[obj.name]) byName[obj.name] = mesh;
    });
    this.scene.add(group);
    this.skelDots = { group, geo, mat, byName };
    this._placeSkeleton();
  }

  // Per-bone visibility for the animated overlay. Same hidden/solo set as
  // Rig, but not the Rig overlay tick: checking "Show skeleton" here must
  // show the bones even if Rig's own tick is off. Stick style cannot filter
  // per bone, so it stays whole; octa holds and dots filter below.
  _playBoneVisible(parentName, name) {
    const solo = this._soloSet();
    if (solo && !(solo.has(parentName) || solo.has(name))) return false;
    return !this.hiddenBones.has(parentName) && !this.hiddenBones.has(name);
  }

  _placeSkeleton() {
    if ((!this.skel && !this.skelOcta) || !this.root) return;
    this.root.updateWorldMatrix(true, true);
    if (this.skel) this.skel.updateMatrixWorld(true);
    const head = this._bonePos || (this._bonePos = new THREE.Vector3());
    const tip = this._boneTip || (this._boneTip = new THREE.Vector3());
    if (this.skelOcta) {
      for (const hold of this.skelOcta.userData.octa.holds) {
        hold.userData.bone.getWorldPosition(head);
        hold.userData.tip.getWorldPosition(tip);
        placeOctaBone(hold, head, tip);
      }
    }
    if (!this.skelDots) return;
    const full = Math.max(this.H, 0.2) * 0.011;
    for (const mesh of this.skelDots.group.children) {
      const bone = mesh.userData.bone;
      bone.getWorldPosition(mesh.position);
      mesh.visible = this._playBoneVisible(
        bone.parent && bone.parent.isBone ? bone.parent.name : "", mesh.userData.id,
      );
      let size = full;
      const parent = bone.parent;
      if (parent && parent.isBone) {
        parent.getWorldPosition(head);
        size = Math.min(full, head.distanceTo(mesh.position) * 0.28);
        size = Math.max(size, full * 0.28);
      }
      mesh.scale.setScalar(size);
    }
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
    this._dropBones();
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
    this._dropBones();
    const fingersDrawn = fingerLayout(this.joints, this.fingers || "five", this.fingerTips);
    this.fingerTips = fingersDrawn.dots;
    this._fingerSegs = fingersDrawn.lines.map(([a, b]) => [a.slice(), b.slice()]);
    this._drawBones();
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
      mesh.visible = this._boneVisible(name);
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
      mesh.visible = this._boneVisible(id);
      mesh.renderOrder = 7;
      if (id === this.picked) mesh.scale.setScalar(1.6);
      this.scene.add(mesh);
      this.dots[id] = mesh;
    }
    const picked = this.dots[this.picked];
    if (picked && picked.userData.kind === "joint") picked.scale.setScalar(1.45);
    this._drawExtraDots();
    this._applyBoneVisibility();
  }

  // Tissue bones from rig/extra_bones.json. Display-only: dots live in
  // this.extraDots (never this.dots, so the picker and drag code ignore
  // them) and the octas come from _boneSegments. Never merged into
  // this.joints, so they can never be dragged or POSTed as markers.
  setExtraBones(frames) {
    this.extraFrames = frames || {};
    if ((this.drag || this.rotating) && this.mode === "mesh") return;
    this._drawBones();
    this._drawExtraDots();
    this._applyBoneVisibility();
  }

  _drawExtraDots() {
    for (const mesh of Object.values(this.extraDots || {})) this.scene.remove(mesh);
    this.extraDots = {};
    if (this.mode === "play" || this.mode === "pose") return;
    if (!this.boneOverlay) return;
    for (const [name, frame] of Object.entries(this.extraFrames || {})) {
      if (!frame || !frame.head) continue;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(this.H * 0.01, 12, 10),
        new THREE.MeshBasicMaterial({ color: dotColor(name), depthTest: false }),
      );
      mesh.position.copy(toThree(frame.head));
      mesh.userData = { kind: "extra", id: name, blender: frame.head.slice() };
      mesh.visible = this._boneVisible(name);
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      this.extraDots[name] = mesh;
    }
  }

  setEstimate(on) {
    this.wantEstimate = !!on;
    if (!this.wantEstimate) {
      this._estToken++;
      this._clearEstimate();
      return;
    }
    this.refreshEstimate();
  }

  _estimateMesh() {
    if (!this.root) return null;
    let found = null;
    this.root.traverse((obj) => {
      if (!found && obj.isMesh && !obj.userData.heat) found = obj;
    });
    return found;
  }

  refreshEstimate() {
    if (!this.wantEstimate || this.mode !== "mesh" || !this.root || this.drag || this.rotating) return;
    const joints = this.joints || {};
    const stamp = JSON.stringify(joints);
    const mesh = this._estimateMesh();
    if (!mesh || !mesh.geometry?.attributes?.position) return;
    if (this._estOwners && stamp === this._estStamp && this._estMesh === mesh) {
      this._paintEstimate();
      return;
    }
    const segs = [];
    for (const [a, b] of LINKS) {
      if (!joints[a] || !joints[b]) continue;
      segs.push({ a: toThree(joints[a]), b: toThree(joints[b]), owner: b });
    }
    if (!segs.length) { this._clearEstimate(); return; }
    const token = ++this._estToken;
    this._estMesh = mesh;
    this._estStamp = stamp;
    this._estSegs = segs;
    const pos = mesh.geometry.attributes.position.array;
    const count = mesh.geometry.attributes.position.count;
    const owners = new Uint8Array(count);
    const step = (start) => {
      if (token !== this._estToken) return;
      try {
        const end = Math.min(count, start + 100000);
        for (let i = start; i < end; i++) {
          const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
          let best = 0, bestD = Infinity;
          for (let s = 0; s < segs.length; s++) {
            const sg = segs[s];
            const abx = sg.b.x - sg.a.x, aby = sg.b.y - sg.a.y, abz = sg.b.z - sg.a.z;
            const denom = abx * abx + aby * aby + abz * abz + 1e-12;
            let t = ((px - sg.a.x) * abx + (py - sg.a.y) * aby + (pz - sg.a.z) * abz) / denom;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = px - (sg.a.x + abx * t), dy = py - (sg.a.y + aby * t), dz = pz - (sg.a.z + abz * t);
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd < bestD) { bestD = dd; best = s; }
          }
          owners[i] = best;
        }
      } catch (err) {
        console.error("estimate paint failed:", err);
        if (token === this._estToken) this._estToken++;
        if (this.box) this.box.style.cursor = "";
        return;
      }
      if (end < count) { setTimeout(() => step(end), 0); return; }
      if (token !== this._estToken) return;
      this._estOwners = owners;
      if (this.box) this.box.style.cursor = "";
      this._paintEstimate();
    };
    if (this.box) this.box.style.cursor = "progress";
    step(0);
  }

  _clearEstimate() {
    this._estOwners = null;
    this._estSegs = [];
    this._estStamp = "";
    this._estMesh = null;
    if (this.box) this.box.style.cursor = "";
    const mesh = this._estimateMesh();
    if (mesh && mesh.geometry.getAttribute("color")) mesh.geometry.deleteAttribute("color");
    if (mesh && mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        mat.vertexColors = false;
        mat.needsUpdate = true;
      }
    }
  }

  _paintEstimate() {
    if (!this.wantEstimate || !this._estOwners || this.mode !== "mesh") return;
    const mesh = this._estMesh || this._estimateMesh();
    if (!mesh || !mesh.geometry?.attributes?.position) return;
    const count = mesh.geometry.attributes.position.count;
    if (this._estOwners.length !== count) return;
    let attr = mesh.geometry.getAttribute("color");
    if (!attr) {
      attr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
      mesh.geometry.setAttribute("color", attr);
    }
    const solo = this._soloSet();
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const owner = this._estSegs[this._estOwners[i]].owner;
      if (!solo || solo.has(owner)) {
        col.set(dotColor(owner));
        attr.setXYZ(i, col.r, col.g, col.b);
      } else {
        attr.setXYZ(i, 0.16, 0.16, 0.16);
      }
    }
    attr.needsUpdate = true;
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const mat of mats) {
      if (!mat.vertexColors) {
        mat.vertexColors = true;
        mat.needsUpdate = true;
      }
    }
  }

  setArrows(on) {
    this.wantArrows = !!on;
    this._drawArrows();
  }

  _dropArrows() {
    if (!this.arrowGroup) return;
    this.arrowGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.scene.remove(this.arrowGroup);
    this.arrowGroup = null;
  }

  _drawArrows() {
    this._dropArrows();
    if (!this.wantArrows || this.mode !== "mesh" || !this.joints) return;
    const solo = this._soloSet();
    const vis = (a, b) => (!solo || solo.has(a) || solo.has(b)) && !this.hiddenBones.has(a) && !this.hiddenBones.has(b);
    // Hinge pin per joint: cross of incoming/outgoing bone directions, with a
    // lateral fallback for straight chains. The limb bends around the pin,
    // so the pin — not the bone line — is the travel reference for placement.
    const pinDir = (a, at, b) => {
      let ix = at[0] - a[0], iy = at[1] - a[1], iz = at[2] - a[2];
      let ox = b[0] - at[0], oy = b[1] - at[1], oz = b[2] - at[2];
      const il = Math.hypot(ix, iy, iz) || 1, ol = Math.hypot(ox, oy, oz) || 1;
      ix /= il; iy /= il; iz /= il; ox /= ol; oy /= ol; oz /= ol;
      let px = iy * oz - iz * oy, py = iz * ox - ix * oz, pz = ix * oy - iy * ox;
      const l = Math.hypot(px, py, pz);
      if (l < 0.2) return new THREE.Vector3(1, 0, 0);
      return new THREE.Vector3(px / l, pz / l, -py / l);
    };
    const group = new THREE.Group();
    const pinLen = Math.max(this.H, 0.2) * 0.035;
    const addPin = (at, p, name) => {
      const o = toThree(at);
      const g = new THREE.Group();
      g.userData.id = name;
      const mat = new THREE.MeshBasicMaterial({ color: dotColor(name), transparent: true, opacity: 0.95, depthTest: false });
      const a = p.clone().multiplyScalar(-pinLen / 2).add(o);
      const b = p.clone().multiplyScalar(pinLen / 2).add(o);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: dotColor(name), transparent: true, opacity: 0.9, depthTest: false }),
      );
      line.renderOrder = 7;
      g.add(line);
      for (const s of [1, -1]) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(pinLen * 0.12, pinLen * 0.28, 10), mat);
        cone.quaternion.setFromUnitVectors(Y_AXIS, p.clone().multiplyScalar(s));
        cone.position.copy(o).addScaledVector(p, s * pinLen * 0.5);
        cone.renderOrder = 7;
        g.add(cone);
      }
      group.add(g);
    };
    const childrenOf = {};
    const parentOf = {};
    for (const [a, b] of LINKS) {
      (childrenOf[a] = childrenOf[a] || []).push(b);
      if (!parentOf[b]) parentOf[b] = a;
    }
    for (const id of Object.keys(this.joints)) {
      const kids = childrenOf[id] || [];
      if (!kids.length) continue;
      const par = parentOf[id];
      if (par && !vis(par, id)) continue;
      if (!par && solo && !solo.has(id)) continue;
      if (!par && this.hiddenBones.has(id)) continue;
      const p = par
        ? pinDir(this.joints[par], this.joints[id], this.joints[kids[0]])
        : new THREE.Vector3(1, 0, 0);
      addPin(this.joints[id], p, id);
    }
    for (const [name, frame] of Object.entries(this.extraFrames || {})) {
      if (!frame || !frame.head || !frame.tail) continue;
      const parent = frame.parent;
      if (!parent || !this.joints[parent] || !vis(parent, name)) continue;
      addPin(frame.head, pinDir(this.joints[parent], frame.head, frame.tail), name);
    }
    if (!group.children.length) return;
    this.scene.add(group);
    this.arrowGroup = group;
  }

  setBoneHidden(name, hidden) {
    this.setBonesHidden([name], hidden);
  }

  setBonesHidden(names, hidden) {
    for (const name of names) {
      if (hidden) this.hiddenBones.add(name);
      else this.hiddenBones.delete(name);
    }
    this._applyBoneVisibility();
    this._drawBones();
  }

  setBoneStyle(style) {
    const next = style === "blender" ? "blender" : "stick";
    if (next === this.boneStyle) return;
    this.boneStyle = next;
    this._drawBones();
    // Motions skeleton is a separate overlay — rebuild so Blender/stick swaps there too.
    if (this.showSkeleton) {
      this._dropSkeleton();
      this._syncSkeleton();
    }
  }

  setBoneOverlayVisible(on) {
    this.boneOverlay = !!on;
    this._applyBoneVisibility();
  }

  _soloSet() {
    if (!this.soloBone) return null;
    const names = new Set([this.soloBone]);
    if (this.sym) {
      const other = mirrorId(this.soloBone);
      if (other) names.add(other);
    }
    return names;
  }

  _boneVisible(name) {
    if (!this.boneOverlay) return false;
    if (this.hiddenBones.has(name)) return false;
    const solo = this._soloSet();
    if (solo && !solo.has(name)) return false;
    return true;
  }

  _linkVisible(a, b) {
    if (!this.boneOverlay) return false;
    const solo = this._soloSet();
    if (solo) return solo.has(a) || solo.has(b);
    return !this.hiddenBones.has(a) && !this.hiddenBones.has(b);
  }

  _applyBoneVisibility() {
    for (const [name, mesh] of Object.entries(this.dots)) {
      if (mesh.userData.kind !== "joint" && mesh.userData.kind !== "finger") continue;
      mesh.visible = this._boneVisible(name);
    }
    for (const [name, mesh] of Object.entries(this.extraDots || {})) {
      mesh.visible = this._boneVisible(name);
    }
    if (this.bones) this.bones.visible = this.boneOverlay;
    this._drawArrows();
    this._paintEstimate();
  }

  setEnvelopeHidden(name, hidden) {
    this.setEnvelopesHidden([name], hidden);
  }

  setEnvelopesHidden(names, hidden) {
    const want = new Set(names);
    for (const name of want) {
      if (hidden) this.hiddenEnvs.add(name);
      else this.hiddenEnvs.delete(name);
    }
    const apply = (group) => {
      if (!group) return;
      for (const hold of group.children) {
        if (!want.has(hold.userData.name)) continue;
        hold.userData.hidden = this.hiddenEnvs.has(hold.userData.name);
      }
    };
    apply(this.envelopes);
    apply(this.animEnv);
    this._applyEnvVisibility();
    if (hidden && want.has(this._envFocus)) this.highlightEnvelope("");
  }

  _envVisible(name) {
    if (this.hiddenEnvs.has(name)) return false;
    if (this.soloEnv && name !== this.soloEnv) return false;
    return true;
  }

  _applyEnvVisibility() {
    const paint = (group) => {
      if (!group) return;
      for (const hold of group.children) {
        const name = hold.userData.name;
        hold.userData.hidden = this.hiddenEnvs.has(name);
        hold.visible = this._envVisible(name);
      }
    };
    paint(this.envelopes);
    paint(this.animEnv);
  }

  isolateBone(name) {
    if (!this.dots[name] || this.dots[name].userData.kind !== "joint") return;
    this.soloEnv = "";
    this.soloBone = name;
    this._applyBoneVisibility();
    this._drawBones();
    this._applyEnvVisibility();
    this.onIsolate && this.onIsolate("bone", this.soloBone);
  }

  isolateEnvelope(name) {
    const known = this.envelopes.children.some((hold) => hold.userData.name === name)
      || (this.animEnv && this.animEnv.children.some((hold) => hold.userData.name === name));
    if (!known) return;
    this.soloBone = "";
    this.soloEnv = name;
    this._applyBoneVisibility();
    this._drawBones();
    this.highlightEnvelope(this.soloEnv);
    this._applyEnvVisibility();
    this.onIsolate && this.onIsolate("env", this.soloEnv);
  }

  clearSolo() {
    if (!this.soloBone && !this.soloEnv) return;
    this.soloBone = "";
    this.soloEnv = "";
    this._applyBoneVisibility();
    this._drawBones();
    this.highlightEnvelope("");
    this._applyEnvVisibility();
    this.onIsolate && this.onIsolate("", "");
  }

  setWeightPaint(on, url) {
    if (!on) {
      if (this.heatLive) return;
      this.heatOn = false;
      this._applyHeatVisible();
      return;
    }
    this.heatOn = true;
    if (this.heatMesh && this.heatUrl === url) {
      if (this._heatPainted !== this.heatBone) this._paintHeat();
      this._applyHeatVisible();
      return;
    }
    if (this._heatTask) return;
    const token = this._heatToken;
    this._heatTask = this._loadHeat(url).then(() => {
      this._heatTask = null;
      if (token !== this._heatToken || !this.heatOn || !this.heatMesh) return;
      this._paintHeat();
      this._applyHeatVisible();
    }).catch((err) => {
      this._heatTask = null;
      console.error(err);
    });
  }

  setWeightBone(name) {
    const next = name || "";
    if (next === this.heatBone) return;
    this.heatBone = next;
    this._heatPainted = null;
    if (this.heatOn && this.heatMesh) {
      this._paintHeat();
      this._applyHeatVisible();
    }
  }

  setAnimWeights(on) {
    this.wantAnimHeat = !!on;
    if (on) {
      this.heatBone = "";
      this._heatPainted = null;
    }
    this._applyAnimWeights();
  }

  _applyAnimWeights() {
    const want = this.wantAnimHeat && this.root && (this.mode === "play" || this.mode === "pose");
    if (!want) {
      this._restoreAnimWeights();
      return;
    }
    if (this.animHeat) {
      if (this._heatPainted !== this.heatBone) this._paintHeat();
      if (this.animEnv) this.animEnv.visible = false;
      return;
    }
    const meshes = [];
    this.root.traverse((obj) => {
      if (!obj.isSkinnedMesh) return;
      const geo = obj.geometry;
      if (!geo?.attributes?.position || !geo.attributes.skinIndex || !geo.attributes.skinWeight) return;
      if (!geo.attributes.color) {
        geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      }
      const previous = obj.material;
      const side = Array.isArray(previous) ? previous[0]?.side : previous?.side;
      obj.userData.paintMaterial = previous;
      obj.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: side ?? THREE.FrontSide });
      meshes.push(obj);
    });
    if (!meshes.length) return;
    this.animHeatMeshes = meshes;
    this.animHeat = true;
    this.heatLive = true;
    this.heatOn = true;
    this.heatMesh = meshes[0];
    this._heatPainted = null;
    this._paintHeat();
    if (this.animEnv) this.animEnv.visible = false;
  }

  _restoreAnimWeights() {
    if (!this.animHeat) return;
    for (const mesh of this.animHeatMeshes || []) {
      const saved = mesh.userData.paintMaterial;
      if (!saved) continue;
      mesh.material.dispose();
      mesh.material = saved;
      delete mesh.userData.paintMaterial;
    }
    this.animHeatMeshes = null;
    this.animHeat = false;
    if (this.heatLive) {
      this.heatLive = false;
      this.heatOn = false;
      this.heatMesh = null;
      this._heatPainted = null;
    }
    if (this.animEnv) this.animEnv.visible = true;
  }

  _skinBone(name) {
    if (!name || !this.heatMesh) return "";
    const bones = this.heatMesh.skeleton.bones;
    const has = (bone) => bones.some((item) => item.name === bone);
    if (has(name)) return name;
    const mapped = JOINT_TO_SKIN[name];
    if (mapped && has(mapped)) return mapped;
    return "";
  }

  _loadHeat(url) {
    const token = this._heatToken;
    return this.loader.loadAsync(url).then((gltf) => {
      if (token !== this._heatToken) return;
      let mesh = null;
      gltf.scene.traverse((obj) => {
        if (obj.isSkinnedMesh && !mesh) mesh = obj;
      });
      if (!mesh) return;
      const previous = mesh.material;
      mesh.geometry = mesh.geometry.clone();
      const count = mesh.geometry.attributes.position.count;
      mesh.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      mesh.material = new THREE.MeshBasicMaterial({ vertexColors: true });
      if (previous) {
        const mats = Array.isArray(previous) ? previous : [previous];
        mats.forEach((item) => item.dispose());
      }
      mesh.frustumCulled = false;
      gltf.scene.traverse((obj) => {
        if (obj.isBone) obj.visible = false;
        if (obj.isMesh && obj !== mesh) obj.visible = false;
      });
      this._dropHeat();
      this.heatRoot = gltf.scene;
      this.heatMesh = mesh;
      mesh.userData.heat = true;
      this.heatUrl = url;
      this._heatPainted = null;
      this.scene.add(gltf.scene);
      gltf.scene.visible = false;
    });
  }

  _dropHeat() {
    if (!this.heatRoot) return;
    this.scene.remove(this.heatRoot);
    this.heatRoot.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((item) => item.dispose());
      }
    });
    this.heatRoot = null;
    this.heatMesh = null;
    this.heatUrl = "";
    this._heatPainted = null;
  }

  _applyHeatVisible() {
    const on = this.heatOn && !!this.heatRoot;
    if (this.root) this.root.visible = !on;
    if (this.heatRoot) this.heatRoot.visible = on;
    this.envelopes.visible = !on;
  }

  _paintHeat() {
    const meshes = this.heatLive && this.animHeatMeshes?.length
      ? this.animHeatMeshes
      : (this.heatMesh ? [this.heatMesh] : []);
    for (const mesh of meshes) this._paintHeatMesh(mesh);
    this._heatPainted = this.heatBone;
  }

  _paintHeatMesh(mesh) {
    if (!mesh) return;
    const geo = mesh.geometry;
    const index = geo.attributes.skinIndex;
    const weight = geo.attributes.skinWeight;
    const color = geo.attributes.color;
    if (!index || !weight || !color) return;
    const idx = index.array;
    const wts = weight.array;
    const out = color.array;
    const bones = mesh.skeleton.bones;
    const boneName = this._skinBone(this.heatBone);
    let boneIndex = -1;
    if (boneName) {
      for (let i = 0; i < bones.length; i++) {
        if (bones[i].name === boneName) { boneIndex = i; break; }
      }
    }
    const count = geo.attributes.position.count;
    if (boneIndex >= 0) {
      for (let i = 0; i < count; i++) {
        const o = i * 4;
        let w = 0;
        if (idx[o] === boneIndex) w += wts[o];
        if (idx[o + 1] === boneIndex) w += wts[o + 1];
        if (idx[o + 2] === boneIndex) w += wts[o + 2];
        if (idx[o + 3] === boneIndex) w += wts[o + 3];
        heatRamp(w, out, i * 3);
      }
    } else {
      const cols = new Array(bones.length);
      for (let i = 0; i < bones.length; i++) {
        const hex = ENVELOPE_COLOR[bones[i].name];
        cols[i] = hex
          ? [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
          : hashColor(bones[i].name || "");
      }
      for (let i = 0; i < count; i++) {
        const o = i * 4;
        let best = wts[o];
        let bi = idx[o];
        if (wts[o + 1] > best) { best = wts[o + 1]; bi = idx[o + 1]; }
        if (wts[o + 2] > best) { best = wts[o + 2]; bi = idx[o + 2]; }
        if (wts[o + 3] > best) { best = wts[o + 3]; bi = idx[o + 3]; }
        const rgb = cols[bi] || [0.4, 0.4, 0.45];
        const scale = 0.28 + 0.72 * best;
        const c = i * 3;
        out[c] = rgb[0] * scale;
        out[c + 1] = rgb[1] * scale;
        out[c + 2] = rgb[2] * scale;
      }
    }
    color.needsUpdate = true;
  }

  _dropBones() {
    if (!this.bones) return;
    this.scene.remove(this.bones);
    if (this.bones.isGroup) {
      const shared = this.bones.userData.octa;
      if (shared?.edges) shared.edges.dispose();
      if (shared?.mat) shared.mat.dispose();
      if (shared?.edgeMat) shared.edgeMat.dispose();
    } else {
      this.bones.geometry?.dispose();
      this.bones.material?.dispose();
    }
    this.bones = null;
  }

  _boneSegments() {
    const segs = [];
    for (const [a, b] of LINKS) {
      if (!this.joints?.[a] || !this.joints?.[b]) continue;
      if (!this._linkVisible(a, b)) continue;
      segs.push([toThree(this.joints[a]), toThree(this.joints[b])]);
    }
    // Tissue bones live in extra_bones.json, not markers.json, so LINKS never
    // covers them. Drawn display-only: parent to pivot, pivot to tip.
    for (const [name, frame] of Object.entries(this.extraFrames || {})) {
      const parent = frame && frame.parent;
      if (!parent || !this.joints?.[parent] || !frame.head || !frame.tail) continue;
      if (this._linkVisible(parent, name)) segs.push([toThree(this.joints[parent]), toThree(frame.head)]);
      if (this._linkVisible(name, name)) segs.push([toThree(frame.head), toThree(frame.tail)]);
    }
    if (!this.soloBone) {
      for (const [a, b] of this._fingerSegs || []) {
        segs.push([toThree(a), toThree(b)]);
      }
    }
    return segs;
  }

  _drawBones() {
    this._dropBones();
    // In play/pose the animated skeleton from _syncSkeleton owns the overlay.
    // These joints are the static bind pose, so drawing them here would put a
    // second, T-posed skeleton on top of the one the clip is driving.
    if (this.mode === "play" || this.mode === "pose") return;
    if (!this.joints || !this.boneOverlay) return;
    const segs = this._boneSegments();
    if (!segs.length) return;
    if (this.boneStyle === "blender") {
      const group = new THREE.Group();
      const geo = octaBoneGeo();
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.82,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0xfff0c8,
        transparent: true,
        opacity: 0.98,
        depthTest: false,
      });
      const edges = new THREE.EdgesGeometry(geo);
      for (const [from, to] of segs) {
        const hold = new THREE.Group();
        const fill = new THREE.Mesh(geo, mat);
        const wire = new THREE.LineSegments(edges, edgeMat);
        hold.add(fill, wire);
        if (!placeOctaBone(hold, from, to)) continue;
        hold.renderOrder = 5;
        group.add(hold);
      }
      group.userData.octa = { mat, edgeMat, edges };
      group.visible = this.boneOverlay;
      this.bones = group;
      this.scene.add(group);
      return;
    }
    const pos = [];
    for (const [from, to] of segs) {
      pos.push(from.x, from.y, from.z, to.x, to.y, to.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.bones = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.bones.renderOrder = 5;
    this.bones.visible = this.boneOverlay;
    this.scene.add(this.bones);
  }

  showEnvelopes(on, scales) {
    const geos = new Set();
    const mats = new Set();
    this.envelopes.traverse((obj) => {
      if (obj.geometry) geos.add(obj.geometry);
      if (obj.material) mats.add(obj.material);
    });
    this.envelopes.clear();
    geos.forEach((geo) => geo.dispose());
    mats.forEach((mat) => mat.dispose());
    if (!on) return;
    const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
    const capGeo = new THREE.SphereGeometry(1, 16, 12);
    for (const name of ENVELOPE_BONES) {
      const start = this.joints[ENVELOPE_JOINT[name] || name];
      const end = this.joints[ENVELOPE_END[name]];
      if (!start || !end) continue;
      const hold = makeCapsule(tubeGeo, capGeo, ENVELOPE_COLOR[name] || 0xd4c8d8);
      hold.userData.name = name;
      hold.userData.hidden = this.hiddenEnvs.has(name);
      if (!placeCapsule(hold, toThree(start), toThree(end), envelopeRadius(this.H, (scales && scales[name]) || 1))) continue;
      hold.visible = this._envVisible(name);
      this.envelopes.add(hold);
    }
    for (const name of Object.keys(ENVELOPE_TISSUE_PARENT)) {
      const frame = (this.extraFrames || {})[name];
      const start = frame && this.joints[frame.parent || ENVELOPE_TISSUE_PARENT[name]];
      if (!frame || !start || !frame.head) continue;
      const hold = makeCapsule(tubeGeo, capGeo, ENVELOPE_COLOR[name] || 0xd4c8d8);
      hold.userData.name = name;
      hold.userData.hidden = this.hiddenEnvs.has(name);
      if (!placeCapsule(hold, toThree(start), toThree(frame.head), envelopeRadius(this.H, (scales && scales[name]) || 1))) continue;
      hold.visible = this._envVisible(name);
      this.envelopes.add(hold);
    }
    this._paintEnvelopeFocus(this.envelopes);
    this._applyEnvVisibility();
  }

  highlightEnvelope(name) {
    this._envFocus = name || "";
    this._paintEnvelopeFocus(this.envelopes);
    this._paintEnvelopeFocus(this.animEnv);
  }

  _paintEnvelopeFocus(group) {
    if (!group) return;
    const focus = this._envFocus;
    for (const hold of group.children) {
      const hot = !!focus && hold.userData.name === focus;
      const mat = hold.userData.mat;
      if (mat) mat.opacity = !focus ? 0.34 : hot ? 0.82 : 0.06;
      const order = hot ? 6 : 2;
      hold.renderOrder = order;
      for (const mesh of hold.children) mesh.renderOrder = order;
    }
  }

  setAnimEnvelopes(on, scales) {
    this.showAnimEnv = !!on;
    this.envScales = scales || {};
    this._envStamp = null;
    this._syncAnimEnvelopes();
  }

  _dropAnimEnvelopes() {
    if (!this.animEnv) return;
    const mats = new Set();
    this.animEnv.traverse((obj) => {
      if (obj.material) mats.add(obj.material);
    });
    mats.forEach((mat) => mat.dispose());
    this.scene.remove(this.animEnv);
    this.animEnvGeo.dispose();
    this.animEnvCap.dispose();
    this.animEnv = null;
    this.animEnvGeo = null;
    this.animEnvCap = null;
    this.animEnvMat = null;
    this._envStamp = null;
  }

  _syncAnimEnvelopes() {
    const live = this.showAnimEnv && this.root && (this.mode === "play" || this.mode === "pose");
    if (!live) {
      this._dropAnimEnvelopes();
      return;
    }
    const stamp = JSON.stringify(this.envScales || {});
    if (this.animEnv && this._envStamp === stamp) return;
    this._dropAnimEnvelopes();
    const bones = {};
    this.root.traverse((obj) => {
      if (obj.isBone && obj.name) bones[obj.name] = obj;
    });
    const group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
    const cap = new THREE.SphereGeometry(1, 16, 12);
    for (const name of ENVELOPE_BONES) {
      let bone = bones[name] || bones[ENVELOPE_JOINT[name]];
      let tail = bone && bones[ENVELOPE_TAIL[name]];
      if (!tail && bone && ENVELOPE_TISSUE_PARENT[name] && bones[ENVELOPE_TISSUE_PARENT[name]]) {
        tail = bone;
        bone = bones[ENVELOPE_TISSUE_PARENT[name]];
      }
      if (!bone || !tail) continue;
      const hold = makeCapsule(geo, cap, ENVELOPE_COLOR[name] || 0xd4c8d8);
      hold.userData.bone = bone;
      hold.userData.tail = tail;
      hold.userData.name = name;
      hold.userData.hidden = this.hiddenEnvs.has(name);
      group.add(hold);
    }
    this.scene.add(group);
    this.animEnv = group;
    this.animEnvGeo = geo;
    this.animEnvCap = cap;
    this.animEnvMat = null;
    this._envStamp = stamp;
    this._placeAnimEnvelopes();
    this._paintEnvelopeFocus(this.animEnv);
    this._applyEnvVisibility();
    this.animEnv.visible = !this.animHeat;
  }

  _placeAnimEnvelopes() {
    if (!this.animEnv || !this.root) return;
    if (!this.skel) this.root.updateWorldMatrix(true, true);
    for (const hold of this.animEnv.children) {
      const sc = (this.envScales && this.envScales[hold.userData.name]) || 1;
      hold.userData.bone.getWorldPosition(_envA);
      hold.userData.tail.getWorldPosition(_envB);
      placeCapsule(hold, _envA, _envB, envelopeRadius(this.H, sc));
    }
    this._applyEnvVisibility();
  }

  _clearDots() {
    for (const mesh of Object.values(this.dots)) this.scene.remove(mesh);
    for (const mesh of Object.values(this.extraDots || {})) this.scene.remove(mesh);
    for (const lab of Object.values(this.labels)) lab.remove();
    this.dots = {};
    this.extraDots = {};
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
    const hit = this._pick(ev) || this._pickSkel(ev);
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

  _pickHeat(ev) {
    if (!this.heatOn || !this.heatMesh) return "";
    if (!this.heatLive && !this.heatRoot?.visible) return "";
    const meshes = this.heatLive && this.animHeatMeshes?.length ? this.animHeatMeshes : [this.heatMesh];
    this._aim(ev);
    const hits = this.ray.intersectObjects(meshes, false);
    const hit = hits[0];
    if (!hit || !hit.face) return "";
    const geo = hit.object.geometry;
    const idx = geo.attributes.skinIndex?.array;
    const wts = geo.attributes.skinWeight?.array;
    const bones = hit.object.skeleton.bones;
    if (!idx || !wts) return "";
    const tally = new Map();
    for (const vi of [hit.face.a, hit.face.b, hit.face.c]) {
      const o = vi * 4;
      for (let k = 0; k < 4; k++) {
        const w = wts[o + k];
        if (w <= 0) continue;
        const name = bones[idx[o + k]]?.name;
        if (!name) continue;
        tally.set(name, (tally.get(name) || 0) + w);
      }
    }
    let best = "";
    let score = 0;
    for (const [name, w] of tally) {
      if (w > score) { score = w; best = name; }
    }
    return best;
  }

  _useHeatBone(name) {
    if (!name) return;
    const mesh = this.dots[name];
    if (mesh && mesh.userData.kind === "joint") {
      this.isolateBone(name);
      return;
    }
    this.setWeightBone(name);
    this.onIsolate && this.onIsolate("bone", name);
  }

  _pickEnvelope(ev) {
    if (this.mode !== "mesh" || !this.envelopes.children.length) return null;
    this._aim(ev);
    const meshes = [];
    for (const hold of this.envelopes.children) {
      if (!hold.visible) continue;
      for (const mesh of hold.children) {
        if (mesh.isMesh) meshes.push(mesh);
      }
    }
    const hits = this.ray.intersectObjects(meshes, false);
    return hits[0] ? hits[0].object.parent : null;
  }

  _aim(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
  }

  _pick(ev) {
    this._aim(ev);
    const hits = this.ray.intersectObjects([...Object.values(this.dots), ...Object.values(this.extraDots || {})], false);
    return hits[0] ? hits[0].object : null;
  }

  _pickSkel(ev) {
    if (!this.skelDots) return null;
    this._aim(ev);
    const hits = this.ray.intersectObjects(this.skelDots.group.children, false);
    return hits[0] ? hits[0].object : null;
  }

  _down(ev) {
    this._press = { x: ev.clientX, y: ev.clientY };
    this._heatClick = false;
    const hit = this._pick(ev);
    if (!hit) {
      const env = ev.button === 0 ? this._pickEnvelope(ev) : null;
      if (env && env.userData.name) {
        this.isolateEnvelope(env.userData.name);
        this.controls.enabled = false;
        ev.preventDefault();
        return;
      }
      if (ev.button === 0 && this._pickHeat(ev)) {
        this._heatClick = true;
        return;
      }
      if (ev.button === 0) {
        this.clearSolo();
        if (this.heatLive && this.heatBone) this.setWeightBone("");
        else if (this.heatOn && this.heatBone) this.setWeightBone("");
        this._releaseView();
      }
      return;
    }
    if (hit.userData.kind === "joint") this.isolateBone(hit.userData.id);
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
    if (this.drag.kind === "dot") {
      this._shiftDot(this.drag.id, delta);
      if (this.sym) this._mirrorShift(this.drag.id, delta);
    } else if (this.drag.kind === "finger") {
      this._shiftFinger(this.drag.id, delta);
      if (this.sym) this._mirrorShift(this.drag.id, delta);
    } else if (this.drag.kind === "extra") {
      this._shiftExtra(this.drag.id, delta);
      if (this.sym) this._mirrorShift(this.drag.id, delta);
      this.setBones(this.joints, this.H, this.fingers, null, true);
    } else {
      // Batch primary + mirror into one rebuild so the other side stays visible.
      this._nudgeJoint(this.drag.id, delta);
      if (this.sym) this._mirrorShift(this.drag.id, delta, true);
      this.setBones(this.joints, this.H, this.fingers, null, true);
    }
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

  _shiftExtra(id, delta) {
    const frame = this.extraFrames?.[id];
    if (!frame || !frame.head || !frame.tail) return;
    frame.head = frame.head.map((c, i) => c + delta[i]);
    frame.tail = frame.tail.map((c, i) => c + delta[i]);
    const mesh = this.extraDots?.[id];
    if (mesh) {
      mesh.userData.blender = frame.head.slice();
      mesh.position.copy(toThree(frame.head));
    }
  }

  _nudgeJoint(name, delta) {
    if (!this.joints[name]) return;
    this.joints[name] = this.joints[name].map((c, i) => c + delta[i]);
  }

  _shiftJoint(name, delta) {
    this._nudgeJoint(name, delta);
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

  /** Snapshot joint + finger pose affected by Bend/Twist/Swing on `name`. */
  captureRotatePose(name) {
    if (!name) return null;
    const names = new Set();
    const add = (id) => {
      if (!id) return;
      names.add(id);
      for (const child of descendants(id)) names.add(child);
    };
    add(name);
    add(mirrorId(name));
    const joints = {};
    for (const id of names) {
      if (this.joints?.[id]) joints[id] = this.joints[id].slice();
    }
    const tips = {};
    for (const id of Object.keys(this.fingerTips || {})) {
      const side = id.endsWith("_l") ? "l" : id.endsWith("_r") ? "r" : "";
      if (!side) continue;
      const hand = `hand_${side}`;
      if (names.has(hand) || names.has(id)) tips[id] = this.fingerTips[id].slice();
    }
    if (this.fingerTips?.[name]) tips[name] = this.fingerTips[name].slice();
    const otherTip = mirrorId(name);
    if (otherTip && this.fingerTips?.[otherTip]) tips[otherTip] = this.fingerTips[otherTip].slice();
    return { joints, tips };
  }

  restoreRotatePose(snap) {
    if (!snap) return;
    for (const [id, pt] of Object.entries(snap.joints || {})) {
      if (this.joints?.[id]) this.joints[id] = pt.slice();
    }
    if (!this.fingerTips) this.fingerTips = {};
    for (const [id, pt] of Object.entries(snap.tips || {})) {
      this.fingerTips[id] = pt.slice();
    }
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

  _mirrorShift(id, delta, soft = false) {
    const flip = delta.slice();
    flip[0] = -delta[0];
    if (id.endsWith("_l") || id.endsWith("_r")) {
      const other = id.slice(0, -1) + (id.endsWith("_l") ? "r" : "l");
      if (this.drag.kind === "dot" && BY_ID[other]) this._shiftDot(other, flip);
      if (this.drag.kind === "joint" && this.joints[other]) {
        if (soft) this._nudgeJoint(other, flip);
        else this._shiftJoint(other, flip);
      }
      if (this.drag.kind === "finger" && this.fingerTips?.[other]) this._shiftFinger(other, flip);
      if (this.drag.kind === "extra" && this.extraFrames?.[other]) this._shiftExtra(other, flip);
    }
  }

  _up(ev) {
    const press = this._press;
    const heatClick = this._heatClick;
    this._press = null;
    this._heatClick = false;
    this.controls.enabled = !this.locked;
    if (this.drag) {
      const moved = this.drag.id;
      const kind = this.drag.kind;
      this.drag = null;
      this._beginHintFade();
      if (kind === "extra") this.onExtra && this.onExtra(this._extraPost(), moved);
      else this.onJoints && this.onJoints(this.joints, moved);
      return;
    }
    if (!heatClick || !press) return;
    const dx = ev.clientX - press.x;
    const dy = ev.clientY - press.y;
    if (dx * dx + dy * dy > 25) return;
    this._useHeatBone(this._pickHeat(ev));
  }

  _extraPost() {
    const out = {};
    for (const [name, frame] of Object.entries(this.extraFrames || {})) {
      if (!frame || !frame.head || !frame.tail) continue;
      out[name] = { head: frame.head.slice(), tail: frame.tail.slice() };
    }
    return out;
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
    const mesh = this.dots[this.hintId] || this.extraDots?.[this.hintId] || this.skelDots?.byName[this.hintId];
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
    this._resetJiggle();
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
    if (this.jiggleOn && this.mode === "play" && !this.paused) this._jiggleStep(dt);
    this._placeSkeleton();
    this._placeAnimEnvelopes();
    if (this.onPlayback) this.onPlayback(this.playback());
    this.controls.update();
    this._layoutLabels();
    this.renderer.render(this.scene, this.camera);
  }
}

export { LANDMARKS };

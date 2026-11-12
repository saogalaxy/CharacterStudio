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
    this.loader = new GLTFLoader();
    this.clock = new THREE.Clock();
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.paused = false;
    this.timeScale = 1;
    this.hold = false;
    this.fit = { hip: 0, arms: 1, legs: 1, arm_space: 0, arm_fwd: 0, turn: 0 };
    this.view = "front";
    this.mode = "mesh";
    this.H = 1;
    this.joints = {};
    this.dots = {};
    this.bones = null;
    this.unlocked = new Set();
    this.showLabels = false;
    this.sym = true;
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
    this._bind = {};
    this._posed = {};
    this.root = null;
    box.addEventListener("pointerdown", (e) => this._down(e));
    box.addEventListener("pointermove", (e) => this._move(e));
    window.addEventListener("pointerup", (e) => this._up(e));
    box.addEventListener("pointermove", (e) => this._hover(e));
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
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.clearOverlay();
  }

  clearOverlay() {
    this._clearDots();
    if (this.bones) {
      this.scene.remove(this.bones);
      this.bones = null;
    }
    this.envelopes.clear();
  }

  async loadMesh(url) {
    this.clearModel();
    const gltf = await this.loader.loadAsync(url);
    this.root = gltf.scene;
    this.scene.add(this.root);
    this._frameObject(this.root);
    this.mode = "mesh";
  }

  async loadRig(url, hold) {
    this.clearModel();
    const gltf = await this.loader.loadAsync(url);
    this.root = gltf.scene;
    this.scene.add(this.root);
    this._frameObject(this.root);
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
    this.mode = hold ? "pose" : "play";
    if (!hold) {
      const name = this.actions.walk ? "walk" : Object.keys(this.actions)[0];
      if (name) this.play(name);
    }
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
    this.controls.enabled = name === "free";
    if (spots[name]) {
      this.camera.position.set(...spots[name]);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(center);
    }
    this.controls.target.copy(center);
    this.controls.update();
    document.querySelectorAll(".views button").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
  }

  setDots(joints, height, offJoints, offMarkers, unlocked) {
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
      const lab = document.createElement("div");
      lab.className = "label";
      lab.textContent = spec.label;
      lab.hidden = true;
      this.box.appendChild(lab);
      this.labels[spec.id] = lab;
    }
    this._paintDots();
  }

  setBones(joints, height) {
    this.joints = JSON.parse(JSON.stringify(joints || {}));
    this.H = height || this.H;
    if (this.bones) this.scene.remove(this.bones);
    const pos = [];
    for (const [a, b] of LINKS) {
      if (!this.joints[a] || !this.joints[b]) continue;
      pos.push(...toThree(this.joints[a]).toArray(), ...toThree(this.joints[b]).toArray());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.bones = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.bones.renderOrder = 5;
    this.scene.add(this.bones);
    this._clearDots();
    for (const [name, value] of Object.entries(this.joints)) {
      if (name.startsWith("toe") || name.includes("leaf")) continue;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(this.H * 0.01, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x7ec8ff, depthTest: false }),
      );
      mesh.position.copy(toThree(value));
      mesh.userData = { kind: "joint", id: name, blender: value.slice() };
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      this.dots[name] = mesh;
    }
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

  _hover(ev) {
    if (this.showLabels) return;
    const hit = this._pick(ev);
    for (const [id, lab] of Object.entries(this.labels)) lab.hidden = !hit || hit.userData.id !== id;
    if (hit && this.labels[hit.userData.id]) this._placeLabel(hit.userData.id);
  }

  setShowLabels(on) {
    this.showLabels = !!on;
    for (const id of Object.keys(this.labels)) {
      this.labels[id].hidden = !this.showLabels;
      if (this.showLabels) this._placeLabel(id);
    }
  }

  _placeLabel(id) {
    const mesh = this.dots[id];
    const lab = this.labels[id];
    if (!mesh || !lab) return;
    const p = mesh.position.clone().project(this.camera);
    const w = this.box.clientWidth;
    const h = this.box.clientHeight;
    lab.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
    lab.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
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
    if (!hit) return;
    const spec = BY_ID[hit.userData.id];
    if (spec && spec.tone === "follow" && !this.unlocked.has(spec.id)) {
      this.unlocked.add(spec.id);
      this._paintDots();
      this.onUnlocked && this.onUnlocked(spec.id);
    }
    this.drag = { id: hit.userData.id, kind: hit.userData.kind, last: hit.userData.blender.slice() };
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
    if (!this.drag) {
      if (this.showLabels) for (const id of Object.keys(this.labels)) this._placeLabel(id);
      return;
    }
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
    else this._shiftJoint(this.drag.id, delta);
    if (this.sym) this._mirrorShift(this.drag.id, delta);
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
    this.setBones(this.joints, this.H);
  }

  _mirrorShift(id, delta) {
    const flip = delta.slice();
    flip[0] = -delta[0];
    if (id.endsWith("_l") || id.endsWith("_r")) {
      const other = id.slice(0, -1) + (id.endsWith("_l") ? "r" : "l");
      if (this.drag.kind === "dot" && BY_ID[other]) this._shiftDot(other, flip);
      if (this.drag.kind === "joint" && this.joints[other]) this._shiftJoint(other, flip);
    }
  }

  _up() {
    if (!this.drag) return;
    const moved = this.drag.id;
    this.drag = null;
    this.onJoints && this.onJoints(this.joints, moved);
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
      if (obj.name.startsWith("upperarm")) {
        obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(this.fit.arm_space * side)));
        obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(this.fit.arm_fwd)));
      }
    });
  }

  _frame() {
    requestAnimationFrame(() => this._frame());
    const dt = this.clock.getDelta();
    if (this.mixer && this.mode === "play" && !this.paused) {
      this.mixer.update(dt * (this.timeScale || 1));
      this._snapshot();
    }
    if (this.mode === "play" || this.mode === "pose") this._applyFit();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

export { LANDMARKS };

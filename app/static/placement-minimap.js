// Compact front / side placement mini-map — matches Character Studio joint ids & colors.
// Front view is face-on: character LEFT (blue) is screen-right; character RIGHT (red) is screen-left.

const CENTER = "#f5c542";
const LEFT = "#3d8bfd";
const RIGHT = "#e23b3b";
const LEFT_TIP = "#9ec1ff";
const RIGHT_TIP = "#f0a0a0";
const BONE = "#FEF3C7";
const BONE_FILL = "rgba(253, 230, 138, 0.28)";

// Coordinates: front T-pose (character L on +X / screen-right). Side profile facing left; larger X = toward the back.
const JOINTS = [
  {
    id: "head_top", short: "Crown", group: "c",
    front: [200, 28], side: [182, 28],
    tip: "Top of the head. Keep centered over the skull — not drifted over the forehead.",
  },
  {
    id: "head", short: "Head", group: "c",
    front: [200, 78], side: [188, 78],
    tip: "Head pivot at jaw / ear height. Sit inside the skull, not on the face surface.",
  },
  {
    id: "neck_base", short: "Neck", group: "c",
    front: [200, 102], side: [194, 102],
    tip: "Base of the neck between the collarbones, where the clavicles split. Slightly toward the back of the neck.",
  },
  {
    id: "spine_03", short: "Chest", group: "c",
    front: [200, 132], side: [202, 132],
    tip: "Chest / upper spine. Keep ~60–70% back from the front of the torso so the sides do not collapse.",
  },
  {
    id: "spine_02", short: "Mid belly", group: "c",
    front: [200, 162], side: [204, 162],
    tip: "Mid torso / ribcage. Follow a gentle back-leaning S-curve — not flush with the front belly.",
  },
  {
    id: "spine_01", short: "Low belly", group: "c",
    front: [200, 190], side: [201, 190],
    tip: "Low belly, just above the hips. Stay near the posterior center for clean bends.",
  },
  {
    id: "pelvis", short: "Hips", group: "c",
    front: [200, 214], side: [198, 214],
    tip: "Center of the hips where the legs meet the body. Seat in the pelvic core, slightly behind the front crease.",
  },

  // Character RIGHT (red) — screen-left when facing the character
  {
    id: "clavicle_r", short: "Collarbone (R)", group: "r",
    front: [189, 112], side: [193, 112],
    tip: "Right collarbone, from the neck base out toward the shoulder. Keep near the upper chest core.",
  },
  {
    id: "upperarm_r", short: "Shoulder (R)", group: "r",
    front: [162, 110], side: [196, 110],
    tip: "Right shoulder socket where the arm leaves the body. Inside the deltoid, above the armpit.",
  },
  {
    id: "lowerarm_r", short: "Elbow (R)", group: "r",
    front: [114, 112], side: [202, 158],
    tip: "Right elbow at the bend. Slight backward bias so IK folds the right way.",
  },
  {
    id: "hand_r", short: "Wrist (R)", group: "r",
    front: [66, 113], side: [198, 206],
    tip: "Right wrist crease where the hand pivots — not inside the palm.",
  },
  {
    id: "hand_tip_r", short: "Fingertip (R)", group: "rt",
    front: [28, 113], side: [196, 234],
    tip: "Tips of the right fingers — end of the hand bone.",
  },
  {
    id: "thigh_r", short: "Hip (R)", group: "r",
    front: [183, 226], side: [194, 226],
    tip: "Outside of the right hip / femur head. Not forward on the front hip crease.",
  },
  {
    id: "calf_r", short: "Knee (R)", group: "r",
    front: [185, 324], side: [190, 324],
    tip: "Right knee. Sit slightly forward of the hip→ankle line so the knee bends forward.",
  },
  {
    id: "foot_r", short: "Ankle (R)", group: "r",
    front: [185, 410], side: [197, 410],
    tip: "Right ankle, toward the heel / rear shin — not out on the instep.",
  },
  {
    id: "ball_r", short: "Toes (R)", group: "r",
    front: [183, 428], side: [170, 428],
    tip: "Base of the right toes (ball of the foot), near the sole flex crease.",
  },
  {
    id: "toe_r", short: "Toe tips (R)", group: "rt",
    front: [182, 434], side: [149, 432],
    tip: "Tips of the right toes / shoe tip.",
  },

  // Character LEFT (blue) — screen-right when facing the character
  {
    id: "clavicle_l", short: "Collarbone (L)", group: "l",
    front: [211, 112], side: [196, 113],
    tip: "Left collarbone, from the neck base out toward the shoulder. Match depth with the right.",
  },
  {
    id: "upperarm_l", short: "Shoulder (L)", group: "l",
    front: [238, 110], side: [200, 112],
    tip: "Left shoulder socket where the arm leaves the body. Inside the deltoid, above the armpit.",
  },
  {
    id: "lowerarm_l", short: "Elbow (L)", group: "l",
    front: [286, 112], side: [206, 160],
    tip: "Left elbow at the bend. Slight backward bias so IK folds the right way.",
  },
  {
    id: "hand_l", short: "Wrist (L)", group: "l",
    front: [334, 113], side: [202, 208],
    tip: "Left wrist crease where the hand pivots — not inside the palm.",
  },
  {
    id: "hand_tip_l", short: "Fingertip (L)", group: "lt",
    front: [372, 113], side: [200, 236],
    tip: "Tips of the left fingers — end of the hand bone.",
  },
  {
    id: "thigh_l", short: "Hip (L)", group: "l",
    front: [217, 226], side: [198, 228],
    tip: "Outside of the left hip / femur head. Not forward on the front hip crease.",
  },
  {
    id: "calf_l", short: "Knee (L)", group: "l",
    front: [215, 324], side: [194, 326],
    tip: "Left knee. Sit slightly forward of the hip→ankle line so the knee bends forward.",
  },
  {
    id: "foot_l", short: "Ankle (L)", group: "l",
    front: [215, 410], side: [201, 412],
    tip: "Left ankle, toward the heel / rear shin — not out on the instep.",
  },
  {
    id: "ball_l", short: "Toes (L)", group: "l",
    front: [217, 428], side: [174, 430],
    tip: "Base of the left toes (ball of the foot), near the sole flex crease.",
  },
  {
    id: "toe_l", short: "Toe tips (L)", group: "lt",
    front: [218, 434], side: [153, 434],
    tip: "Tips of the left toes / shoe tip.",
  },
];

const BONES = [
  ["head_top", "head"], ["head", "neck_base"], ["neck_base", "spine_03"],
  ["spine_03", "spine_02"], ["spine_02", "spine_01"], ["spine_01", "pelvis"],
  ["neck_base", "clavicle_r"], ["clavicle_r", "upperarm_r"], ["upperarm_r", "lowerarm_r"],
  ["lowerarm_r", "hand_r"], ["hand_r", "hand_tip_r"],
  ["pelvis", "thigh_r"], ["thigh_r", "calf_r"], ["calf_r", "foot_r"], ["foot_r", "ball_r"], ["ball_r", "toe_r"],
  ["neck_base", "clavicle_l"], ["clavicle_l", "upperarm_l"], ["upperarm_l", "lowerarm_l"],
  ["lowerarm_l", "hand_l"], ["hand_l", "hand_tip_l"],
  ["pelvis", "thigh_l"], ["thigh_l", "calf_l"], ["calf_l", "foot_l"], ["foot_l", "ball_l"], ["ball_l", "toe_l"],
];

const FRONT_SIL =
  "M200,26 C216,26 226,38 226,56 C226,71 218,82 211,86 L212,96 L246,103 L324,106 L372,108 C379,108 381,115 374,118 L328,121 L248,123 L236,166 L228,208 C240,224 244,246 240,274 L228,338 L225,416 L237,433 L208,435 L206,338 L202,246 L198,246 L194,338 L192,435 L163,433 L175,416 L172,338 L160,274 C156,246 160,224 172,208 L164,166 L152,123 L72,121 L26,118 C19,115 21,108 28,108 L76,106 L154,103 L188,96 L189,86 C182,82 174,71 174,56 C174,38 184,26 200,26 Z";

const SIDE_SIL =
  "M190,26 C172,26 162,40 163,58 C163,67 159,71 157,75 C160,78 164,80 165,85 C165,91 172,93 180,93 L178,106 C156,115 142,135 146,158 C149,176 164,186 170,204 C172,216 166,230 166,248 C166,272 172,300 179,330 C181,344 183,366 185,402 L183,420 L146,430 C141,432 142,437 149,437 L213,437 C218,437 219,430 215,422 L209,401 C213,372 217,346 213,328 C215,300 225,272 223,242 C221,224 213,212 213,198 C215,178 223,152 219,126 C216,110 209,99 209,89 C217,81 221,68 220,54 C219,37 205,26 190,26 Z";

function colorFor(group) {
  if (group === "c") return CENTER;
  if (group === "l") return LEFT;
  if (group === "r") return RIGHT;
  if (group === "lt") return LEFT_TIP;
  return RIGHT_TIP;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function octaBone(p1, p2) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  if (len < 2) {
    return svgEl("line", {
      x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
      stroke: BONE, "stroke-width": "1.4",
    });
  }
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const neck = Math.min(len * 0.24, 14);
  const half = Math.min(Math.max(len * 0.11, 2.0), 5.5);
  const cx = p1[0] + ux * neck;
  const cy = p1[1] + uy * neck;
  const g = svgEl("g");
  g.appendChild(svgEl("polygon", {
    points: `${p1[0]},${p1[1]} ${cx + px * half},${cy + py * half} ${p2[0]},${p2[1]} ${cx - px * half},${cy - py * half}`,
    fill: BONE_FILL,
    stroke: BONE,
    "stroke-width": "1",
    "stroke-linejoin": "round",
  }));
  return g;
}

function pt(joint, view) {
  return view === "side" ? joint.side : joint.front;
}

function drawMap(svg, view, selectedId, onPick) {
  svg.replaceChildren();
  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", { id: "mm-body", x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "#94a3b8", "stop-opacity": "0.2" }));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "#475569", "stop-opacity": "0.12" }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  svg.appendChild(svgEl("rect", {
    x: "0", y: "0", width: "400", height: "465", fill: "#0F1115",
  }));

  const grid = svgEl("g", { opacity: "0.35" });
  for (let x = 26; x < 400; x += 26) {
    grid.appendChild(svgEl("line", { x1: x, y1: 8, x2: x, y2: 455, stroke: "#272E3D", "stroke-width": "1" }));
  }
  for (let y = 26; y < 465; y += 26) {
    grid.appendChild(svgEl("line", { x1: 8, y1: y, x2: 392, y2: y, stroke: "#272E3D", "stroke-width": "1" }));
  }
  svg.appendChild(grid);

  if (view === "front") {
    svg.appendChild(svgEl("line", {
      x1: 200, y1: 16, x2: 200, y2: 440,
      stroke: CENTER, "stroke-opacity": "0.25", "stroke-width": "1", "stroke-dasharray": "4 4",
    }));
    const tr = svgEl("text", {
      x: "58", y: "84", "text-anchor": "middle", fill: RIGHT, "fill-opacity": "0.9",
      "font-size": "9", "font-family": "Consolas, monospace", "font-weight": "600",
    });
    tr.textContent = "RIGHT (RED)";
    svg.appendChild(tr);
    const tl = svgEl("text", {
      x: "342", y: "84", "text-anchor": "middle", fill: LEFT, "fill-opacity": "0.9",
      "font-size": "9", "font-family": "Consolas, monospace", "font-weight": "600",
    });
    tl.textContent = "LEFT (BLUE)";
    svg.appendChild(tl);
  } else {
    svg.appendChild(svgEl("line", {
      x1: 196, y1: 16, x2: 196, y2: 440,
      stroke: "#38bdf8", "stroke-opacity": "0.3", "stroke-width": "1", "stroke-dasharray": "4 4",
    }));
    const tz = svgEl("text", {
      x: "196", y: "14", "text-anchor": "middle", fill: "#38bdf8", "fill-opacity": "0.75",
      "font-size": "9", "font-family": "Consolas, monospace",
    });
    tz.textContent = "DEPTH (FRONT ← → BACK)";
    svg.appendChild(tz);
  }

  svg.appendChild(svgEl("path", {
    d: view === "front" ? FRONT_SIL : SIDE_SIL,
    fill: "url(#mm-body)",
    stroke: "#475569",
    "stroke-width": "1.2",
  }));

  if (view === "side") {
    svg.appendChild(svgEl("path", {
      d: "M188,83 Q204,132 203,174 T197,212",
      fill: "none",
      stroke: CENTER,
      "stroke-width": "1",
      "stroke-dasharray": "2 3",
      opacity: "0.7",
    }));
  }

  const byId = Object.fromEntries(JOINTS.map((j) => [j.id, j]));
  const bones = svgEl("g");
  for (const [a, b] of BONES) {
    bones.appendChild(octaBone(pt(byId[a], view), pt(byId[b], view)));
  }
  svg.appendChild(bones);

  const selected = JOINTS.find((j) => j.id === selectedId) || byId.spine_03;
  for (const joint of JOINTS) {
    const [x, y] = pt(joint, view);
    const fill = colorFor(joint.group);
    const on = joint.id === selected.id;
    const g = svgEl("g", { class: "mm-joint", transform: `translate(${x},${y})`, style: "cursor:pointer" });
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onPick(joint.id);
    });
    g.appendChild(svgEl("circle", { r: "10", fill: "transparent" }));
    if (on) {
      g.appendChild(svgEl("circle", {
        r: "8", fill: "none", stroke: fill, "stroke-width": "2", opacity: "0.9",
      }));
    }
    g.appendChild(svgEl("circle", {
      r: on ? "5.5" : "4",
      fill,
      stroke: on ? "#fff" : "#0F1115",
      "stroke-width": on ? "1.5" : "1",
    }));
    if (on) {
      // Character left is screen-right → label outward to the right; right side outward left.
      const outward = view === "side" ? 1 : (joint.group === "l" || joint.group === "lt" ? 1 : -1);
      const label = svgEl("text", {
        x: String(outward * 11),
        y: "3.5",
        "text-anchor": outward < 0 ? "end" : "start",
        fill: "#fff",
        "font-size": "10",
        "font-family": "Consolas, monospace",
        "font-weight": "700",
        stroke: "#0F1115",
        "stroke-width": "3",
        "paint-order": "stroke",
      });
      label.textContent = joint.short;
      g.appendChild(label);
    }
    svg.appendChild(g);
  }
}

/** Mount front/side placement mini-map into host. Returns root element. */
export function mountPlacementMinimap(host) {
  let view = "front";
  let selectedId = "spine_03";

  const root = document.createElement("div");
  root.className = "place-map";

  const head = document.createElement("div");
  head.className = "place-map-head";
  const title = document.createElement("span");
  title.className = "place-map-title";
  title.textContent = "Placement map";
  const tabs = document.createElement("div");
  tabs.className = "place-map-tabs";
  const frontBtn = document.createElement("button");
  frontBtn.type = "button";
  frontBtn.textContent = "Front";
  const sideBtn = document.createElement("button");
  sideBtn.type = "button";
  sideBtn.textContent = "Side";
  tabs.append(frontBtn, sideBtn);
  head.append(title, tabs);
  root.appendChild(head);

  const frame = document.createElement("div");
  frame.className = "place-map-frame";
  const svg = svgEl("svg", { viewBox: "0 0 400 465", class: "place-map-svg" });
  frame.appendChild(svg);
  root.appendChild(frame);

  const tip = document.createElement("p");
  tip.className = "place-map-tip help";
  root.appendChild(tip);

  const legend = document.createElement("div");
  legend.className = "place-map-legend";
  legend.innerHTML =
    `<span><i style="background:${CENTER}"></i>Center</span>` +
    `<span><i style="background:${LEFT}"></i>Left</span>` +
    `<span><i style="background:${RIGHT}"></i>Right</span>`;
  root.appendChild(legend);

  function paint() {
    frontBtn.classList.toggle("on", view === "front");
    sideBtn.classList.toggle("on", view === "side");
    drawMap(svg, view, selectedId, (id) => {
      selectedId = id;
      paint();
    });
    const joint = JOINTS.find((j) => j.id === selectedId) || JOINTS[0];
    tip.textContent = `${joint.short}: ${joint.tip}`;
  }

  frontBtn.onclick = () => { view = "front"; paint(); };
  sideBtn.onclick = () => { view = "side"; paint(); };
  paint();

  host.appendChild(root);
  return root;
}

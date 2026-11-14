"""Place dots and joints on a T-pose mesh, and test them in 3D.

Blender coordinates: Z is up, the character faces -Y, and character-left is +X.
Mesh height is only a ruler for the small gaps. The skeleton is the joints.
"""
import numpy as np

MARKER_NAMES = ("chin", "groin", "elbow_l", "elbow_r", "wrist_l", "wrist_r", "knee_l", "knee_r")
ENVELOPE_BONES = ("pelvis", "spine_01", "spine_02", "spine_03", "thigh_l", "thigh_r")
ENVELOPE_OVERRIDE_BONES = (
    "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "neck_01", "head",
    "lowerarm_l", "lowerarm_r", "hand_l", "hand_r",
    "calf_l", "calf_r", "foot_l", "foot_r",
)
# AF-like paint: smaller scale ⇒ tighter sigma ⇒ stronger nearest ownership.
# Neck ownership is also collar-clamped in wear.paint (scale alone is not enough).
DEFAULT_ENVELOPE_SCALES = {
    "neck_01": 0.55,
    "clavicle_l": 0.80,
    "clavicle_r": 0.80,
    "upperarm_l": 0.45,
    "upperarm_r": 0.45,
    "lowerarm_l": 0.50,
    "lowerarm_r": 0.50,
    "spine_03": 0.55,
    "calf_l": 0.85,
    "calf_r": 0.85,
    "foot_l": 0.65,
    "foot_r": 0.65,
}
JOINT_GATE = (
    "pelvis", "neck", "head",
    "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r",
    "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r",
)


def _as_cloud(V):
    P = np.asarray(V, dtype=np.float64)
    if P.ndim != 2 or P.shape[1] != 3 or len(P) < 100:
        raise RuntimeError("the mesh has no usable surface")
    return P


def bounds(V):
    P = _as_cloud(V)
    zmin = float(P[:, 2].min())
    zmax = float(P[:, 2].max())
    return float(zmax - zmin), zmin, zmax


def _band(V, z, tol):
    return V[np.abs(V[:, 2] - z) < tol]


def _clusters(values, gap):
    if len(values) == 0:
        return []
    order = np.sort(values)
    cuts = np.where(np.diff(order) > gap)[0]
    starts = np.r_[0, cuts + 1]
    ends = np.r_[cuts, len(order) - 1]
    return [order[a:b + 1] for a, b in zip(starts, ends)]


def solid_span(values, height):
    """Front and back of the solid body, trimming thin sheets such as loose hair.

    Long anime hair often merges with the torso in a depth slice and pulls the
    back (or front) of the span into the hair. We keep the densest Y-band and
    drop sparse tails so spine joints sit in the body, not the hair.
    """
    values = np.asarray(values, dtype=np.float64)
    if len(values) < 8:
        return None
    groups = _clusters(values, 0.04 * height)
    groups = [g for g in groups if len(g) >= 8]
    if not groups:
        return None
    # Long hair often has MORE verts than the torso. Prefer a thick-enough
    # front-most cluster (torso/chest) over a denser hair sheet behind.
    thick = [g for g in groups if float(g[-1] - g[0]) >= 0.035 * height]
    if thick:
        body = np.asarray(min(thick, key=lambda g: float(g[0])), dtype=np.float64)
    else:
        body = np.asarray(max(groups, key=len), dtype=np.float64)
    lo, hi = float(body[0]), float(body[-1])
    thickness = hi - lo
    if thickness < 1e-6:
        return lo, hi

    # Density along Y — trim bins below a fraction of the peak (hair tails).
    bins = max(12, int(thickness / max(0.008 * height, 1e-6)))
    hist, edges = np.histogram(body, bins=bins, range=(lo, hi))
    peak = int(hist.max()) if len(hist) else 0
    if peak < 3:
        return lo, hi
    floor = max(2, int(peak * 0.28))
    dense = np.where(hist >= floor)[0]
    if len(dense) == 0:
        return lo, hi
    # Largest contiguous dense run (core body).
    runs = np.split(dense, np.where(np.diff(dense) > 1)[0] + 1)
    run = max(runs, key=len)
    front = float(edges[int(run[0])])
    back = float(edges[int(run[-1]) + 1])
    # Keep a minimum core so we do not collapse to a plane.
    if back - front < 0.03 * height:
        return lo, hi
    return front, back


def place_depth(V, height, z, xlim, bias, max_span=None):
    """A measured depth inside the solid body at this height. 0 is the front, 1 is the back.

    ``max_span`` caps how deep we measure from the front. Long hair behind the
    torso must not stretch the back of the range or spine joints follow the hair.
    """
    sl = _band(V, z, 0.014 * height)
    sl = sl[np.abs(sl[:, 0]) < xlim]
    span = solid_span(sl[:, 1], height) if len(sl) else None
    if span is None:
        return None
    front, back = span
    extent = back - front
    if max_span is not None:
        extent = min(extent, float(max_span))
        # Always grow from the front (chest), never chase hair backward.
        back = front + extent
    bias = min(1.0, max(0.0, float(bias)))
    return float(front + bias * (back - front))


def place_torso_depth(V, height, z, xlim, bias):
    """Depth for spine / pelvis along the torso center line.

    Measures from the real front of the silhouette (breast/chest included as the
    front reference) then steps ``bias`` of the way toward a hair-trimmed back.
    Target for chest is ~60–70% back so the joint sits in the ribcage, not on
    the breast tip and not in the ponytail.
    """
    sl = _band(V, z, 0.016 * height)
    sl = sl[np.abs(sl[:, 0]) < xlim]
    if len(sl) < 20:
        sl = _band(V, z, 0.022 * height)
        sl = sl[np.abs(sl[:, 0]) < xlim * 1.35]
    if len(sl) < 12:
        return place_depth(V, height, z, xlim, bias, max_span=0.12 * height)
    ys = sl[:, 1]
    # Front of torso (breast tip counts as front). Cut hair off the back early.
    front = float(np.percentile(ys, 6))
    back = float(np.percentile(ys, 58))
    if back - front < 0.04 * height:
        front = float(np.percentile(ys, 4))
        back = float(np.percentile(ys, 65))
    if back - front < 0.025 * height:
        return place_depth(V, height, z, xlim, bias, max_span=0.12 * height)
    extent = min(back - front, 0.14 * height)
    bias = min(1.0, max(0.0, float(bias)))
    return float(front + bias * extent)


def _dense_width(xs, height):
    groups = _clusters(xs, 0.03 * height)
    groups = [g for g in groups if len(g) >= 8]
    if not groups:
        return None
    body = max(groups, key=len)
    return float(body[-1] - body[0])


def _arm_height(V, height, zmin, zmax):
    best = None
    for z in np.linspace(zmin + 0.52 * height, zmin + 0.80 * height, 48):
        sl = _band(V, z, 0.008 * height)
        if len(sl) < 30:
            continue
        width = float(sl[:, 0].max() - sl[:, 0].min())
        if best is None or width > best[0]:
            best = (width, float(z))
    if best is None:
        raise RuntimeError("arms not found on this mesh")
    return best[1]


def _neck_height(V, height, arm_z, zmax):
    best = None
    lo = arm_z + 0.02 * height
    hi = min(arm_z + 0.14 * height, zmax - 0.08 * height)
    if hi <= lo:
        hi = lo + 0.04 * height
    for z in np.linspace(lo, hi, 36):
        sl = _band(V, z, 0.006 * height)
        sl = sl[np.abs(sl[:, 0]) < 0.22 * height]
        width = _dense_width(sl[:, 0], height) if len(sl) else None
        if width is None:
            continue
        if best is None or width < best[0]:
            best = (width, float(z))
    if best is None:
        raise RuntimeError("neck not found above the arms")
    return float(np.clip(best[1], arm_z + 0.025 * height, arm_z + 0.08 * height))


def _groin_height(V, height, zmin):
    last_filled = None
    empties = 0
    for z in np.linspace(zmin + 0.62 * height, zmin + 0.28 * height, 120):
        sl = _band(V, z, 0.007 * height)
        xs = np.sort(sl[np.abs(sl[:, 0]) < 0.07 * height][:, 0])
        gap = False
        if len(xs) >= 4:
            cuts = np.where(np.diff(xs) > 0.012 * height)[0]
            gap = any(xs[i] < 0.01 * height and xs[i + 1] > -0.01 * height for i in cuts)
        else:
            gap = True
        if not gap:
            last_filled, empties = float(z), 0
        else:
            empties += 1
            if empties >= 3 and last_filled is not None:
                return last_filled
    if last_filled is None:
        raise RuntimeError("groin not found: the legs never separate")
    return last_filled


def _armpit(V, height, side, arm_z, tip):
    sl = _band(V, arm_z, 0.02 * height)
    sl = sl[sl[:, 0] * side > 0]
    columns = np.linspace(0.04 * height, max(tip * 0.72, 0.12 * height), 36)
    counts = []
    for x in columns:
        counts.append(int(np.sum(np.abs(np.abs(sl[:, 0]) - x) < 0.012 * height)))
    counts = np.asarray(counts)
    if len(counts) < 5 or counts.max() < 8:
        return float(0.16 * height)
    # The armpit is the quiet column between the torso and the arm.
    inner = counts[: len(counts) // 2]
    idx = int(np.argmin(inner))
    return float(columns[idx])


def _tip(V, height, side, arm_z):
    sl = _band(V, arm_z, 0.08 * height)
    sl = sl[sl[:, 0] * side > 0]
    if len(sl) < 10:
        sl = V[V[:, 0] * side > 0]
    return float(np.percentile(np.abs(sl[:, 0]), 98))


def _arm_point(V, height, side, x, z, min_x=None):
    """Center of the arm limb at this X/Z — ignore chest/breast depth."""
    x = abs(float(x))
    floor_x = abs(float(min_x)) if min_x is not None else 0.02 * height
    # Keep samples on the limb column, outside the torso/breast slab.
    sl = V[(V[:, 0] * side > max(floor_x, x - 0.03 * height))
           & (np.abs(np.abs(V[:, 0]) - x) < 0.022 * height)
           & (np.abs(V[:, 2] - z) < 0.035 * height)]
    if len(sl) < 6:
        sl = V[(V[:, 0] * side > max(floor_x, x * 0.85))
               & (np.abs(np.abs(V[:, 0]) - x) < 0.04 * height)
               & (np.abs(V[:, 2] - z) < 0.05 * height)]
    if len(sl) < 4:
        return (float(side * x), 0.0, float(z))
    # Prefer the rearmost solid cluster so bust/chest fronts do not pull Y forward.
    groups = _clusters(sl[:, 1], 0.035 * height)
    groups = [g for g in groups if len(g) >= 5]
    if groups:
        limb = max(groups, key=lambda g: (float(np.median(g)), len(g)))
        y = float(np.median(limb))
    else:
        span = solid_span(sl[:, 1], height)
        y = float((span[0] + span[1]) * 0.5) if span else float(np.median(sl[:, 1]))
    return (float(side * x), y, float(z))


def _leg_point(V, height, side, z):
    sl = V[(V[:, 0] * side > 0.005 * height)
           & (np.abs(V[:, 0]) < 0.22 * height)
           & (np.abs(V[:, 2] - z) < 0.012 * height)]
    if len(sl) < 8:
        return None
    span = solid_span(sl[:, 1], height)
    y = float(span[0] + 0.45 * (span[1] - span[0])) if span else float(np.median(sl[:, 1]))
    return (float(side * np.median(np.abs(sl[:, 0]))), y, float(z))


def _knee_height(V, height, side, groin_z, zmin):
    """Find the knee on this leg. Anime thighs run long — avoid sitting too low."""
    ankle_z = zmin + 0.055 * height
    span = max(groin_z - ankle_z, 0.05 * height)
    # Default: above the geometric midpoint (mesh knee is higher than mid hip→ankle).
    fallback = ankle_z + 0.58 * span
    lo = ankle_z + 0.35 * span
    hi = groin_z - 0.12 * span
    if hi <= lo:
        return float(fallback)
    best_z = float(fallback)
    best_score = None
    for z in np.linspace(lo, hi, 40):
        sl = V[(V[:, 0] * side > 0.012 * height)
               & (np.abs(V[:, 0]) < 0.20 * height)
               & (np.abs(V[:, 2] - z) < 0.01 * height)]
        if len(sl) < 10:
            continue
        # Front-view leg thickness — the knee is a local narrow.
        width = float(np.percentile(np.abs(sl[:, 0]), 88) - np.percentile(np.abs(sl[:, 0]), 12))
        # Slight preference for higher candidates (anime knee reads high).
        score = width - 0.15 * ((z - lo) / max(hi - lo, 1e-6)) * width
        if best_score is None or score < best_score:
            best_score = score
            best_z = float(z)
    return best_z


def detect(V):
    """Eight Action Forge dots, measured on the mesh."""
    P = _as_cloud(V)
    height, zmin, zmax = bounds(P)
    arm_z = _arm_height(P, height, zmin, zmax)
    neck_z = _neck_height(P, height, arm_z, zmax)
    # Chin sits just above the neck joint. Hand-place on the jaw when auto
    # lands high on big-hair anime faces (see marker-placement rule).
    chin_z = float(neck_z + 0.025 * height)
    groin_z = _groin_height(P, height, zmin)
    chin_y = place_depth(P, height, chin_z, 0.08 * height, 0.12)
    if chin_y is None:
        chin_y = place_depth(P, height, neck_z, 0.08 * height, 0.2) or 0.0
    groin_y = place_depth(P, height, groin_z, 0.06 * height, 0.45)
    if groin_y is None:
        groin_y = 0.0
    markers = {
        "chin": [0.0, float(chin_y), float(chin_z)],
        "groin": [0.0, float(groin_y), float(groin_z)],
    }
    for side, name in ((1.0, "l"), (-1.0, "r")):
        tip = _tip(P, height, side, arm_z)
        shoulder_x = _armpit(P, height, side, arm_z, tip)
        wrist_x = max(shoulder_x + 0.08 * height, tip - 0.10 * height)
        elbow_x = (shoulder_x + wrist_x) * 0.5
        # min_x keeps samples off the chest when centering arm depth.
        wrist = _arm_point(P, height, side, wrist_x, arm_z, min_x=shoulder_x + 0.04 * height)
        elbow = _arm_point(P, height, side, elbow_x, arm_z, min_x=shoulder_x + 0.02 * height)
        knee_z = _knee_height(P, height, side, groin_z, zmin)
        knee = _leg_point(P, height, side, knee_z) or (side * 0.08 * height, groin_y, knee_z)
        markers[f"wrist_{name}"] = [float(c) for c in wrist]
        markers[f"elbow_{name}"] = [float(c) for c in elbow]
        markers[f"knee_{name}"] = [float(c) for c in knee]
    return {"height": height, "zmin": zmin, "zmax": zmax, "markers": markers}


def _mirror_pairs(joints):
    pairs = (
        ("thigh_l", "thigh_r"), ("calf_l", "calf_r"), ("foot_l", "foot_r"),
        ("ball_l", "ball_r"), ("toe_l", "toe_r"),
        ("upperarm_l", "upperarm_r"), ("lowerarm_l", "lowerarm_r"),
        ("hand_l", "hand_r"), ("hand_tip_l", "hand_tip_r"),
        ("clavicle_l", "clavicle_r"),
    )
    for a, b in pairs:
        if a not in joints or b not in joints:
            continue
        x = (abs(joints[a][0]) + abs(joints[b][0])) * 0.5
        y = (joints[a][1] + joints[b][1]) * 0.5
        z = (joints[a][2] + joints[b][2]) * 0.5
        joints[a] = [x, y, z]
        joints[b] = [-x, y, z]
    return joints


def joints_from_markers(V, det):
    """Build the skeleton joints from the eight dots. Depth is measured on the mesh."""
    P = _as_cloud(V)
    height, zmin, zmax = bounds(P)
    M = det["markers"]
    neck_z = float(M["chin"][2]) - 0.025 * height
    neck_y = place_torso_depth(P, height, neck_z, 0.05 * height, 0.55)
    if neck_y is None:
        neck_y = float(M["chin"][1])
    # Head pivot: inside the skull at ear / jaw depth — not on the forehead skin.
    head_z = neck_z + 0.055 * height
    head_y = place_torso_depth(P, height, head_z, 0.055 * height, 0.55)
    if head_y is None:
        head_y = neck_y
    top_z = zmax - 0.012 * height
    top_y = place_torso_depth(P, height, top_z, 0.045 * height, 0.50)
    if top_y is None:
        top_y = head_y
    groin_z = float(M["groin"][2])
    hip_z = groin_z + 0.04 * height
    widest = -1.0
    for z in np.linspace(groin_z + 0.01 * height, groin_z + 0.12 * height, 16):
        sl = _band(P, z, 0.01 * height)
        sl = sl[np.abs(sl[:, 0]) < 0.2 * height]
        if len(sl) < 20:
            continue
        width = float(np.percentile(np.abs(sl[:, 0]), 90))
        if width > widest:
            widest = width
            hip_z = float(z)
    pelvis_z = hip_z + 0.015 * height
    # Pelvic core — not the butt surface and not hair behind the hips.
    hip_y = place_torso_depth(P, height, hip_z, 0.09 * height, 0.48)
    if hip_y is None:
        hip_y = float(M["groin"][1])
    hip_sl = _band(P, hip_z, 0.02 * height)
    hip_sl = hip_sl[np.abs(hip_sl[:, 0]) < 0.16 * height]
    hip_x = float(np.percentile(np.abs(hip_sl[:, 0]), 70)) if len(hip_sl) > 20 else 0.09 * height
    hip_x = max(hip_x, 0.06 * height)

    joints = {
        "neck": [0.0, float(neck_y), float(neck_z)],
        "head": [0.0, float(head_y), float(head_z)],
        "head_top": [0.0, float(top_y), float(top_z)],
        "pelvis": [0.0, float(hip_y), float(pelvis_z)],
    }
    arm_z = _arm_height(P, height, zmin, zmax)
    for side, name in ((1.0, "l"), (-1.0, "r")):
        tip = _tip(P, height, side, arm_z)
        shoulder_x = _armpit(P, height, side, arm_z, tip)
        arm = _arm_point(P, height, side, shoulder_x, arm_z, min_x=shoulder_x * 0.92)
        elbow = M[f"elbow_{name}"]
        wrist = M[f"wrist_{name}"]
        joints[f"upperarm_{name}"] = [float(c) for c in arm]
        joints[f"lowerarm_{name}"] = [float(c) for c in _arm_point(
            P, height, side, abs(elbow[0]), float(elbow[2]), min_x=shoulder_x + 0.02 * height)]
        joints[f"hand_{name}"] = [float(c) for c in _arm_point(
            P, height, side, abs(wrist[0]), float(wrist[2]), min_x=shoulder_x + 0.04 * height)]
        joints[f"hand_tip_{name}"] = [float(c) for c in _arm_point(
            P, height, side, tip - 0.012 * height, arm_z, min_x=shoulder_x + 0.06 * height)]
        joints[f"clavicle_{name}"] = [
            side * 0.045 * height,
            float(neck_y * 0.6 + arm[1] * 0.4),
            float(arm[2] - 0.004 * height),
        ]
        knee = M[f"knee_{name}"]
        joints[f"thigh_{name}"] = [side * hip_x, float(hip_y), float(hip_z)]
        foot = _leg_point(P, height, side, zmin + 0.065 * height)
        if foot is None:
            foot = (side * hip_x, hip_y, zmin + 0.065 * height)
        joints[f"foot_{name}"] = [float(c) for c in foot]
        knee_pt = _leg_point(P, height, side, float(knee[2]))
        if knee_pt is None:
            knee_pt = (float(knee[0]), hip_y, float(knee[2]))
        joints[f"calf_{name}"] = [float(knee[0]), float(knee_pt[1]), float(knee[2])]
        toe_y = place_depth(P, height, zmin + 0.02 * height, 0.16 * height, 0.08)
        if toe_y is None:
            toe_y = foot[1]
        joints[f"ball_{name}"] = [float(foot[0]), float(foot[1] * 0.5 + toe_y * 0.5), float(zmin + 0.025 * height)]
        joints[f"toe_{name}"] = [float(foot[0]), float(toe_y), float(zmin + 0.012 * height)]
    _mirror_pairs(joints)
    _place_spine(P, joints, height)
    return {k: [float(c) for c in v] for k, v in joints.items()}


def _place_spine(V, joints, height):
    pelvis, neck = joints["pelvis"], joints["neck"]
    # bias ≈ fraction from front→back of hair-trimmed torso (chest wants ~65–70%).
    for name, t, xlim, bias in (
        ("spine_01", 0.12, 0.055 * height, 0.55),  # low belly — waist core
        ("spine_02", 0.42, 0.05 * height, 0.62),   # mid belly
        ("spine_03", 0.70, 0.045 * height, 0.68),  # chest — ~60–70% back, past the breast
        ("neck_base", 0.93, 0.04 * height, 0.55),
    ):
        z = pelvis[2] + (neck[2] - pelvis[2]) * t
        y = place_torso_depth(V, height, z, xlim, bias)
        if y is None:
            y = place_torso_depth(V, height, z, xlim * 1.4, bias)
        if y is None:
            y = pelvis[1] + (neck[1] - pelvis[1]) * t
        x = pelvis[0] + (neck[0] - pelvis[0]) * t
        joints[name] = [float(x), float(y), float(z)]


def off_mesh(V, point, height, tol=0.02):
    """True when the point misses the silhouette or floats off the body in depth.

    A joint inside the body passes. A joint whose depth is outside the mesh
    at that column fails, even when the front view still lines up.
    """
    P = _as_cloud(V)
    point = np.asarray(point, dtype=np.float64)
    dxz = np.hypot(P[:, 0] - point[0], P[:, 2] - point[2])
    limit = tol * height
    if float(dxz.min()) > limit:
        return True
    near = P[dxz <= max(limit, 0.05 * height)]
    if len(near) < 8:
        nearest = P[int(np.argmin(dxz))]
        return abs(float(nearest[1] - point[1])) > limit
    lo, hi = float(near[:, 1].min()), float(near[:, 1].max())
    pad = 0.02 * height
    return bool(point[1] < lo - pad or point[1] > hi + pad)


def listed_off(V, det, tol=0.02):
    height = float(det["height"])
    markers = [name for name, point in det.get("markers", {}).items() if off_mesh(V, point, height, tol)]
    joints = det.get("joints") or {}
    bad_joints = [name for name in JOINT_GATE if name in joints and off_mesh(V, joints[name], height, tol)]
    return markers, bad_joints

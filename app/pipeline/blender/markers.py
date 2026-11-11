"""Action Forge style markers on a T-pose mesh (Z up, facing -Y, character left = +X).

detect(V)                 -> auto markers + mesh landmarks
joints_from_markers(V, d) -> skeleton joint centres; the markers drive the joints, so a
                             dragged marker moves the bone it belongs to.
off_body(V, d)            -> names of markers whose front-view (x, z) is not over the mesh.
"""
import numpy as np

MARKERS = ("chin", "groin", "elbow_l", "elbow_r", "wrist_l", "wrist_r", "knee_l", "knee_r")


def _slice(V, axis, val, half):
    return V[np.abs(V[:, axis] - val) < half]


def _mid(a):
    return (a.min() + a.max()) / 2.0


def _landmarks(V):
    zmin, zmax = V[:, 2].min(), V[:, 2].max()
    H = zmax - zmin
    tip = {s: float((V[V[:, 0] * s > 0][:, 0] * s).max()) for s in (1, -1)}
    ext = V[np.abs(V[:, 0]) > 0.85 * min(tip.values())]
    arm_z = float(np.median(ext[:, 2]))
    return float(H), float(zmin), float(zmax), tip, arm_z


def _neck_slice(V, H, neck_z):
    sl = _slice(V, 2, neck_z, 0.004 * H)
    return sl[np.abs(sl[:, 0]) < 0.08 * H]


def _groin_slice(V, H, groin_z):
    return _slice(V, 2, groin_z + 0.02 * H, 0.006 * H)


def _arm_blocks(Vs, H, arm_z, x):
    """Vertical runs of surface in the front-view column at |x|, near arm height."""
    col = Vs[(np.abs(np.abs(Vs[:, 0]) - x) < 0.003 * H)
             & (Vs[:, 2] > arm_z - 0.15 * H) & (Vs[:, 2] < arm_z + 0.10 * H)]
    if not len(col):
        return []
    z = np.sort(col[:, 2])
    cut = np.where(np.diff(z) > 0.01 * H)[0]
    lo = np.r_[0, cut + 1]
    hi = np.r_[cut, len(z) - 1]
    return [(float(z[a]), float(z[b])) for a, b in zip(lo, hi)]


def _arm_section(Vs, H, arm_z, x):
    """(bottom, top) of the arm in the column at |x|; hair above the arm is a separate run."""
    blocks = _arm_blocks(Vs, H, arm_z, x)
    if not blocks:
        return None
    return min(blocks, key=lambda b: abs((b[0] + b[1]) / 2 - arm_z))


def _shoulder(V, H, s, tip, arm_z):
    """Armpit x and the arm's centre height there, from where the torso column ends."""
    Vs = V[V[:, 0] * s > 0]
    outer = [x * H for x in np.arange(0.15, 0.225, 0.01) if x * H < 0.6 * tip[s]]
    secs = [_arm_section(Vs, H, arm_z, x) for x in outer]
    pts = [(x, sec) for x, sec in zip(outer, secs) if sec]
    if len(pts) < 3:
        raise RuntimeError("upper arms not found")
    xs = np.array([p[0] for p in pts])
    bottom = np.array([p[1][0] for p in pts])
    mid = np.array([(p[1][0] + p[1][1]) / 2 for p in pts])
    b_fit, m_fit = np.polyfit(xs, bottom, 1), np.polyfit(xs, mid, 1)

    # The fit samples sit out on the upper arm. A wide chest has its armpit outside the
    # innermost of those samples, so the walk has to continue past them.
    end = max(float(min(xs)) + 0.005 * H, min(0.75 * tip[s], float(max(xs)) + 0.10 * H))
    armpit = None
    for x in np.arange(0.03 * H, end, 0.005 * H):
        under = np.polyval(b_fit, x)
        reach = [b[0] for b in _arm_blocks(Vs, H, arm_z, x) if b[1] > under - 0.03 * H]
        # torso columns run down past the armpit; an arm column bottoms out at the arm's underside
        if reach and min(reach) >= under - 0.015 * H:
            armpit = float(x)
            break
    if armpit is None:
        raise RuntimeError("armpit not found")
    return armpit, float(np.polyval(m_fit, armpit))


def _shoulder_x(V, H, s, tip, arm_z):
    return _shoulder(V, H, s, tip, arm_z)[0] - 0.01 * H


def _upperarm_x(V, H, s, tip, arm_z):
    """Shoulder, where the arm leaves the chest. Stop there, not further down the arm."""
    armpit, sh_z = _shoulder(V, H, s, tip, arm_z)
    Vs = V[V[:, 0] * s > 0]
    limit = min(0.55 * tip[s], armpit + 0.08 * H)
    chosen = float(armpit)
    for x in np.arange(armpit, limit, 0.005 * H):
        sec = _arm_section(Vs, H, arm_z, x)
        if sec and (sec[1] - sec[0]) < 0.065 * H:
            chosen = float(x)
            break
    return chosen, sh_z


def _solid_span(sl, H):
    """Front and back Y of the torso. Hair behind is a thin sheet, so it never counts."""
    y = sl[:, 1].astype(float)
    y0, y1 = float(y.min()), float(y.max())
    if y1 - y0 < 1e-4:
        return y0, y1
    bins = 32
    edges = np.linspace(y0, y1, bins + 1)
    widths = np.zeros(bins)
    min_w = 0.05 * H
    for i in range(bins):
        if i < bins - 1:
            m = (y >= edges[i]) & (y < edges[i + 1])
        else:
            m = (y >= edges[i]) & (y <= edges[i + 1])
        if int(m.sum()) < 8:
            continue
        xs = sl[m, 0]
        widths[i] = float(xs.max() - xs.min())
    solid = widths >= min_w
    best = None
    i = 0
    while i < bins:
        if not solid[i]:
            i += 1
            continue
        j = i + 1
        while j < bins and solid[j]:
            j += 1
        # The back-most wide run is the torso or the skull. The bust and the visor
        # are separate wide runs in front of it.
        if best is None or i >= best[0]:
            best = (i, j)
        i = j
    if best is None:
        return float(np.percentile(y, 30)), float(np.percentile(y, 70))
    return float(edges[best[0]]), float(edges[best[1]])


def _hip_socket(V, H, groin_z):
    """Hip height and half-width. The sockets are the wide pelvis above the groin, not the crotch."""
    best = None
    for z in np.linspace(groin_z + 0.025 * H, groin_z + 0.11 * H, 36):
        sl = _slice(V, 2, z, 0.006 * H)
        sl = sl[(np.abs(sl[:, 0]) > 0.025 * H) & (np.abs(sl[:, 0]) < 0.22 * H)]
        if len(sl) < 40:
            continue
        outer = float(np.percentile(np.abs(sl[:, 0]), 90))
        if best is None or outer > best[0]:
            best = (outer, float(z))
    if best is None:
        return groin_z + 0.06 * H, 0.08 * H
    return best[1], best[0] * 0.70


def _inset_y(V, H, z, xlim, bias):
    """Depth inside the solid body at height z. bias 0 is the front, 1 is the back.

    Long hair sits behind the torso as a thin sheet. Measuring from that sheet
    parks the spine and hips outside the body.
    """
    sl = _slice(V, 2, z, 0.012 * H)
    sl = sl[np.abs(sl[:, 0]) < xlim]
    if len(sl) < 8:
        return None
    front, back = _solid_span(sl, H)
    return float(front + min(1.0, max(0.0, bias)) * (back - front))


def place_spine(V, det):
    """Spine and neck base follow the back between pelvis and neck, not a straight chord."""
    J = det.get("joints") or {}
    if "pelvis" not in J or "neck" not in J:
        return J
    H = float(det["height"])
    pel, nk = J["pelvis"], J["neck"]
    for name, t, xlim, bias in (
        ("spine_01", 0.12, 0.08 * H, 0.62),
        ("spine_02", 0.42, 0.08 * H, 0.72),
        ("spine_03", 0.70, 0.07 * H, 0.70),
        ("neck_base", 0.93, 0.05 * H, 0.64),
    ):
        z = pel[2] + (nk[2] - pel[2]) * t
        y = _inset_y(V, H, z, xlim, bias)
        x = pel[0] + (nk[0] - pel[0]) * t
        if y is None:
            y = pel[1] + (nk[1] - pel[1]) * t
        J[name] = [float(x), float(y), float(z)]
    det["joints"] = J
    return J


def _arm_pt(V, H, s, tip, arm_z, x, z=None):
    Vs = V[V[:, 0] * s > 0]
    sh_x = _shoulder_x(V, H, s, tip, arm_z)
    arm = Vs[(np.abs(Vs[:, 0]) > sh_x) & (np.abs(Vs[:, 2] - arm_z) < 0.12 * H)]
    sl = arm[np.abs(np.abs(arm[:, 0]) - x) < 0.006 * H]
    if z is not None:
        near = sl[np.abs(sl[:, 2] - z) < 0.05 * H]
        sl = near if len(near) >= 3 else sl
    return (s * x, _mid(sl[:, 1]), _mid(sl[:, 2]) if z is None else z)


def _leg_slice(V, H, s, tip, z):
    Vs = V[V[:, 0] * s > 0]
    sl = _slice(Vs, 2, z, 0.005 * H)
    return sl[np.abs(sl[:, 0]) < 0.5 * tip[s]]


def detect(V):
    H, zmin, zmax, tip, arm_z = _landmarks(V)

    best = None
    for z in np.linspace(arm_z + 0.01 * H, min(arm_z + 0.12 * H, zmax - 0.12 * H), 60):
        sl = _slice(V, 2, z, 0.004 * H)
        sl = sl[np.abs(sl[:, 0]) < 0.3 * min(tip.values())]
        if len(sl) < 8:
            continue
        w = sl[:, 0].max() - sl[:, 0].min()
        if best is None or w < best[0]:
            best = (w, z)
    if best is None:
        raise RuntimeError("neck not found above the arms")
    # long/curly hair widens every slice above the shoulders; keep the neck in an anatomical band
    neck_z = float(np.clip(best[1], arm_z + 0.025 * H, arm_z + 0.07 * H))
    neck_sl = _neck_slice(V, H, neck_z)

    groin_z, empties, last_filled = None, 0, None
    for z in np.linspace(zmin + 0.62 * H, zmin + 0.30 * H, 160):
        sl = _slice(V, 2, z, 0.006 * H)
        xs = np.sort(sl[np.abs(sl[:, 0]) < 0.06 * H][:, 0])
        # legs are apart once the front view has a clear gap at the centre line;
        # close-set inner thighs keep a narrow centre strip filled well below the crotch
        g = np.diff(xs)
        gap = len(g) and any(g[i] > 0.004 * H and xs[i] < 0.01 * H and xs[i + 1] > -0.01 * H
                             for i in np.where(g > 0.004 * H)[0])
        if not gap:
            last_filled, empties = z, 0
        else:
            empties += 1
            if empties >= 3 and last_filled is not None:
                groin_z = float(last_filled)
                break
    if groin_z is None:
        raise RuntimeError("groin not found: legs never separate")
    gsl = _groin_slice(V, H, groin_z)
    if len(gsl):
        front, back = _solid_span(gsl, H)
        groin_y = front + 0.45 * (back - front)
    else:
        groin_y = 0.0

    M = {"chin": (0.0, neck_sl[:, 1].min(), neck_z + 0.025 * H),
         "groin": (0.0, groin_y, groin_z)}
    for s, side in ((1, "l"), (-1, "r")):
        sh_x, _sh_z = _upperarm_x(V, H, s, tip, arm_z)
        wrist_x = tip[s] - 0.10 * H
        M[f"wrist_{side}"] = _arm_pt(V, H, s, tip, arm_z, wrist_x)
        M[f"elbow_{side}"] = _arm_pt(V, H, s, tip, arm_z, (sh_x + wrist_x) / 2)
        knee_z = (groin_z + 0.03 * H + zmin + 0.065 * H) / 2 + 0.01 * H
        ksl = _leg_slice(V, H, s, tip, knee_z)
        M[f"knee_{side}"] = (_mid(ksl[:, 0]), ksl[:, 1].min(), knee_z)
    return {"height": H, "zmin": zmin, "markers": {k: [float(c) for c in v] for k, v in M.items()}}


def joints_from_markers(V, det):
    H, zmin, zmax, tip, arm_z = _landmarks(V)
    M = det["markers"]
    neck_z = M["chin"][2] - 0.025 * H
    neck_y = _inset_y(V, H, neck_z, 0.045 * H, 0.72)
    if neck_y is None:
        neck_sl = _neck_slice(V, H, neck_z)
        neck_y = _mid(neck_sl[:, 1]) if len(neck_sl) else float(np.median(V[:, 1]))
    head_z = neck_z + 0.055 * H
    head_y = _inset_y(V, H, head_z, 0.05 * H, 0.55)
    if head_y is None:
        head_y = neck_y
    top_z = zmax - 0.012 * H
    top_y = _inset_y(V, H, top_z, 0.045 * H, 0.50)
    if top_y is None:
        top_y = head_y
    groin_z = M["groin"][2]
    pelvis_z = groin_z + 0.05 * H
    hip_z, hip_x = _hip_socket(V, H, groin_z)
    # One depth for the groin and both hips, so the V lies across the pelvis instead of
    # the groin sticking out on the front of the body.
    hip_y = _inset_y(V, H, hip_z, max(hip_x * 1.4, 0.08 * H), 0.45)
    if hip_y is None:
        hip_y = _inset_y(V, H, pelvis_z, 0.09 * H, 0.48)
    if hip_y is None:
        hip_y = float(M["groin"][1])

    J = {"neck": (0.0, neck_y, neck_z), "head": (0.0, head_y, head_z),
         "head_top": (0.0, top_y, zmax), "pelvis": (0.0, hip_y, pelvis_z)}
    for s, side in ((1, "l"), (-1, "r")):
        Vs = V[V[:, 0] * s > 0]
        sh_x, sh_z = _upperarm_x(V, H, s, tip, arm_z)
        el, wr = M[f"elbow_{side}"], M[f"wrist_{side}"]
        arm = _arm_pt(V, H, s, tip, arm_z, sh_x, sh_z)
        J[f"upperarm_{side}"] = arm
        J[f"lowerarm_{side}"] = _arm_pt(V, H, s, tip, arm_z, abs(el[0]), el[2])
        J[f"hand_{side}"] = _arm_pt(V, H, s, tip, arm_z, abs(wr[0]), wr[2])
        J[f"hand_tip_{side}"] = _arm_pt(V, H, s, tip, arm_z, tip[s] - 0.01 * H)
        J[f"clavicle_{side}"] = (s * 0.045 * H, neck_y * 0.65 + arm[1] * 0.35, sh_z - 0.006 * H)

        kn = M[f"knee_{side}"]
        J[f"thigh_{side}"] = (s * hip_x, hip_y, hip_z)
        asl = _leg_slice(V, H, s, tip, zmin + 0.065 * H)
        J[f"foot_{side}"] = (_mid(asl[:, 0]), _mid(asl[:, 1]) if len(asl) else hip_y, zmin + 0.065 * H)
        ksl = _leg_slice(V, H, s, tip, kn[2])
        if len(ksl):
            front, back = float(ksl[:, 1].min()), float(ksl[:, 1].max())
            depth = max(back - front, 1e-4)
            mid = (front + back) / 2
            span = J[f"foot_{side}"][2] - J[f"thigh_{side}"][2]
            t = (kn[2] - J[f"thigh_{side}"][2]) / span if abs(span) > 1e-4 else 0.5
            line = J[f"thigh_{side}"][1] + t * (J[f"foot_{side}"][1] - J[f"thigh_{side}"][1])
            y = mid - 0.08 * depth
            if y > line:
                y = line - 0.08 * depth
            y = min(max(y, front + 0.2 * depth), back - 0.2 * depth)
        else:
            y = hip_y
        J[f"calf_{side}"] = (kn[0], y, kn[2])
        foot = Vs[(Vs[:, 2] < zmin + 0.04 * H) & (np.abs(Vs[:, 0]) < 0.5 * tip[s])]
        toe_y = float(foot[:, 1].min()) + 0.012 * H
        ank_y = J[f"foot_{side}"][1]
        J[f"ball_{side}"] = (_mid(foot[:, 0]), ank_y * 0.45 + toe_y * 0.55, zmin + 0.02 * H)
        J[f"toe_{side}"] = (_mid(foot[:, 0]), toe_y, zmin + 0.012 * H)

    # Left and right share one placement. A prop on one side must not pull the other off.
    for a, b in (
        ("thigh_l", "thigh_r"), ("calf_l", "calf_r"), ("foot_l", "foot_r"),
        ("ball_l", "ball_r"), ("toe_l", "toe_r"),
        ("upperarm_l", "upperarm_r"), ("lowerarm_l", "lowerarm_r"), ("hand_l", "hand_r"),
        ("hand_tip_l", "hand_tip_r"), ("clavicle_l", "clavicle_r"),
    ):
        x = (abs(J[a][0]) + abs(J[b][0])) / 2
        y = (J[a][1] + J[b][1]) / 2
        z = (J[a][2] + J[b][2]) / 2
        J[a], J[b] = (x, y, z), (-x, y, z)
    out = {k: [float(c) for c in v] for k, v in J.items()}
    holder = {"height": H, "joints": out}
    place_spine(V, holder)
    return holder["joints"]


def off_body(V, det, tol=0.015):
    """A marker is on the body when mesh exists under it in the front view."""
    H = det["height"]
    P = V[:, [0, 2]]
    bad = []
    for name in MARKERS:
        m = det["markers"].get(name)
        if m is None or np.min(np.hypot(P[:, 0] - m[0], P[:, 1] - m[2])) > tol * H:
            bad.append(name)
    return bad

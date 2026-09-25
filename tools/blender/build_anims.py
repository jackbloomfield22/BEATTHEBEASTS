"""Build every clip, bake it to FK, run the quality gates, export.

    python3 tools/blender/build_anims.py

Outputs:
  public/assets/characters/anims.glb   the armature with one animation per clip
  public/assets/characters/anims.json  per clip: frames, loop, speed, direction,
                                       foot contacts (for stride matching and IK)
  docs/ANIMATION.md                    the gate results (TECH_PLAN §9.1)

Every clip is keyed here (tools/blender/lib/poses.py, gait.py): no
downloaded, captured or third-party motion (CLAUDE.md rule 6). Poses are
solved with IK controls and baked frame by frame to plain FK keys, so the
runtime sees only bone rotations.
"""

from __future__ import annotations

import copy
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib.anim_rig import Controls  # noqa: E402
from lib.skeleton import J  # noqa: E402
from lib.gait import FPS, GAITS, contacts, gait_pose  # noqa: E402
from lib.poses import HEEL_REST, STANCES, Pose, apply_pose  # noqa: E402
from lib.transitions import transitions  # noqa: E402
from lib.actions import NO_BALANCE, action_clips  # noqa: E402
from lib.rig import build_armature  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_GLB = os.path.join(ROOT, "public", "assets", "characters", "anims.glb")
OUT_JSON = os.path.join(ROOT, "public", "assets", "characters", "anims.json")
OUT_DOC = os.path.join(ROOT, "docs", "ANIMATION.md")

# Gate thresholds (TECH_PLAN §9.1).
SLIDE_MAX = 0.005  # m of foot drift on a planted frame
LOOP_MAX = 1.0  # degrees between the last frame and the first of a loop
CLEAR_MIN = 0.07  # m between the ankles (and knees) at every frame
COM_MARGIN = -0.02  # m: centre of mass may sit at most 2 cm outside the support polygon

# Whole-body mechanics gates for the locomotion cycles (M4.5), from the same
# literature the keyer uses (lib/gait.py): trunk lean from vertical (deg,
# mean), pelvis vertical travel (cm, peak to peak), thorax yaw against the
# pelvis (deg, peak to peak), elbow flexion range (deg), shoulder swing (deg,
# peak to peak, thorax frame), knee drive (peak thigh flexion, deg), heel
# recovery (peak knee flexion in swing, deg), foot angle at touch-down (deg,
# + toes up = heel strike, - = forefoot) and, for the sprint, the hand path
# (front hand above the shoulder, back hand behind the pelvis, cm).
MECH_TARGETS = {
    "loco_walk": {"lean": (1, 6), "pelvis_v": (2.0, 6.0), "torso_rot": (8, 40), "knee_drive": (20, 40), "heel_rec": (50, 75), "strike": (10, 25)},
    "loco_jog": {"lean": (5, 10), "pelvis_v": (5.0, 10.0), "torso_rot": (20, 50), "elbow": (65, 115), "shoulder": (50, 90), "knee_drive": (42, 58), "heel_rec": (85, 110), "strike": (2, 12)},
    "loco_run": {"lean": (8, 14), "pelvis_v": (4.0, 9.0), "torso_rot": (25, 55), "elbow": (65, 115), "shoulder": (80, 110), "knee_drive": (58, 75), "heel_rec": (105, 125), "strike": (-8, 4)},
    "loco_sprint": {"lean": (11, 18), "pelvis_v": (3.0, 8.0), "torso_rot": (30, 60), "elbow": (65, 115), "shoulder": (105, 140), "knee_drive": (70, 90), "heel_rec": (118, 140), "strike": (-25, -5), "hand_front": (8, 30), "hand_back": (5, 40)},
    "loco_backpedal": {"lean": (18, 40), "elbow": (65, 115)},
}

# Stances that bear weight on a hand (it joins the support polygon).
HAND_SUPPORT = {"ol_3pt": ["r"], "dl_3pt": ["r"], "dl_4pt": ["l", "r"]}
# Coaching targets for the stances (M4.5; lib/poses.py cites them): hip
# height (m, base 1.88 m rig), back angle (deg above horizontal, pelvis to
# the base of the neck), share of the weight on the down hands, and the
# eyes (deg above horizontal; linemen look up the field, not at the turf).
STANCE_TARGETS = {
    "ol_3pt": {"hip": (0.76, 0.81), "trunk": (-6, 12), "load": (0.15, 0.32), "eyes": (-15, 15)},
    "dl_3pt": {"hip": (0.64, 0.73), "trunk": (-10, 4), "load": (0.35, 0.55), "eyes": (-20, 15)},
    "dl_4pt": {"hip": (0.66, 0.76), "trunk": (-12, 2), "load": (0.40, 0.60), "eyes": (-20, 15)},
    "qb_gun": {"hip": (0.86, 0.94), "trunk": (60, 80), "eyes": (-10, 10)},
    "qb_center": {"eyes": (-15, 10)},
    "wr_2pt": {"eyes": (-15, 10)},
    "lb_ready": {"eyes": (-15, 10)},
    "db_ready": {"eyes": (-15, 10)},
    "rb_2pt": {"eyes": (-15, 10)},
}
STANCE_FRAMES = 60  # 2 s breathing loop


def breathing(base: Pose, frame: int) -> Pose:
    """A settled stance breathes: the chest rises, the shoulders lift a touch."""
    p = copy.deepcopy(base)
    b = math.sin(2 * math.pi * frame / STANCE_FRAMES)
    for bone, amp in (("spine_03", 1.2), ("spine_04", 0.8)):
        f, a, t = p.joints.get(bone, (0, 0, 0))
        p.joints[bone] = (f - amp * b, a, t)
    for s in ("l", "r"):
        f, a, t = p.joints.get(f"clavicle_{s}", (0, 0, 0))
        p.joints[f"clavicle_{s}"] = (f, a + 0.8 * b, t)
    p.pelvis = {**p.pelvis, "up": p.pelvis.get("up", 0.0) + 0.003 * b}
    return p


def clip_list():
    clips = []
    for name, st in STANCES.items():
        clips.append({"name": f"stance_{name}", "kind": "stance", "stance": name, "frames": STANCE_FRAMES, "loop": True, "speed": 0.0, "dir": [0, 0], "pose": (lambda f, st=st: breathing(st, f)), "contacts": {"l": [[0, STANCE_FRAMES]], "r": [[0, STANCE_FRAMES]]}, "balance": name not in NO_BALANCE})
    for name, g in GAITS.items():
        clips.append({"name": f"loco_{name}", "kind": "locomotion", "frames": g.frames, "loop": True, "speed": g.speed, "dir": list(g.dir), "pose": (lambda f, g=g: gait_pose(g, f % g.frames)), "contacts": contacts(g), "travel": (lambda f, g=g: g.speed * f / FPS)})
    for tr in transitions():
        clips.append({"name": tr.name, "kind": "transition", "frames": tr.frames, "loop": False, "speed": 0.0, "dir": [0.0, -1.0], "pose": tr.pose, "contacts": tr.contacts, "travel": tr.travel, "from": tr.frm, "to": tr.to})
    for c in action_clips():
        clip = {"name": c.name, "kind": c.kind, "frames": c.frames, "loop": c.loop, "speed": 0.0, "dir": c.dir if c.kind == "transition" else [0, 0], "pose": c.pose, "contacts": c.contacts, "events": c.events}
        if c.kind == "transition":
            clip.update({"travel": c.travel, "travel_xy": c.travel_xy, "from": c.frm, "to": c.to, "to_phase": c.to_phase})
            if c.turn:
                clip["turn"] = c.turn
            if c.from_phase is not None:
                clip["from_phase"] = c.from_phase
        elif c.kind == "locomotion":
            # Loops keyed outside the gait table (M6: the drive block, the
            # linebacker's shuffle, the official's run): same contract as the gaits.
            clip.update({"speed": c.speed, "dir": c.dir, "travel": c.travel})
        elif c.kind == "signature":
            # Locker-room clips play in place (the root never moves); where the
            # body runs, the ground moves under it like a treadmill, and the
            # slide gate measures against that.
            clip["travel_xy"] = c.travel_xy
        if c.kind == "stance":
            clip["balance"] = c.com
        if c.mask:
            clip["mask"] = c.mask
        clips.append(clip)
    return clips


# Segment mass fractions (Winter, Biomechanics and Motor Control of Human Movement, table 4.1).
SEGMENTS = [
    ("head", "head", 0.081), ("trunk", None, 0.497),
    *[(f"upperarm_{s}", f"upperarm_{s}", 0.028) for s in "lr"], *[(f"forearm_{s}", f"forearm_{s}", 0.016) for s in "lr"],
    *[(f"hand_{s}", f"hand_{s}", 0.006) for s in "lr"], *[(f"thigh_{s}", f"thigh_{s}", 0.100) for s in "lr"],
    *[(f"calf_{s}", f"calf_{s}", 0.0465) for s in "lr"], *[(f"foot_{s}", f"foot_{s}", 0.0145) for s in "lr"],
]


def world(rig, bone, tail=False):
    pb = rig.pose.bones[bone]
    return rig.matrix_world @ (pb.tail if tail else pb.head)


def com(rig) -> Vector:
    total, acc = 0.0, Vector()
    for _, bone, m in SEGMENTS:
        if bone is None:
            p = (world(rig, "pelvis") + world(rig, "neck_01")) / 2
        else:
            p = (world(rig, bone) + world(rig, bone, tail=True)) / 2
        acc += p * m
        total += m
    return acc / total


def _hull(pts):
    pts = sorted(set((round(p[0], 5), round(p[1], 5)) for p in pts))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def inside_margin(pt, hull) -> float:
    """Signed distance from pt to the convex hull's boundary (positive inside)."""
    best = math.inf
    inside = True
    n = len(hull)
    for i in range(n):
        a, b = hull[i], hull[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ex, ey) or 1e-9
        # Counter-clockwise hull: the inside is to the left of each edge.
        d = (ex * (pt[1] - a[1]) - ey * (pt[0] - a[0])) / L
        inside &= d >= 0
        best = min(best, abs(d))
    return best if inside else -best


def support(rig, hands):
    pts = []
    for s in "lr":
        ball = world(rig, f"toe_{s}")
        ankle = world(rig, f"foot_{s}")
        back = (ankle - ball)
        back.z = 0
        heel = ankle + back.normalized() * 0.07
        tip = world(rig, f"toe_{s}", tail=True)  # the toes are part of the base of support
        side = 0.04 * (1 if s == "l" else -1)
        pts += [(ball.x, ball.y), (heel.x, heel.y), (ball.x + side, ball.y), (tip.x, tip.y), (tip.x + side * 0.6, tip.y)]
    for s in hands:
        w = world(rig, f"hand_{s}")
        pts.append((w.x, w.y))
    return _hull(pts)


def contact_point(rig, s):
    """The foot's ground contact: the heel while the toes are up (heel strike),
    otherwise the ball."""
    pb = rig.pose.bones[f"foot_{s}"]
    rest = rig.data.bones[f"foot_{s}"].matrix_local
    heel = rig.matrix_world @ pb.matrix @ rest.inverted() @ HEEL_REST[s]
    ball = world(rig, f"toe_{s}")
    # Toes up: the heel below where it sits on a flat foot (its rest point
    # is 1 cm under the ball's), not merely below the ball.
    if heel.z < ball.z - (Vector(J[f"ball_{s}"]).z - HEEL_REST[s].z) - 0.004:
        # Report where the ball would be with this heel down flat, so the
        # heel-to-ball hand-over is one continuous track.
        v = ball - heel
        v.z = 0
        flat = HEEL_REST[s] - Vector(J[f"ball_{s}"])
        flat.z = 0
        return heel + v.normalized() * flat.length + Vector((0, 0, Vector(J[f"ball_{s}"]).z - HEEL_REST[s].z))
    return ball.copy()


def _yaw(v) -> float:
    return math.degrees(math.atan2(v.x, -v.y))


def _sag(v, fwd, up) -> float:
    """Angle of a limb from straight down, forward positive, in the plane of fwd/up."""
    return math.degrees(math.atan2(v.dot(fwd), -v.dot(up)))


def measure(rig, mech, f, clip):
    fwd, up = Vector((0, -1, 0)), Vector((0, 0, 1))
    pel = rig.pose.bones["pelvis"]
    ph, neck = world(rig, "pelvis"), world(rig, "neck_01")
    mech["lean"].append(math.degrees(math.atan2((neck - ph).dot(fwd), (neck - ph).dot(up))))
    mech["pz"].append(ph.z)
    mech["px"].append(ph.x)
    mech["pyaw"].append(_yaw(pel.matrix.to_3x3().col[2]))
    mech["tyaw"].append(_yaw(rig.pose.bones["spine_04"].matrix.to_3x3().col[2]))
    # Left limbs (the right mirrors half a cycle later).
    sh, el, wr = world(rig, "upperarm_l"), world(rig, "forearm_l"), world(rig, "hand_l")
    ua, fa = (el - sh).normalized(), (wr - el).normalized()
    mech["elbow"].append(math.degrees(ua.angle(fa)))
    t = rig.pose.bones["spine_04"].matrix.to_3x3()
    mech["shoulder"].append(_sag(el - sh, t.col[2].normalized(), t.col[1].normalized()))
    hp, kn, an = world(rig, "thigh_l"), world(rig, "calf_l"), world(rig, "foot_l")
    mech["thigh"].append(_sag(kn - hp, fwd, up))
    mech["knee"].append(math.degrees((kn - hp).normalized().angle((an - kn).normalized())))
    hand = (world(rig, "hand_l") + world(rig, "hand_l", tail=True)) / 2
    mech["hand_up"].append((hand.z - sh.z) * 100)
    mech["hand_back"].append((hand - ph).dot(-fwd) * 100)
    # Foot angle at the left touch-down (frame 0): toes up (+) or down (-) against flat.
    if f == 0:
        ball, ankle = world(rig, "toe_l"), world(rig, "foot_l")
        v = ball - ankle
        rest = Vector(J["ball_l"]) - Vector(J["ankle_l"])
        pitch = math.degrees(math.atan2(v.z, math.hypot(v.x, v.y))) - math.degrees(math.atan2(rest.z, math.hypot(rest.x, rest.y)))
        mech["strike"].append(pitch)


def measure_stance(rig, stance, cm) -> dict:
    hip = (world(rig, "thigh_l") + world(rig, "thigh_r")) / 2
    neck = world(rig, "neck_01")
    v = neck - world(rig, "pelvis")
    out = {"hip": hip.z, "trunk": math.degrees(math.atan2(v.z, math.hypot(v.x, v.y)))}
    face = rig.pose.bones["head"].matrix.to_3x3().col[2]
    out["eyes"] = math.degrees(math.atan2(face.z, math.hypot(face.x, face.y)))
    hands = HAND_SUPPORT.get(stance, [])
    if hands:
        feet = (world(rig, "toe_l") + world(rig, "toe_r") + world(rig, "foot_l") + world(rig, "foot_r")) / 4
        hand = sum((world(rig, f"hand_{s}") for s in hands), Vector()) / len(hands)
        a, b = Vector((feet.x, feet.y)), Vector((hand.x, hand.y))
        out["load"] = (Vector((cm.x, cm.y)) - a).dot(b - a) / (b - a).length_squared
    return out


def stance_gates(clip, m) -> dict:
    tgt = STANCE_TARGETS.get(clip.get("stance"))
    if not m:
        return {}
    out = {"stance": {k: round(v, 2) for k, v in m.items()}}
    if tgt:
        fails = [k for k, (lo, hi) in tgt.items() if k in m and not lo <= m[k] <= hi]
        if fails:
            out["mech_fail"] = fails
    return out


def mech_gates(clip, mech) -> dict:
    tgt = MECH_TARGETS.get(clip["name"])
    if not tgt:
        return {}
    ptp = lambda xs: max(xs) - min(xs)  # noqa: E731
    rel = [a - b for a, b in zip(mech["tyaw"], mech["pyaw"])]
    m = {
        "lean": sum(mech["lean"]) / len(mech["lean"]),
        "pelvis_v": ptp(mech["pz"]) * 100,
        "pelvis_x": ptp(mech["px"]) * 100,
        "pelvis_rot": ptp(mech["pyaw"]),
        "torso_rot": ptp(rel),
        "elbow_min": min(mech["elbow"]),
        "elbow_max": max(mech["elbow"]),
        "shoulder": ptp(mech["shoulder"]),
        "knee_drive": max(mech["thigh"]),
        "heel_rec": max(mech["knee"]),
        "strike": mech["strike"][0] if mech["strike"] else 0.0,
        "hand_front": max(mech["hand_up"]),
        "hand_back": max(mech["hand_back"]),
    }
    fails = []
    for k, (lo, hi) in tgt.items():
        if k == "elbow":
            if m["elbow_min"] < lo or m["elbow_max"] > hi:
                fails.append(k)
        elif not lo <= m[k] <= hi:
            fails.append(k)
    out = {"mech": {k: round(v, 1) for k, v in m.items()}}
    if fails:
        out["mech_fail"] = fails
    return out


def bake(rig, c, clip):
    """Pose every frame with IK live, record each bone's resulting local
    transform, gate it, and write an FK-only action."""
    frames = clip["frames"]
    samples = []
    ball_track = {"l": [], "r": []}
    clearance = math.inf
    com_margin = math.inf
    reach = 0.0  # worst distance between an IK target and where the limb got to
    stance_metrics = {}
    mech = {k: [] for k in ("lean", "pz", "px", "pyaw", "tyaw", "elbow", "shoulder", "thigh", "knee", "hand_up", "hand_back", "strike")}
    for f in range(frames + 1):
        apply_pose(rig, c, clip["pose"](f))
        bpy.context.view_layer.update()
        local = {}
        for pb in rig.pose.bones:
            m = rig.convert_space(pose_bone=pb, matrix=pb.matrix, from_space="POSE", to_space="LOCAL")
            local[pb.name] = m.decompose()
        samples.append(local)
        if f < frames:
            for s in "lr":
                ball_track[s].append(contact_point(rig, s))
            if clip["kind"] == "locomotion":
                measure(rig, mech, f, clip)
            for s in "lr":
                reach = max(reach, (world(rig, f"foot_{s}") - c.foot[s].location).length)
            clearance = min(clearance, (world(rig, "foot_l") - world(rig, "foot_r")).length, (world(rig, "calf_l") - world(rig, "calf_r")).length)
            if clip["kind"] == "stance" and clip.get("balance", True):
                cm = com(rig)
                com_margin = min(com_margin, inside_margin((cm.x, cm.y), support(rig, HAND_SUPPORT.get(clip.get("stance"), []))))
                if f == 0:
                    stance_metrics = measure_stance(rig, clip.get("stance"), cm)

    # Foot slide: while planted, a foot's ball plus the distance the body
    # travels should stay put (in-place clips: the ground moves under us).
    dx, dy = clip["dir"]
    heading = Vector((dx, dy, 0))
    travel = clip.get("travel") or (lambda f: 0.0)
    # Clips that travel in 2D (a juke's cut) give the whole displacement.
    offset = (lambda f: Vector((*clip["travel_xy"](f), 0.0))) if "travel_xy" in clip else (lambda f: heading * travel(f))
    slide = 0.0
    for s in "lr":
        for a, b in clip["contacts"][s]:
            end = b if b > a else b + frames  # a contact can wrap past the loop point
            span = range(a, min(end, frames if not clip["loop"] else end))
            if not span:
                continue
            pts = [ball_track[s][f % frames] + offset(f) for f in span]
            mean = sum(pts, Vector()) / len(pts)
            slide = max(slide, max((p - mean).length for p in pts))
    # Loop continuity: frame N against frame 0.
    loop_err = 0.0
    if clip["loop"]:
        for name, (_, q0, _) in samples[0].items():
            q1 = samples[frames][name][1]
            loop_err = max(loop_err, math.degrees(q0.rotation_difference(q1).angle))

    # Write the FK action (constraints muted so the keys are the whole story).
    mutes = []
    for pb in rig.pose.bones:
        for con in pb.constraints:
            mutes.append((con, con.mute))
            con.mute = True
    act = bpy.data.actions.new(clip["name"])
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    prev = {}
    # Loops key their first frame again at the end; transitions key their
    # last pose so they land exactly on the clip they hand over to.
    last = frames
    for f in range(last + 1):
        src = samples[0] if (clip["loop"] and f == frames) else samples[f]
        for pb in rig.pose.bones:
            loc, q, sc = src[pb.name]
            if pb.name in prev and prev[pb.name].dot(q) < 0:
                q = -q  # keep quaternions on one hemisphere (no flips when interpolating)
            prev[pb.name] = q
            pb.rotation_mode = "QUATERNION"
            pb.location = loc
            pb.rotation_quaternion = q
            pb.scale = sc
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("rotation_quaternion", frame=f)
    rig.animation_data.action = None
    for con, m in mutes:
        con.mute = m
    gates = {
        **mech_gates(clip, mech),
        **stance_gates(clip, stance_metrics),
        "slide_cm": round(slide * 100, 2),
        "loop_deg": round(loop_err, 2),
        "clear_cm": round(clearance * 100, 1),
        "com_cm": None if com_margin == math.inf else round(com_margin * 100, 1),
        "reach_cm": round(reach * 100, 2),
    }
    gates["pass"] = (
        gates["slide_cm"] <= SLIDE_MAX * 100
        and gates["loop_deg"] <= LOOP_MAX
        and gates["clear_cm"] >= CLEAR_MIN * 100
        and (gates["com_cm"] is None or gates["com_cm"] >= COM_MARGIN * 100)
        and not gates.get("mech_fail")
    )
    return act, gates


def write_doc(results):
    lines = [
        "# Animation clips and quality gates",
        "",
        "Generated by `tools/blender/build_anims.py`; do not edit by hand. Every clip is keyed in-house (poses and the gait keyer in `tools/blender/lib`), solved with IK and baked to FK.",
        "",
        f"Gates (TECH_PLAN §9.1): foot slide on planted frames ≤ {SLIDE_MAX * 100:.1f} cm; loop continuity ≤ {LOOP_MAX:.0f}°; ankles and knees ≥ {CLEAR_MIN * 100:.0f} cm apart on every frame; for stances, the centre of mass (Winter's segment masses) inside the support polygon of the planted feet and down hands, allowing {abs(COM_MARGIN) * 100:.0f} cm.",
        "",
        "| Clip | Kind | Frames | Speed (m/s) | Foot slide (cm) | Loop (°) | Clearance (cm) | CoM margin (cm) | Result |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        g = r["gates"]
        com_s = "—" if g["com_cm"] is None else f"{g['com_cm']:.1f}"
        lines.append(f"| `{r['name']}` | {r['kind']} | {r['frames']} | {r['speed']:.1f} | {g['slide_cm']:.2f} | {g['loop_deg']:.2f} | {g['clear_cm']:.1f} | {com_s} | {'pass' if g['pass'] else '**FAIL**'} |")
    passed = sum(r["gates"]["pass"] for r in results)
    lines += ["", f"**{passed} of {len(results)} clips pass.**", ""]
    with open(OUT_DOC, "w") as f:
        f.write("\n".join(lines))


def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    rig = build_armature("rig")
    c = Controls(rig)
    results = []
    meta = {"fps": FPS, "clips": {}}
    for clip in clip_list():
        act, gates = bake(rig, c, clip)
        results.append({"name": clip["name"], "kind": clip["kind"], "frames": clip["frames"], "speed": clip["speed"], "gates": gates})
        meta["clips"][clip["name"]] = {
            "kind": clip["kind"],
            "frames": clip["frames"],
            "duration": clip["frames"] / FPS,
            "loop": clip["loop"],
            "speed": clip["speed"],
            # Travel direction in the game's frame (glTF: +Z forward, +X left).
            "dir": [clip["dir"][0], -clip["dir"][1]],
            "contacts": clip["contacts"],
            "gates": gates,
        }
        if clip["kind"] == "transition":
            # Root motion: meters travelled along `dir` by each frame (the
            # clip itself plays in place), and the clips it joins.
            meta["clips"][clip["name"]].update({"travel": [round(clip["travel"](f), 4) for f in range(clip["frames"] + 1)], "from": clip["from"], "to": clip["to"]})
            if clip.get("to_phase"):
                # Where in the gait's cycle the clip hands over (0 = left touch-down).
                meta["clips"][clip["name"]]["toPhase"] = clip["to_phase"]
            if "travel_xy" in clip and clip["dir"][0] == 0:
                # Sideways travel (glTF +X left), for moves that cut.
                side = [round(clip["travel_xy"](f)[0], 4) for f in range(clip["frames"] + 1)]
                if any(abs(x) > 1e-4 for x in side):
                    meta["clips"][clip["name"]]["side"] = side
            if clip.get("turn"):
                # The body ends turned this far (deg, + left): the runtime turns
                # the heading by it when it hands over to `to`.
                meta["clips"][clip["name"]]["turn"] = clip["turn"]
            if clip.get("from_phase") is not None:
                # Out of a gait: the phase of it the clip starts at (0 = left touch-down).
                meta["clips"][clip["name"]]["fromPhase"] = clip["from_phase"]
        if clip.get("events"):
            # Frames where the sim's moments land (the ball leaves the hand, a catch is secured).
            meta["clips"][clip["name"]]["events"] = clip["events"]
        if clip.get("mask"):
            # Overlays: the bones they drive (the runtime lays them over the base motion).
            meta["clips"][clip["name"]]["mask"] = clip["mask"]
        print(f"{clip['name']:20s} {gates}")

    # Export the armature and the clips (the mesh lives in player.glb).
    for o in list(bpy.data.objects):
        if o is not rig:
            bpy.data.objects.remove(o, do_unlink=True)
    for pb in rig.pose.bones:
        for con in list(pb.constraints):
            pb.constraints.remove(con)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_anim_single_armature=True,
        export_reset_pose_bones=True,
        export_optimize_animation_size=True,
        export_def_bones=False,
        export_yup=True,
    )
    meta["bytes"] = os.path.getsize(OUT_GLB)
    with open(OUT_JSON, "w") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")
    write_doc(results)
    print(f"{sum(r['gates']['pass'] for r in results)}/{len(results)} pass, {meta['bytes']} bytes, {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()

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
from lib.gait import FPS, GAITS, contacts, gait_pose  # noqa: E402
from lib.poses import STANCES, Pose, apply_pose  # noqa: E402
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

# Stances that bear weight on a hand (it joins the support polygon).
HAND_SUPPORT = {"ol_3pt": ["r"], "dl_4pt": ["l", "r"]}
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
        clips.append({"name": f"stance_{name}", "kind": "stance", "stance": name, "frames": STANCE_FRAMES, "loop": True, "speed": 0.0, "dir": [0, 0], "pose": (lambda f, st=st: breathing(st, f)), "contacts": {"l": [[0, STANCE_FRAMES]], "r": [[0, STANCE_FRAMES]]}})
    for name, g in GAITS.items():
        clips.append({"name": f"loco_{name}", "kind": "locomotion", "frames": g.frames, "loop": True, "speed": g.speed, "dir": list(g.dir), "pose": (lambda f, g=g: gait_pose(g, f % g.frames)), "contacts": contacts(g)})
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


def bake(rig, c, clip):
    """Pose every frame with IK live, record each bone's resulting local
    transform, gate it, and write an FK-only action."""
    frames = clip["frames"]
    samples = []
    ball_track = {"l": [], "r": []}
    clearance = math.inf
    com_margin = math.inf
    reach = 0.0  # worst distance between an IK target and where the limb got to
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
                ball_track[s].append(world(rig, f"toe_{s}").copy())
            for s in "lr":
                reach = max(reach, (world(rig, f"foot_{s}") - c.foot[s].location).length)
            clearance = min(clearance, (world(rig, "foot_l") - world(rig, "foot_r")).length, (world(rig, "calf_l") - world(rig, "calf_r")).length)
            if clip["kind"] == "stance":
                cm = com(rig)
                com_margin = min(com_margin, inside_margin((cm.x, cm.y), support(rig, HAND_SUPPORT.get(clip.get("stance"), []))))

    # Foot slide: while planted, a foot's ball plus the distance the body
    # travels should stay put (in-place clips: the ground moves under us).
    dx, dy = clip["dir"]
    step = Vector((dx, dy, 0)) * clip["speed"] / FPS
    slide = 0.0
    for s in "lr":
        for a, b in clip["contacts"][s]:
            end = b if b > a else b + frames  # a contact can wrap past the loop point
            span = range(a, end)
            pts = [ball_track[s][f % frames] + step * f for f in span]
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
    last = frames if clip["loop"] else frames - 1
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
        "slide_cm": round(slide * 100, 2),
        "loop_deg": round(loop_err, 2),
        "clear_cm": round(clearance * 100, 1),
        "com_cm": None if com_margin == math.inf else round(com_margin * 100, 1),
        "reach_cm": round(reach * 100, 2),
    }
    gates["pass"] = gates["slide_cm"] <= SLIDE_MAX * 100 and gates["loop_deg"] <= LOOP_MAX and gates["clear_cm"] >= CLEAR_MIN * 100 and (gates["com_cm"] is None or gates["com_cm"] >= COM_MARGIN * 100)
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

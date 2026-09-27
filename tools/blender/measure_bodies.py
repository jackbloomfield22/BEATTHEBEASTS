"""Measure the shipped player model per body type (M6.5 #12): how wide and
deep the body is, and how far the arms reach, against the sim's collision
circle (src/sim/effects.ts: radius 0.36 + (weight - 200) * 0.0008 yd).

    python3 tools/blender/measure_bodies.py [out.json]

The shipped mesh (public/assets/characters/player.glb, LOD 0) is bound to a
fresh rig and posed with the same keyed clips the build exports. Each body
type is shaped as the runtime shapes it (src/render/players/bodyShape.ts and
variety.ts with the seeded spread at 0): uniform scale by height, the
heavy / lean / belly frame shapes from BMI, the position's pads, neck,
waist, calves and arms shapes, and the shoulder-width bone offset.

Linear blend skinning is linear in the rest position, so each frame is
evaluated once for the basis and once per shape key, and every body type is
the basis plus its weighted shape deltas (exact, and 9 evaluations a frame
instead of one per body type).

Frame: Blender, the character faces -Y, his left is +X, Z up, the root on
the ground between the feet at the origin. All lengths in metres.
"""

from __future__ import annotations

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib.anim_rig import Controls  # noqa: E402
from lib.gait import GAITS, gait_pose  # noqa: E402
from lib.poses import apply_pose  # noqa: E402
from lib.preview import PLAYER  # noqa: E402
from lib.rig import build_armature  # noqa: E402
from lib.actions import action_clips  # noqa: E402

YD = 0.9144
LB = 0.45359237
BASE_H = 1.88
BASE_BMI = 98 / (BASE_H * BASE_H)

# Body types: the roster's median height and weight by position
# (data/ratings/ratings.v1.json, heightIn / weightLb / weightEq medians),
# plus the small fast receiver (Tyreek Hill, 5'10" 185) and the big tackle.
BODIES = [
    # name, render position, height in, weight lb, era-equivalent weight lb (the sim's)
    ("WR small", "WR", 70, 185, 190),
    ("CB", "CB", 72, 193, 199),
    ("WR", "WR", 72, 195, 200),
    ("S", "S", 73, 200, 207),
    ("RB", "RB", 71, 215, 216),
    ("QB", "QB", 75, 215, 223),
    ("LB", "LB", 74, 235, 239),
    ("TE", "TE", 76, 250, 252),
    ("DE", "DL", 77, 262, 269),
    ("DT", "DL", 76, 292, 306),
    ("OL", "OL", 76, 300, 314),
    ("OL big", "OL", 78, 340, 345),
]

SHAPES = ["heavy", "lean", "belly", "pads", "neck", "waist", "calves", "arms"]
LINE = {"OL", "DL"}
SKILL = {"WR", "CB", "S"}


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def body_weights(pos: str, h_in: float, w_lb: float) -> tuple[float, dict, float]:
    """(scale, shape weights, shoulder offset m): bodyShape.ts + variety.ts at n = 0."""
    hm, kg = h_in * 0.0254, w_lb * LB
    bmi = kg / (hm * hm)
    line = pos in LINE
    w = {
        "lean": clamp((BASE_BMI - bmi) / (BASE_BMI - 23), 0, 1),
        "heavy": clamp((bmi - BASE_BMI) / (36 - BASE_BMI), 0, 1),
        "belly": clamp((bmi - 32) / (41 - 32), 0, 1),
        "pads": 1 if line else 0.45 if pos in ("LB", "TE") else 0.15 if pos == "RB" else -0.3 if pos in ("QB", "K") else -0.8,
        "neck": 0.9 if line else 0.6 if pos in ("LB", "TE") else 0.4 if pos in ("RB", "S") else 0.1,
        "arms": 0.7 if line else 0.55 if pos in ("LB", "TE", "RB") else 0.2,
        "calves": 0.8 if pos == "RB" else 0.55 if line or pos == "LB" else 0.35,
        "waist": clamp((bmi - 29) / 8, -1, 1),
    }
    shoulder = 0.012 if line else 0.007 if pos in ("LB", "TE") else -0.004 if pos in SKILL else 0.002
    return hm / BASE_H, w, shoulder


def import_mesh(rig):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=PLAYER)
    new = [o for o in bpy.data.objects if o not in before]
    mesh = next(o for o in new if o.type == "MESH" and o.name.startswith("player_lod0"))
    for o in new:
        if o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    mesh.parent = None
    mesh.matrix_world.identity()
    for m in list(mesh.modifiers):
        mesh.modifiers.remove(m)
    am = mesh.modifiers.new("rig", "ARMATURE")
    am.object = rig
    mesh.parent = rig
    for kb in mesh.data.shape_keys.key_blocks:
        kb.slider_min = -2.0
        kb.value = 0.0
    return mesh


def vertex_parts(mesh) -> np.ndarray:
    me = mesh.data
    uv = me.uv_layers[0].data
    part = np.zeros(len(me.vertices), dtype=np.int32)
    for loop in me.loops:
        part[loop.vertex_index] = int(uv[loop.index].uv.x * 16)
    return part


def arm_weights(mesh) -> dict:
    """Per side, each vertex's summed weight on the arm chain (what the shoulder offset moves)."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    out = {s: np.zeros(len(mesh.data.vertices)) for s in ("l", "r")}
    chain = ("upperarm", "forearm", "hand", "thumb", "index", "fingers")
    for v in mesh.data.vertices:
        for g in v.groups:
            n = names[g.group]
            if n.startswith(chain) and n[-2:] in ("_l", "_r"):
                out[n[-1]][v.index] += g.weight
    return out


def evaluate(mesh) -> np.ndarray:
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    return co.reshape(-1, 3)


def frame_sets(mesh, rig) -> tuple[np.ndarray, dict]:
    """The basis and one delta per shape key at the current pose, plus the clavicle axes."""
    kbs = mesh.data.shape_keys.key_blocks
    for kb in kbs:
        kb.value = 0.0
    bpy.context.view_layer.update()
    base = evaluate(mesh)
    deltas = {}
    for n in SHAPES:
        kbs[n].value = 1.0
        bpy.context.view_layer.update()
        deltas[n] = evaluate(mesh) - base
        kbs[n].value = 0.0
    clav = {}
    for s in ("l", "r"):
        m = rig.pose.bones[f"clavicle_{s}"].matrix
        clav[s] = np.array([m.col[1][0], m.col[1][1], m.col[1][2]])
    return base, {"deltas": deltas, "clav": clav}


def shaped(base, extra, arms, body) -> np.ndarray:
    _, pos, h, w, _ = body
    s, wts, shoulder = body_weights(pos, h, w)
    co = base.copy()
    for n, k in wts.items():
        if k:
            co += extra["deltas"][n] * k
    for side in ("l", "r"):
        co += np.outer(arms[side], extra["clav"][side] * shoulder)
    return co * s


def metrics(co: np.ndarray, part: np.ndarray, s: float) -> dict:
    """Horizontal extents about the root (x left, -y forward), the upper body only (above the belt)."""
    up = co[:, 2] > 0.95 * s
    jersey = (part == 4) | (part == 14)
    pads = jersey & (co[:, 2] > 1.30 * s)
    trunk = jersey & (co[:, 2] > 1.0 * s) & (co[:, 2] < 1.50 * s)
    r = np.hypot(co[:, 0], co[:, 1])

    def mx(a):
        return float(np.max(a)) if a.size else 0.0

    return {
        "pad_hw": float(np.max(np.abs(co[pads, 0]))) if pads.any() else 0.0,
        "front": mx(-co[trunk, 1]),
        "back": mx(co[trunk, 1]),
        "lat": mx(np.abs(co[up, 0])),
        "fwd": mx(-co[up, 1]),
        "rad": mx(r[up]),
        # The trunk's own footprint: the largest horizontal distance of the jersey from the root.
        "trunk_rad": mx(r[trunk | pads]),
    }


# Sweep ranges by position (the roster's min..max height and weight,
# ratings.v1.json) for the half-width fit.
SWEEP = {
    "WR": ((67, 80), (153, 270)), "CB": ((68, 76), (170, 219)), "S": ((68, 76), (180, 232)),
    "RB": ((66, 77), (169, 266)), "QB": ((70, 80), (176, 265)), "LB": ((69, 79), (215, 272)),
    "TE": ((67, 80), (173, 288)), "DL": ((72, 81), (224, 350)), "OL": ((71, 81), (225, 380)),
}


def sweep(base, extra, arms, part) -> dict:
    """Shoulder half-width over each position's height and weight range at the
    idle pose, and a least-squares fit hw = a + b (w - 200) + c (h - 74) per
    position (w lb, h in, hw m)."""
    fits = {}
    for pos, ((h0, h1), (w0, w1)) in SWEEP.items():
        rows = []
        for h in np.linspace(h0, h1, 5):
            for w in np.linspace(w0, w1, 7):
                body = ("", pos, float(h), float(w), float(w))
                s = body_weights(pos, h, w)[0]
                m = metrics(shaped(base, extra, arms, body), part, s)
                rows.append((w, h, m["pad_hw"], (m["front"] + m["back"]) / 2))
        A = np.array([[1.0, w - 200, h - 74] for w, h, _, _ in rows])
        y = np.array([r[2] for r in rows])
        coef, *_ = np.linalg.lstsq(A, y, rcond=None)
        err = float(np.max(np.abs(A @ coef - y)))
        yd = np.array([r[3] for r in rows])
        cd, *_ = np.linalg.lstsq(A, yd, rcond=None)
        fits[pos] = {"hw": [float(x) for x in coef], "hwMaxErr": err, "halfDepth": [float(x) for x in cd], "hdMaxErr": float(np.max(np.abs(A @ cd - yd)))}
        print(f"fit {pos}: hw = {coef[0]:.4f} + {coef[1]:.6f} (w-200) + {coef[2]:.5f} (h-74)  max err {err * 100:.1f} cm | half-depth {cd[0]:.4f} + {cd[1]:.6f} (w-200) + {cd[2]:.5f} (h-74)")
    return fits


def main() -> None:
    out_path = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else (sys.argv[1] if len(sys.argv) > 1 else None)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    mesh = import_mesh(rig)
    c = Controls(rig)
    part = vertex_parts(mesh)
    arms = arm_weights(mesh)
    clips = {cl.name: cl for cl in action_clips()}
    from lib.transitions import transitions

    clips.update({t.name: t for t in transitions()})

    def poses_of(name):
        if name in GAITS:
            g = GAITS[name]
            return [(f, gait_pose(g, f)) for f in range(g.frames)]
        cl = clips[name]
        return [(f, cl.pose(f)) for f in range(0, cl.frames + 1)]

    groups = {
        "idle": ["stance_idle"],
        "run": ["run", "sprint"],
        "catch": ["catch_hands_run", "catch_hands_run_low", "catch_high_point", "catch_body", "catch_over_shoulder_l", "catch_one_hand_l", "catch_toe_tap_l", "catch_dive_l"],
        "cut": ["cut_plant_l", "cut_plant_sharp_l"],
    }
    from lib.actions import STANCES  # noqa: F401  (stances live in poses.STANCES)
    from lib.poses import STANCES as ST

    res = {b[0]: {} for b in BODIES}
    per_clip = {b[0]: {} for b in BODIES}
    for grp, names in groups.items():
        for name in names:
            if grp == "idle":
                seq = [(0, ST["idle"])]
            else:
                try:
                    seq = poses_of(name.replace("loco_", ""))
                except KeyError:
                    print("missing clip", name)
                    continue
            for f, pose in seq:
                apply_pose(rig, c, pose)
                bpy.context.view_layer.update()
                base, extra = frame_sets(mesh, rig)
                if grp == "idle":
                    fit = sweep(base, extra, arms, part)
                for body in BODIES:
                    s = body_weights(body[1], body[2], body[3])[0]
                    m = metrics(shaped(base, extra, arms, body), part, s)
                    agg = res[body[0]].setdefault(grp, {k: 0.0 for k in m})
                    for k, v in m.items():
                        agg[k] = max(agg[k], v)
                    pc = per_clip[body[0]].setdefault(name, {"frame": {}, **{k: 0.0 for k in m}})
                    for k, v in m.items():
                        if v > pc[k]:
                            pc[k] = v
                            pc["frame"][k] = f
            print("measured", name, flush=True)
    table = []
    for body in BODIES:
        name, pos, h, w, weq = body
        r_yd = 0.36 + (weq - 200) * 0.0008
        table.append({"body": name, "pos": pos, "heightIn": h, "weightLb": w, "weightEq": weq, "simRadiusM": r_yd * YD, **{g: res[name].get(g) for g in groups}, "clips": per_clip[name]})
    txt = json.dumps({"bodies": table, "fit": fit}, indent=1)
    if out_path:
        with open(out_path, "w") as fh:
            fh.write(txt)
    for row in table:
        i, rn, ca, cu = row["idle"], row["run"], row["catch"], row["cut"]
        print(f"{row['body']:9s} run front {rn['front']:.3f} back {rn['back']:.3f} | catch lat {ca['lat']:.3f}")
        print(f"{row['body']:9s} r_sim {row['simRadiusM']:.3f}  pad_hw {i['pad_hw']:.3f} front {i['front']:.3f} back {i['back']:.3f} | run lat {rn['lat']:.3f} fwd {rn['fwd']:.3f} rad {rn['rad']:.3f} trunk {rn['trunk_rad']:.3f} | catch lat {ca['lat']:.3f} fwd {ca['fwd']:.3f} rad {ca['rad']:.3f} | cut rad {cu['rad']:.3f}")


if __name__ == "__main__":
    main()

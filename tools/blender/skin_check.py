"""Skinning at speed (M6.5 #12): how the shipped mesh deforms through the
fast clips, per joint region and per LOD.

    python3 tools/blender/skin_check.py [--lods 0,1,2] [--clips a,b] [--json out.json]

The shipped player.glb meshes are bound to a fresh rig and posed with the
keyed clips (as the build bakes them; three skins with linear blend
skinning, as Blender's armature modifier does with preserve-volume off).
Per frame, for the faces of each joint region:
  - squash: the smallest face-area ratio (deformed / rest), a fold
    collapsing (candy-wrapper at a twist, the back of a bent knee);
  - flips: faces whose normal turned more than 120 degrees from the
    normal their own bones would give them (rigidly carried), i.e. skin
    folded through itself;
  - stretch: the largest edge-length ratio.
It prints the worst frame per clip and region. The build gate
(build_character.py, `skin_gate`) runs the same measure on the run, sprint,
cut and dive clips.
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
from lib.skin import REGIONS, SkinProbe  # noqa: E402

DEFAULT_CLIPS = ["sprint", "run", "carry_sprint", "cut_plant_l", "cut_plant_sharp_l", "dive", "catch_dive_l", "hurdle", "catch_high_point"]


def import_lods(rig, lods):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=PLAYER)
    new = [o for o in bpy.data.objects if o not in before]
    keep = {}
    for i in lods:
        keep[i] = next(o for o in new if o.type == "MESH" and o.name.startswith(f"player_lod{i}"))
    for o in new:
        if o not in keep.values():
            bpy.data.objects.remove(o, do_unlink=True)
    for m in keep.values():
        m.parent = None
        m.matrix_world.identity()
        for mod in list(m.modifiers):
            m.modifiers.remove(mod)
        am = m.modifiers.new("rig", "ARMATURE")
        am.object = rig
        m.parent = rig
        # The importer leaves the body-shape keys at the file's default weights: measure the base body.
        if m.data.shape_keys:
            for kb in m.data.shape_keys.key_blocks:
                kb.value = 0.0
    return keep


def part_of_vertices(mesh):
    """Each vertex's part id (gear.PARTS, carried in TEXCOORD_0.x)."""
    me = mesh.data
    uv = me.uv_layers[0].data
    part = [0] * len(me.vertices)
    for loop in me.loops:
        part[loop.vertex_index] = int(uv[loop.index].uv.x * 16)
    return part


def try_fixes(mesh) -> int:
    """Apply lib/skinfix.py to an imported mesh in memory (preview a
    weight fix without rebuilding the character)."""
    from lib.rig import limit_weights
    from lib.skinfix import pad_shell

    part = part_of_vertices(mesh)
    n = pad_shell(mesh, where=lambda v: part[v.index] == 4)
    limit_weights(mesh, 4)
    return n


def poses_of(name, clips):
    if name == "rest":
        return [(0, None)]
    if name == "idle":
        from lib.poses import STANCES

        return [(0, STANCES["idle"])]
    if name in GAITS:
        g = GAITS[name]
        return [(f, gait_pose(g, f)) for f in range(g.frames)]
    cl = clips[name]
    if cl.kind == "locomotion":
        return [(f, cl.pose(f)) for f in range(cl.frames)]
    return [(f, cl.pose(f)) for f in range(cl.frames + 1)]


def main() -> None:
    args = sys.argv[1:]
    lods = [int(x) for x in args[args.index("--lods") + 1].split(",")] if "--lods" in args else [0, 1, 2]
    names = args[args.index("--clips") + 1].split(",") if "--clips" in args else DEFAULT_CLIPS
    out = args[args.index("--json") + 1] if "--json" in args else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    c = Controls(rig)
    meshes = import_lods(rig, lods)
    if "--no-rhythm" in args:
        import lib.poses

        lib.poses.RHYTHM_ON = False
    if "--try" in args:
        for m in meshes.values():
            print("fixes applied to", m.name, try_fixes(m))
    if "--gate" in args:
        # The build's gate (lib/skin.py GATE) on the shipped file.
        from lib.skin import gate_lods

        g = gate_lods(rig, [meshes[i] for i in sorted(meshes)])
        for group, gg in g["groups"].items():
            for r, w in gg["regions"].items():
                print(f"gate {group:5s} {r:9s} collapsed {w['collapsed'] * 100:5.2f}% ({w['at'].get('collapsed', '-')})  folded {w['flips'] * 100:5.2f}% ({w['at'].get('flips', '-')})  {'pass' if w['pass'] else 'FAIL'}")
        if out:
            with open(out, "w") as fh:
                json.dump(g, fh, indent=1)
        return
    probes = {i: SkinProbe(m, rig) for i, m in meshes.items()}
    from lib.actions import action_clips
    from lib.transitions import transitions

    clips = {cl.name: cl for cl in [*action_clips(), *transitions()]}
    report = {}
    for name in names:
        worst = {i: {r: {"squash": 1.0, "collapsed": 0.0, "flips": 0, "stretch": 1.0, "frame": {}} for r in REGIONS} for i in lods}
        for f, pose in poses_of(name, clips):
            if pose is None:
                from lib.anim_rig import reset_pose

                reset_pose(rig)
                for side in ("l", "r"):
                    c.arm_ik(side, 0.0)
            else:
                apply_pose(rig, c, pose)
            bpy.context.view_layer.update()
            for i, p in probes.items():
                for r, m in p.measure().items():
                    w = worst[i][r]
                    if m["squash"] < w["squash"]:
                        w["squash"], w["frame"]["squash"] = m["squash"], f
                    if m["collapsed"] > w["collapsed"]:
                        w["collapsed"], w["frame"]["collapsed"] = m["collapsed"], f
                    if m["flips"] > w["flips"]:
                        w["flips"], w["frame"]["flips"] = m["flips"], f
                    if m["stretch"] > w["stretch"]:
                        w["stretch"], w["frame"]["stretch"] = m["stretch"], f
        report[name] = worst
        for i in lods:
            row = "  ".join(f"{r} sq {w['squash']:.2f}@{w['frame'].get('squash', '-')} col {w['collapsed'] * 100:.1f}% fl {w['flips']}@{w['frame'].get('flips', '-')} st {w['stretch']:.2f}" for r, w in worst[i].items())
            print(f"{name:18s} lod{i}  {row}", flush=True)
    if out:
        with open(out, "w") as fh:
            json.dump(report, fh, indent=1)


if __name__ == "__main__":
    main()

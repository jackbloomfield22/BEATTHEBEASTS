"""Stills of the skinning at its worst frames (M6.5 #12): each clip:frame
rendered from a view, and again with the faces the skin probe flags
(lib/skin.py: folded through itself, or collapsed below 20% of their
area) painted yellow, so a sheet shows where the mesh breaks and how badly.

    python3 tools/blender/skin_stills.py <out.png> clip:frame[:view] ... [--lod 0] [--cell 360] [--file player.glb] [--noreach]

Views are lib/preview.py's plus "shoulder" and "hip" close-ups.
"""

from __future__ import annotations

import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib.anim_rig import Controls  # noqa: E402
from lib.poses import apply_pose  # noqa: E402
from lib.preview import VIEWS, render_views, setup_scene, sheet  # noqa: E402
from lib.rig import build_armature  # noqa: E402
from lib.skin import COLLAPSED, FLIP_DEG, SkinProbe  # noqa: E402
from skin_check import poses_of  # noqa: E402

# Close-ups that follow the body (camera offset from a bone's position, target on it).
FOLLOW = {
    # Three-quarter front and back, close on the chest and shoulders.
    "shoulder": ("spine_04", (1.15, -1.35, 0.25), 50),
    "shoulder_back": ("spine_04", (1.15, 1.35, 0.25), 50),
    # Side on, the hips and knees.
    "hip": ("pelvis", (2.0, -0.2, -0.15), 45),
    # The whole body, three-quarter front.
    "body": ("pelvis", (2.6, -2.9, 0.4), 45),
}


def follow_views(rig) -> None:
    for name, (bone, off, lens) in FOLLOW.items():
        at = rig.matrix_world @ rig.pose.bones[bone].head
        VIEWS[name] = ((at.x + off[0], at.y + off[1], at.z + off[2]), (at.x, at.y, at.z - (0.25 if name == "hip" else 0.0)), lens)


def flag_material(mesh) -> None:
    """Keep the part colours, and paint the 'flag' attribute red over them."""
    mat = mesh.data.materials[0]
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    base = bsdf.inputs["Base Color"].links[0].from_socket
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "flag"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["B"].default_value = (1.0, 0.85, 0.0, 1.0)
    nt.links.new(attr.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(base, mix.inputs["A"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])


def set_flags(mesh, probe: SkinProbe, on: bool) -> int:
    me = mesh.data
    attr = me.attributes.get("flag") or me.attributes.new("flag", "FLOAT", "FACE")
    vals = np.zeros(len(me.polygons))
    n = 0
    if on:
        co = probe.deformed()
        R = probe._bone_rot()
        a, b, c = (co[probe.tris[:, k]] for k in range(3))
        nrm = np.cross(b - a, c - a)
        area = np.linalg.norm(nrm, axis=1) / 2
        wf = probe.W[probe.tris].mean(axis=1)
        want = np.einsum("fij,fj->fi", np.einsum("fb,bij->fij", wf, R), probe.rest_n)
        want /= np.maximum(1e-12, np.linalg.norm(want, axis=1))[:, None]
        got = nrm / np.maximum(1e-12, np.linalg.norm(nrm, axis=1))[:, None]
        bad = ((np.sum(want * got, axis=1) < math.cos(math.radians(FLIP_DEG))) | (area / np.maximum(1e-12, probe.rest_area) < COLLAPSED)) & (probe.rest_area > 4e-6)
        # loop triangles back to polygons
        poly = np.empty(len(me.loop_triangles), dtype=np.int64)
        me.loop_triangles.foreach_get("polygon_index", poly)
        vals[poly[bad]] = 1.0
        n = int(bad.sum())
    attr.data.foreach_set("value", vals)
    me.update()
    return n


def main() -> None:
    args = sys.argv[1:]
    lod = int(args[args.index("--lod") + 1]) if "--lod" in args else 0
    cell = int(args[args.index("--cell") + 1]) if "--cell" in args else 360
    args = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))]
    out, specs = args[0], args[1:]
    if "--file" in sys.argv:
        import lib.preview

        lib.preview.PLAYER = os.path.abspath(sys.argv[sys.argv.index("--file") + 1])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    import lib.preview

    mesh = lib.preview.import_player(rig, lod=lod)
    if "--no-rhythm" in sys.argv:
        import lib.poses

        lib.poses.RHYTHM_ON = False
    if "--try" in sys.argv:
        from skin_check import try_fixes

        print("fixes applied", try_fixes(mesh))
    c = Controls(rig)
    probe = SkinProbe(mesh, rig)
    flag_material(mesh)
    cam = setup_scene(size=cell)
    bpy.context.scene.cycles.samples = 16
    from lib.actions import action_clips
    from lib.transitions import transitions

    clips = {cl.name: cl for cl in [*action_clips(), *transitions()]}
    tmp = tempfile.mkdtemp()
    rows = []
    for spec in specs:
        parts = spec.split(":")
        name, f = parts[0], int(parts[1])
        views = parts[2].split("+") if len(parts) > 2 else ["shoulder"]
        pose = dict(poses_of(name, clips))[f]
        apply_pose(rig, c, pose)
        if "--noreach" not in sys.argv:
            from lib.corrective import set_reach

            set_reach([mesh], rig)  # the arms-overhead correctives, as the runtime drives them
        bpy.context.view_layer.update()
        follow_views(rig)
        files = []
        n = 0
        for flagged in (False, True):
            n = set_flags(mesh, probe, flagged) or n
            for v in views:
                src = render_views(cam, [v], tmp)[0]
                dst = os.path.join(tmp, f"{name}_{f}_{v}_{int(flagged)}.png")
                os.replace(src, dst)
                files.append(dst)
        rows.append((f"{name} frame {f} (lod{lod}): {n} faces folded or collapsed (yellow, right)", files))
        print("rendered", spec, n, flush=True)
    sheet(rows, out, cell=cell)
    print("sheet", out)


if __name__ == "__main__":
    main()

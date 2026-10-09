"""Contact sheets for the run-speed catch overlays (passing round 5,
docs/passing/PASSING5.md): each clip laid over the run the way the runtime
masks an overlay over the gait (arms, fingers and the upper spine), at
frames around its secure event, with a football drawn in the hands from the
secure frame to the tuck (between the finger roots, as the runtime holds
it) and coming in along a line before it.

    python3 tools/blender/preview_catches.py <out.png> clip [clip ...] [--view three] [--cell 300]

Rows: one per clip. Columns: 0.18 s and 0.08 s before the secure frame, the
secure frame, the give (+0.06 s), the ball brought in (+0.16 s) and the tuck.
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib.actions import action_clips  # noqa: E402
from lib.anim_rig import Controls  # noqa: E402
from lib.gait import FPS, GAITS, gait_pose  # noqa: E402
from lib.poses import apply_pose  # noqa: E402
from lib.preview import VIEWS, import_player, render_views, setup_scene, sheet  # noqa: E402
from lib.rig import build_armature  # noqa: E402

def local_pose(rig, c, pose) -> dict:
    """Each bone's local transform with the pose solved (IK live), as build_anims.py bakes it."""
    for pb in rig.pose.bones:
        for con in pb.constraints:
            con.mute = False
    apply_pose(rig, c, pose)
    bpy.context.view_layer.update()
    return {pb.name: rig.convert_space(pose_bone=pb, matrix=pb.matrix, from_space="POSE", to_space="LOCAL").copy() for pb in rig.pose.bones}


def over_run(rig, c, overlay_pose, run_pose, mask) -> None:
    """The overlay's baked local rotations on its masked bones over the run's
    (what the runtime's overlay layer does: FK, not the overlay's IK targets),
    left posed on the rig with its constraints muted."""
    ovl = local_pose(rig, c, overlay_pose)
    base = local_pose(rig, c, run_pose)
    m = set(mask)
    for pb in rig.pose.bones:
        for con in pb.constraints:
            con.mute = True
    for pb in rig.pose.bones:
        pb.matrix_basis = ovl[pb.name] if pb.name in m else base[pb.name]
    bpy.context.view_layer.update()


def main() -> None:
    args = sys.argv[1:]
    cell = int(args[args.index("--cell") + 1]) if "--cell" in args else 300
    view = args[args.index("--view") + 1] if "--view" in args else "three"
    pos = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))]
    out, names = pos[0], pos[1:]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    import_player(rig)
    c = Controls(rig)
    cam = setup_scene(size=cell)
    VIEWS.setdefault("catch_three", ((2.0, -2.4, 1.45), (0, -0.35, 1.1), 50))
    VIEWS.setdefault("catch_three_r", ((-2.0, -2.4, 1.45), (0, -0.35, 1.1), 50))
    VIEWS.setdefault("catch_side", ((3.0, -0.4, 1.25), (0, -0.4, 1.05), 50))
    # The football: an ellipsoid 0.28 m long, 0.17 m round.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0)
    ball = bpy.context.active_object
    ball.scale = (0.085, 0.142, 0.085)
    bm = bpy.data.materials.new("ball")
    bm.use_nodes = True
    bm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.08, 0.03, 1)
    ball.data.materials.append(bm)
    clips = {cl.name: cl for cl in action_clips()}
    run = GAITS["run"]
    tmp = tempfile.mkdtemp()
    rows = []
    for name in names:
        clip = clips[name]
        ts = clip.events["secure"] / FPS
        tt = clip.events["tuck"] / FPS
        files = []
        times = [ts - 0.18, ts - 0.08, ts, ts + 0.06, ts + 0.16, tt]
        # Where the hands are at the secure frame: the ball's line comes in to there.
        over_run(rig, c, clip.pose(ts * FPS), gait_pose(run, ts * FPS), clip.mask or [])
        meet = (rig.matrix_world @ rig.pose.bones["fingers_01_l"].head + rig.matrix_world @ rig.pose.bones["fingers_01_r"].head) / 2
        for k, t in enumerate(times):
            # The run moves on with the clip (a frame of the run per frame of the clip).
            over_run(rig, c, clip.pose(t * FPS), gait_pose(run, t * FPS), clip.mask or [])
            fl = rig.matrix_world @ rig.pose.bones["fingers_01_l"].head
            fr = rig.matrix_world @ rig.pose.bones["fingers_01_r"].head
            mid = (fl + fr) / 2
            # In the hands from the secure frame; before it, coming in from in front and a little above at ~17 m/s.
            ball.location = mid if t >= ts - 1e-6 else meet + Vector((0.0, -17.0 * (ts - t), 0.9 * (ts - t)))
            src = render_views(cam, [view], tmp)[0]
            dst = os.path.join(tmp, f"{name}_{k}.png")
            os.replace(src, dst)
            files.append(dst)
        rows.append((f"{name}: secure {ts:.2f} s, tuck {tt:.2f} s ({view})", files))
    sheet(rows, out, cell=cell)
    print("sheet", out)


if __name__ == "__main__":
    main()

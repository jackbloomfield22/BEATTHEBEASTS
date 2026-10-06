"""Close-up stills of the geared player in Blender (the character pass,
docs/characters/CHARACTERS.md): the helmet, the pads, the hands and feet,
in a rest stance or a keyed clip frame, from a built player.glb.

    python3 tools/blender/preview_gear.py out.png [--file player.glb] [--lod 0] [--pose clip:frame] [--views head,head_side,...]

Views are lib/preview.VIEWS plus the close ones below.
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from lib import preview  # noqa: E402
from lib.rig import build_armature  # noqa: E402

CLOSE = {
    "head": ((0.55, -1.3, 1.78), (0, 0, 1.70), 60),
    "head_side": ((1.25, -0.15, 1.78), (0, -0.02, 1.74), 75),
    "head_back": ((-0.55, 1.15, 1.85), (0, 0, 1.68), 60),
    "head_front": ((0.0, -1.25, 1.76), (0, 0, 1.74), 70),
    "pads": ((0.9, -1.6, 1.7), (0, 0, 1.35), 50),
    "hips": ((0.9, -1.5, 1.1), (0, 0, 1.0), 55),
    "knee": ((1.5, 0.4, 0.6), (0, 0, 0.55), 55),
    "feet": ((0.8, -1.1, 0.35), (0, -0.05, 0.12), 55),
}


def main() -> None:
    args = sys.argv[1:]
    out = args[0]
    if "--file" in args:
        preview.PLAYER = os.path.abspath(args[args.index("--file") + 1])
    lod = int(args[args.index("--lod") + 1]) if "--lod" in args else 0
    views = args[args.index("--views") + 1].split(",") if "--views" in args else ["head", "head_side", "head_back", "pads"]
    pose = args[args.index("--pose") + 1] if "--pose" in args else None
    preview.VIEWS.update(CLOSE)
    preview.HIDDEN.discard(13)  # show the towel
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    preview.import_player(rig, lod)
    if pose:
        from lib.actions import action_clips
        from lib.anim_rig import Controls
        from lib.poses import apply_pose
        from lib.transitions import transitions
        from skin_check import poses_of

        clips = {cl.name: cl for cl in [*action_clips(), *transitions()]}
        clip, frame = pose.split(":")
        apply_pose(rig, Controls(rig), dict(poses_of(clip, clips))[int(frame)])
        bpy.context.view_layer.update()
    cam = preview.setup_scene(520)
    tmp = tempfile.mkdtemp()
    files = preview.render_views(cam, views, tmp)
    preview.sheet([(f"{os.path.basename(preview.PLAYER)} lod{lod} {pose or 'rest'}", files)], out, cell=520)
    print("wrote", out)


if __name__ == "__main__":
    main()

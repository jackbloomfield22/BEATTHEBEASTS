"""Contact sheets for locomotion clips: N evenly spaced frames per cycle.

    python3 tools/blender/preview_clips.py <out.png> [gait ...] [--frames 8] [--view side]
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from lib.anim_rig import Controls  # noqa: E402
from lib.gait import GAITS, gait_pose  # noqa: E402
from lib.poses import apply_pose  # noqa: E402
from lib.preview import import_player, render_views, setup_scene, sheet  # noqa: E402
from lib.rig import build_armature  # noqa: E402


def main() -> None:
    args = sys.argv[1:]
    n = int(args[args.index("--frames") + 1]) if "--frames" in args else 8
    view = args[args.index("--view") + 1] if "--view" in args else "side"
    args = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))]
    out, names = args[0], args[1:] or list(GAITS)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    import_player(rig)
    c = Controls(rig)
    cam = setup_scene(size=300)
    tmp = tempfile.mkdtemp()
    rows = []
    for name in names:
        g = GAITS[name]
        files = []
        for k in range(n):
            f = round(k * g.frames / n)
            apply_pose(rig, c, gait_pose(g, f))
            bpy.context.view_layer.update()
            src = render_views(cam, [view], tmp)[0]
            dst = os.path.join(tmp, f"{name}_{k}.png")
            os.replace(src, dst)
            files.append(dst)
        rows.append((f"{name}  {g.speed} m/s  {g.frames} frames", files))
    sheet(rows, out, cell=300)
    print("sheet", out)


if __name__ == "__main__":
    main()

"""Contact sheets for locomotion and transition clips: N evenly spaced
frames per cycle (loops) or from first to last frame (transitions).

    python3 tools/blender/preview_clips.py <out.png> [gait|transition ...] [--frames 8] [--view side]
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
from lib.transitions import transitions  # noqa: E402
from lib.actions import action_clips  # noqa: E402


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
    trs = {t.name: t for t in [*transitions(), *action_clips()]}
    for name in names:
        tr = trs.get(name)
        files = []
        for k in range(n):
            if tr:
                f = round(k * tr.frames / (n - 1)) if not getattr(tr, "loop", False) else round(k * tr.frames / n)
                pose = tr.pose(f)
            else:
                g = GAITS[name]
                pose = gait_pose(g, round(k * g.frames / n))
            apply_pose(rig, c, pose)
            bpy.context.view_layer.update()
            src = render_views(cam, [view], tmp)[0]
            dst = os.path.join(tmp, f"{name}_{k}.png")
            os.replace(src, dst)
            files.append(dst)
        label = f"{name}  {tr.frames / 30:.2f} s  {tr.travel(tr.frames):.2f} m" if tr else f"{name}  {GAITS[name].speed} m/s  {GAITS[name].frames} frames"
        rows.append((label, files))
    sheet(rows, out, cell=300)
    print("sheet", out)


if __name__ == "__main__":
    main()

"""Render a contact sheet of every stance (side, front, broadcast views).

    python3 tools/blender/preview_stances.py <out.png> [stance ...]
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from lib.anim_rig import Controls  # noqa: E402
from lib.poses import STANCES, apply_pose  # noqa: E402
from lib.preview import import_player, render_views, setup_scene, sheet  # noqa: E402
from lib.rig import build_armature  # noqa: E402


def main() -> None:
    out = sys.argv[1]
    names = sys.argv[2:] or list(STANCES)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    import_player(rig)
    c = Controls(rig)
    cam = setup_scene()
    tmp = tempfile.mkdtemp()
    rows = []
    for n in names:
        apply_pose(rig, c, STANCES[n])
        bpy.context.view_layer.update()
        files = render_views(cam, ["side", "front", "broadcast"], tmp)
        keep = []
        for i, f in enumerate(files):
            dst = os.path.join(tmp, f"{n}_{i}.png")
            os.replace(f, dst)
            keep.append(dst)
        rows.append((n, keep))
    sheet(rows, out)
    print("sheet", out)


if __name__ == "__main__":
    main()

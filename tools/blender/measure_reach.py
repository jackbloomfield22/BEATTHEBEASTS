"""Where a catch clip's hands are at its secure frame, laid over the run
(passing round 8, docs/passing/PASSING8.md): the midpoint of the finger
roots (where the runtime holds the ball), the fingertips and the shoulders,
against his centre (the sim's spot: the rig's origin), in metres, + ahead.

    python3 tools/blender/measure_reach.py clip [clip ...]

The sim's catch reach (src/sim/passing.ts REACH_FWD) is read off this: the
ball can be taken no further out in front of him than the drawn hands get.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from lib.actions import action_clips  # noqa: E402
from lib.anim_rig import Controls  # noqa: E402
from lib.gait import FPS, GAITS, gait_pose  # noqa: E402
from lib.rig import build_armature  # noqa: E402
from preview_catches import over_run  # noqa: E402


def main() -> None:
    names = sys.argv[1:]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    c = Controls(rig)
    clips = {cl.name: cl for cl in action_clips()}
    run = GAITS["run"]
    W = rig.matrix_world

    def mid(a: str, b: str, tail: bool = False):
        pa, pb = rig.pose.bones[a], rig.pose.bones[b]
        return ((W @ pa.tail + W @ pb.tail) if tail else (W @ pa.head + W @ pb.head)) / 2

    for name in names:
        clip = clips[name]
        ts = clip.events["secure"] / FPS
        for label, t in (("secure", ts), ("-0.06", ts - 0.06)):
            over_run(rig, c, clip.pose(t * FPS), gait_pose(run, t * FPS), clip.mask or [])
            f = mid("fingers_01_l", "fingers_01_r")
            tip = mid("fingers_03_l", "fingers_03_r", True)
            sh = mid("upperarm_l", "upperarm_r")
            # The rig faces -Y: ahead is -y.
            print(f"{name:26s} {label:7s} finger roots ahead {-f.y:5.2f} up {f.z:4.2f} | fingertips ahead {-tip.y:5.2f} up {tip.z:4.2f} | shoulders ahead {-sh.y:5.2f} up {sh.z:4.2f}")


if __name__ == "__main__":
    main()

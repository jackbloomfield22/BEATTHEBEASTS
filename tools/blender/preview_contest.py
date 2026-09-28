"""Stills of a contested catch (M6.5 #12): a receiver catching in stride
with a defender at his hip, drawn the way the runtime draws them.

    python3 tools/blender/preview_contest.py <out.png> [--gap 0.0] [--cell 420]

Two bodies from one rig: each is posed (the run's legs, the overlay's
arms and upper spine, as the runtime's bone masks lay an overlay over the
gait), snapshotted to a static mesh and placed. Rows:
  1. before: the receiver's catch over the run, the defender running
     through it with the run's arms, at the sim's minimum distance;
  2. after: the defender's contest overlay (def_contest_l, its contact
     frame on the catch's secure frame) and both leaning into each other
     by the angle src/render/game/contact.ts gives (pads meeting).
Columns: the broadcast's high three-quarter view, in front of them, behind
them. The defender wears white.
"""

from __future__ import annotations

import copy
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from lib.actions import action_clips  # noqa: E402
from lib.anim_rig import Controls  # noqa: E402
from lib.gait import GAITS, gait_pose  # noqa: E402
from lib.poses import apply_pose  # noqa: E402
from lib.preview import VIEWS, import_player, render_views, setup_scene, sheet  # noqa: E402
from lib.rig import build_armature  # noqa: E402

# Overlay masks as the runtime applies them: arms, fingers and the upper spine.
UPPER = ("clavicle", "upperarm", "forearm", "hand", "fingers", "index", "thumb", "spine_02", "spine_03", "spine_04")

# The pair (Blender frame, metres; the defender at the origin facing -Y, the
# receiver on his left and half a step ahead). The sim holds two 200 lb
# players 0.72 yd (0.66 m) apart centre to centre.
SIM_MIN = 0.66
# contact.ts: the pads meet at 1.45 m (x scale), pressing 3 cm.
PAD_HEIGHT, PRESS = 1.45, 0.03
# The measured half-widths (measure_bodies.py, a 6'0" 195 lb receiver and corner).
HW = 0.28


def over_run(overlay_pose, run_pose):
    p = copy.deepcopy(run_pose)
    p.joints.update({k: v for k, v in overlay_pose.joints.items() if k.startswith(UPPER)})
    p.hands = dict(overlay_pose.hands)
    p.elbow = dict(overlay_pose.elbow)
    p.arms = {s: a for s, a in run_pose.arms.items() if s not in overlay_pose.hands}
    return p


def snapshot(mesh, name):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(mesh.evaluated_get(dg))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def away_kit(ob) -> None:
    """The defender in white with dark pants, so the two bodies read apart."""
    mat = ob.data.materials[0].copy()
    ramp = next(n for n in mat.node_tree.nodes if n.type == "VALTORGB")
    els = ramp.color_ramp.elements
    for i, col in ((4, (0.85, 0.85, 0.86)), (5, (0.05, 0.06, 0.12)), (14, (0.85, 0.85, 0.86))):
        if i < len(els):
            els[i].color = (*col, 1.0)
    ob.data.materials[0] = mat


def place(ob, x, y, lean_dir=None, lean=0.0):
    m = Matrix.Translation((x, y, 0.0))
    if lean and lean_dir is not None:
        axis = Vector((0, 0, 1)).cross(lean_dir).normalized()
        m = m @ Matrix.Rotation(lean, 4, axis)
    ob.matrix_world = m


def main() -> None:
    args = sys.argv[1:]
    cell = int(args[args.index("--cell") + 1]) if "--cell" in args else 420
    out = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][0]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")
    mesh = import_player(rig)
    c = Controls(rig)
    cam = setup_scene(size=cell)
    clips = {cl.name: cl for cl in action_clips()}
    run = GAITS["run"]
    catch, contest = clips["catch_hands_run"], clips["def_contest_l"]
    secure, contact = catch.events["secure"], contest.events["contact"]
    # The receiver at his secure frame, the run a quarter cycle on; the defender a half step behind in his stride.
    rec_pose = over_run(catch.pose(secure), gait_pose(run, 5))
    def_run = gait_pose(run, 14)
    rows = []
    tmp = tempfile.mkdtemp()
    VIEWS.update({
        "c_broadcast": ((3.4, -3.6, 3.2), (0.3, -0.3, 1.0), 45),
        "c_front": ((0.6, -4.2, 1.3), (0.3, -0.3, 1.05), 45),
        "c_behind": ((0.9, 3.6, 1.7), (0.3, -0.3, 1.1), 45),
    })
    rx, ry = SIM_MIN * math.cos(math.radians(20)), -SIM_MIN * math.sin(math.radians(20))
    toward = Vector((rx, ry, 0)).normalized()
    gap = SIM_MIN - 2 * HW
    lean = math.atan2(gap / 2 + PRESS, PAD_HEIGHT)
    for label, def_pose, ang in (
        ("before: the defender runs through the catch with the run's arms, bodies upright", def_run, 0.0),
        (f"after: def_contest_l at its contact frame, both leaning in {math.degrees(lean):.1f} deg (contact.ts)", over_run(contest.pose(contact), def_run), lean),
    ):
        apply_pose(rig, c, rec_pose)
        bpy.context.view_layer.update()
        rec = snapshot(mesh, "receiver")
        apply_pose(rig, c, def_pose)
        bpy.context.view_layer.update()
        dfn = snapshot(mesh, "defender")
        away_kit(dfn)
        mesh.hide_render = True
        place(dfn, 0.0, 0.0, toward, ang)
        place(rec, rx, ry, -toward, ang)
        files = []
        for v in ("c_broadcast", "c_front", "c_behind"):
            src = render_views(cam, [v], tmp)[0]
            dst = os.path.join(tmp, f"{len(rows)}_{v}.png")
            os.replace(src, dst)
            files.append(dst)
        rows.append((label, files))
        for ob in (rec, dfn):
            bpy.data.objects.remove(ob, do_unlink=True)
        mesh.hide_render = False
    sheet(rows, out, cell=cell)
    print("sheet", out)


if __name__ == "__main__":
    main()

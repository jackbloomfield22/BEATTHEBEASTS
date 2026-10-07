"""Helper bones driven at runtime (character pass, round two;
docs/characters/CHARACTERS2.md). Two kinds, both deform bones in
player.glb that no clip keys:

- `epaulet_l/r`: the shoulder pad's outer cap and lip and the sleeve under
  it. With an arm overhead (the high point, a celebration, the referee's
  touchdown) the arm turns ~125 degrees up out of the A-pose while the pad
  shell stays on the chest and clavicle: the sleeve and the lip stayed
  horizontal and stood out beside the helmet as "horns" (round one's
  corrective only relaxed the crumpling; at LOD2 it hardly moved). On a
  real player the epaulet is laced to the arch and rides up on the
  deltoid. The epaulet bone sits on the shoulder joint and turns with a
  share of the arm's swing that is zero through all of normal play (the
  sprint's arm swing, a block, a throw) and grows only as the arm rises
  past the shoulder (EPAULET_FROM..EPAULET_TO degrees of elevation, the
  same measure as the corrective's), to EPAULET_MAX at full reach.

- `elbow_helper_l/r`: a half-angle elbow. With linear blend skinning, a
  vertex skinned half to the upper arm and half to the forearm is carried
  by the average of the two bones' matrices, which isn't a rotation: at a
  120-degree bend it pulls the vertex halfway to the joint's axis, and
  the inside of the elbow collapses (the sprint's carry arm). The helper
  sits on the elbow with the forearm's rest orientation and turns by HALF
  of the forearm's swing (its rotation off its rest axis, the twist about
  its length removed: the forearm twist bone carries that). Part of the
  elbow's blend band moves onto it (ELBOW_STRENGTH: a 50/50 vertex becomes
  half helper), with the band itself widened first
  (build_character.near_elbow).

The runtime drives both every frame after the pose
(src/render/players/playerAsset.ts, Player.updateHelpers) and so does
every Blender tool that poses the mesh (drive_helpers: the build's
skinning gate, the correctives, skin_check, skin_stills, preview_gear),
with the same formula: helper local rotation = rest * slerp(identity,
swing(rest^-1 * child local rotation), share).
"""

from __future__ import annotations

import os

import bpy
from mathutils import Quaternion

from .geo import smoothstep

SIDES = ("l", "r")
# name: (parent bone, the child bone it follows).
HELPERS = {
    "epaulet": ("clavicle", "upperarm"),
    "elbow_helper": ("upperarm", "forearm"),
}
# Mirrored in playerAsset.ts (HELPER_*); a test checks they agree.
ELBOW_SHARE = 0.5
ELBOW_STRENGTH = float(os.environ.get("BTB_ELBOW_STRENGTH", "0.5"))
EPAULET_FROM = float(os.environ.get("BTB_EPAULET_FROM", "95"))
EPAULET_TO = float(os.environ.get("BTB_EPAULET_TO", "165"))
EPAULET_MAX = float(os.environ.get("BTB_EPAULET_MAX", "0.6"))
# The epaulet takes the shell (pad_shell's share) outside EPAULET_X (|x|, m:
# fade in, full), the cap's outer edge and its lip over the deltoid; inside
# it the arch stays on the chest and clavicle.
EPAULET_X = (float(os.environ.get("BTB_EPAULET_X0", "0.21")), float(os.environ.get("BTB_EPAULET_X1", "0.27")))
TRUNK = ("spine_01", "spine_02", "spine_03", "spine_04")
# Along the upper arm (0 shoulder, 1 elbow): the sleeve beyond here goes with the epaulet.
SLEEVE_T = tuple(float(x) for x in os.environ.get("BTB_SLEEVE_T", "0.25,0.4").split(","))


def helper_names() -> list[str]:
    return [f"{h}_{s}" for h in HELPERS for s in SIDES]


def add_helpers(rig: bpy.types.Object) -> None:
    """Add the helper bones to an armature built by lib/rig.build_armature:
    each one a copy of the followed bone's rest (head, direction, roll), a
    third of its length, parented to that bone's parent."""
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones
    for h, (parent, child) in HELPERS.items():
        for s in SIDES:
            if f"{h}_{s}" in eb:
                continue
            c = eb[f"{child}_{s}"]
            e = eb.new(f"{h}_{s}")
            e.head = c.head.copy()
            e.tail = c.head + (c.tail - c.head) * 0.35
            e.roll = c.roll
            e.parent = eb[f"{parent}_{s}"]
            e.use_connect = False
            e.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")


def swing_share(q: Quaternion, share: float) -> Quaternion:
    """The swing part of q (its rotation off the bone's own Y axis, the twist
    about Y removed), scaled toward identity by `share` (slerp)."""
    q = q.normalized()
    tw = Quaternion((q.w, 0.0, q.y, 0.0))
    if tw.magnitude < 1e-8:
        tw = Quaternion()
    tw.normalize()
    swing = q @ tw.inverted()
    return Quaternion().slerp(swing, share)


def epaulet_share(elevation_deg: float) -> float:
    return EPAULET_MAX * smoothstep(EPAULET_FROM, EPAULET_TO, elevation_deg)


def drive_helpers(rig: bpy.types.Object) -> None:
    """Pose every helper from the evaluated pose (after IK): call it after
    posing the rig and before measuring or evaluating a mesh."""
    from .corrective import arm_elevation

    bpy.context.view_layer.update()
    pb = rig.pose.bones
    bones = rig.data.bones
    for h, (parent, child) in HELPERS.items():
        for s in SIDES:
            hp = pb.get(f"{h}_{s}")
            if hp is None:
                continue
            p, c = pb[f"{parent}_{s}"], pb[f"{child}_{s}"]
            # The child's rotation off its rest, in its own rest frame (its
            # pose basis with the constraints applied).
            rest_rel = bones[p.name].matrix_local.inverted() @ bones[c.name].matrix_local
            local = (p.matrix @ rest_rel).inverted() @ c.matrix
            share = ELBOW_SHARE if h == "elbow_helper" else epaulet_share(arm_elevation(rig, s))
            hp.rotation_mode = "QUATERNION"
            hp.rotation_quaternion = swing_share(local.to_quaternion(), share)
    bpy.context.view_layer.update()


def _move(groups, vi: int, ws: dict, names, take_frac: float, to: str) -> None:
    """Move take_frac of the weight on `names` (proportionally) to the group `to`."""
    moved = 0.0
    for n, w in ws.items():
        if n in names:
            groups[n].add([vi], w * (1.0 - take_frac), "REPLACE")
            moved += w * take_frac
    if moved > 0:
        g = groups.get(to) or groups.new(name=to)
        g.add([vi], ws.get(to, 0.0) + moved, "REPLACE")


def reweight(ob: bpy.types.Object, part_of) -> int:
    """Give the helpers their weights on a joined LOD (part_of(vertex index)
    is its part id). Returns how many vertices changed."""
    from .gear import along_upper_arm
    from .skinfix import shell_share

    groups = ob.vertex_groups
    changed = 0
    for s in SIDES:
        for h in HELPERS:
            groups.get(f"{h}_{s}") or groups.new(name=f"{h}_{s}")
        trunk = {*TRUNK, f"clavicle_{s}", f"pad_{s}"}
        upper = {f"upperarm_{s}", f"upperarm_twist_{s}"}
        fore = {f"forearm_{s}", f"forearm_twist_{s}"}
        for v in ob.data.vertices:
            co = v.co
            if (co.x > 0) != (s == "l"):
                continue
            pid = part_of(v.index)
            ws = {groups[g.group].name: g.weight for g in v.groups if g.weight > 0}
            # The epaulet: the pad cap's outer edge and lip (jersey), and the
            # trunk's share of the sleeve below it (jersey, the official's shirt).
            if pid in (4, 15) and abs(co.x) > EPAULET_X[0]:
                t, r = along_upper_arm(co, s)
                shell = shell_share(co) if pid == 4 else 0.0
                k = shell * smoothstep(EPAULET_X[0], EPAULET_X[1], abs(co.x))
                if t > 0.05 and r < 0.12:
                    k = max(k, smoothstep(SLEEVE_T[0], SLEEVE_T[1], t))  # the sleeve
                if k > 0 and any(n in trunk for n in ws):
                    _move(groups, v.index, ws, trunk, k, f"epaulet_{s}")
                    changed += 1
                    continue
            # The elbow's band (skin and gloves).
            if pid in (0, 1):
                wn = sum(w for n, w in ws.items() if n in upper)
                wf = sum(w for n, w in ws.items() if n in fore)
                take = 2.0 * min(wn, wf) * ELBOW_STRENGTH
                if take > 1e-4:
                    for n, w in ws.items():
                        if n in upper:
                            groups[n].add([v.index], w - w / wn * take / 2, "REPLACE")
                        elif n in fore:
                            groups[n].add([v.index], w - w / wf * take / 2, "REPLACE")
                    hg = groups[f"elbow_helper_{s}"]
                    hg.add([v.index], ws.get(hg.name, 0.0) + take, "REPLACE")
                    changed += 1
    return changed

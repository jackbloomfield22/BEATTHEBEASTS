"""Animation controls on the football rig: IK targets for feet and hands,
knee and elbow poles, and anatomical posing helpers.

Rotation conventions (measured on the rig; see skeleton.py): in each pose
bone's local XYZ Euler, +X flexes a joint forward (hip, shoulder, elbow,
spine, neck; the knee flexes with -X; the foot's +X lifts the toes), +Z
abducts the left side (the right side mirrors), and Y twists.

Poses are authored as control values and baked to plain FK keys for export
(TECH_PLAN §9.1), so the runtime sees ordinary bone rotations.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

from .skeleton import J

SIDES = ("l", "r")
SIGN = {"l": 1.0, "r": -1.0}
# Knees flex with -X on this rig; every other hinge with +X.
FLEX_SIGN = {"calf": -1.0}


def rad(d: float) -> float:
    return math.radians(d)


def set_joint(rig: bpy.types.Object, bone: str, flex: float = 0.0, abd: float = 0.0, twist: float = 0.0) -> None:
    """Anatomical angles in degrees: flexion, abduction (away from the midline) and twist."""
    pb = rig.pose.bones[bone]
    pb.rotation_mode = "XYZ"
    base = bone.rsplit("_", 1)[0] if bone.endswith(("_l", "_r")) else bone
    side = SIGN.get(bone[-1], 1.0) if bone.endswith(("_l", "_r")) else 1.0
    pb.rotation_euler = (rad(flex) * FLEX_SIGN.get(base, 1.0), rad(twist) * side, rad(abd) * side)


def reset_pose(rig: bpy.types.Object) -> None:
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def _empty(name: str, loc) -> bpy.types.Object:
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e


class Controls:
    """IK targets and poles for the four limbs. Feet always use IK (so planted
    feet stay planted); hands use IK only while their `hand_ik` influence is on."""

    def __init__(self, rig: bpy.types.Object):
        self.rig = rig
        self.foot = {}
        self.knee = {}
        self.hand = {}
        self.elbow = {}
        self.foot_rot = {}
        for s in SIDES:
            ank = Vector(J[f"ankle_{s}"])
            self.foot[s] = _empty(f"foot_target_{s}", ank)
            self.knee[s] = _empty(f"knee_pole_{s}", ank + Vector((0, -1.0, 0.45)))
            wr = Vector(J[f"wrist_{s}"])
            self.hand[s] = _empty(f"hand_target_{s}", wr)
            self.elbow[s] = _empty(f"elbow_pole_{s}", Vector(J[f"elbow_{s}"]) + Vector((0.3 * SIGN[s], 0.6, 0)))
            # Leg: 2-bone IK on the calf to the ankle target, the foot keeps the
            # target's world rotation (flat on the field unless keyed).
            ik = rig.pose.bones[f"calf_{s}"].constraints.new("IK")
            ik.target = self.foot[s]
            ik.pole_target = self.knee[s]
            ik.chain_count = 2
            ik.use_stretch = False
            cr = rig.pose.bones[f"foot_{s}"].constraints.new("COPY_ROTATION")
            cr.target = self.foot[s]
            cr.target_space = "WORLD"
            cr.owner_space = "WORLD"
            self.foot_rot[s] = cr
            # Arm: 2-bone IK on the forearm, off by default.
            ika = rig.pose.bones[f"forearm_{s}"].constraints.new("IK")
            ika.target = self.hand[s]
            ika.pole_target = self.elbow[s]
            ika.chain_count = 2
            ika.use_stretch = False
            ika.influence = 0.0
        # The foot target carries the foot's rest world rotation: rotate the
        # empty (not the bone) to roll heel-to-toe.
        for s in SIDES:
            m = rig.matrix_world @ rig.data.bones[f"foot_{s}"].matrix_local
            self.foot[s].rotation_mode = "QUATERNION"
            self.foot[s].rotation_quaternion = m.to_quaternion()
            self.foot_rest = getattr(self, "foot_rest", {})
            self.foot_rest[s] = m.to_quaternion()
        self._calibrate_poles()
        self.elbow_rest = {s: self.elbow[s].location.copy() for s in SIDES}

    def arm_ik(self, s: str, on: float) -> None:
        self.rig.pose.bones[f"forearm_{s}"].constraints["IK"].influence = on

    def _calibrate_poles(self) -> None:
        """Find each chain's pole angle so the knee (elbow) points at its pole."""
        for s in SIDES:
            for bone, pole, mid in ((f"calf_{s}", self.knee[s], f"calf_{s}"), (f"forearm_{s}", self.elbow[s], f"forearm_{s}")):
                c = self.rig.pose.bones[bone].constraints["IK"]
                keep = c.influence
                c.influence = 1.0
                # Bend the chain a little so the pole matters.
                tgt = c.target
                saved = tgt.location.copy()
                tgt.location = saved + (Vector((0, 0, 0.12)) if bone.startswith("calf") else Vector((0.0, -0.10, 0.10)))
                best, best_d = 0.0, -2.0
                for deg in range(-180, 180, 15):
                    c.pole_angle = rad(deg)
                    bpy.context.view_layer.update()
                    head = self.rig.matrix_world @ self.rig.pose.bones[mid].head
                    root = self.rig.matrix_world @ self.rig.pose.bones[mid].parent.head
                    end = self.rig.matrix_world @ self.rig.pose.bones[mid].tail
                    axis = (end - root).normalized()
                    off = head - root
                    off -= axis * off.dot(axis)
                    want = pole.location - root
                    want -= axis * want.dot(axis)
                    d = off.normalized().dot(want.normalized()) if off.length > 1e-5 and want.length > 1e-5 else -2
                    if d > best_d:
                        best, best_d = deg, d
                c.pole_angle = rad(best)
                tgt.location = saved
                c.influence = keep
        bpy.context.view_layer.update()


def world_bone_head(rig: bpy.types.Object, bone: str) -> Vector:
    return rig.matrix_world @ rig.pose.bones[bone].head


def world_bone_tail(rig: bpy.types.Object, bone: str) -> Vector:
    return rig.matrix_world @ rig.pose.bones[bone].tail


def set_pelvis(rig: bpy.types.Object, forward: float = 0.0, up: float = 0.0, side: float = 0.0, flex: float = 0.0, lateral: float = 0.0, twist: float = 0.0) -> None:
    """Move and turn the pelvis (the body's root) in world terms: forward is -Y, up is +Z, side is +X (left)."""
    pb = rig.pose.bones["pelvis"]
    # The pelvis bone points up (+Z) and its roll aims local Z forward (-Y),
    # so local (x, y, z) = (left, up, forward).
    pb.location = (side, up, forward)
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (rad(flex), rad(twist), rad(lateral))

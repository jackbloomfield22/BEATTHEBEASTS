"""Named key poses (TECH_PLAN §9.1 pose library) and how to apply one.

A pose is control values, not bone matrices: where the pelvis sits and how
it's tilted, spine/neck/arm angles (anatomical: flex, abduct, twist, degrees,
relative to the A-pose rest), where each foot's ball touches the field (with
heel raise and toe-out), and optional IK targets for hands (a hand on the
turf, hands on the knees). Blender's IK then solves the legs (and those
hands), and the build bakes everything to FK keys.

Numbers come from coaching descriptions of each stance: e.g. the lineman's
three-point stance has feet about shoulder width, the down-hand side foot
staggered back to the instep, the back flat and the down hand just inside
the foot line and a little ahead of the shoulders; the defensive back sits
on the balls of the feet with knees bent and chest over the toes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from mathutils import Quaternion, Vector

from .anim_rig import SIDES, Controls, reset_pose, set_joint, set_pelvis
from .skeleton import J

BALL_REST = {s: Vector(J[f"ball_{s}"]) for s in SIDES}
ANKLE_REST = {s: Vector(J[f"ankle_{s}"]) for s in SIDES}


@dataclass
class Foot:
    x: float  # ball of the foot on the field (m): +x left
    y: float  # -y forward
    heel: float = 0.0  # heel raise (deg): 0 flat, ~20 on the balls of the feet
    out: float = 8.0  # toe-out (deg)
    lift: float = 0.0  # ball height above the field (m), for swing phases


@dataclass
class Pose:
    pelvis: dict = field(default_factory=dict)  # forward, up, side, flex, lateral, twist
    joints: dict = field(default_factory=dict)  # bone -> (flex, abd, twist)
    feet: dict = field(default_factory=dict)  # side -> Foot
    hands: dict = field(default_factory=dict)  # side -> (x, y, z) wrist target; IK on


def place_foot(c: Controls, s: str, f: Foot) -> None:
    sign = 1.0 if s == "l" else -1.0
    yaw = Quaternion((0, 0, 1), math.radians(f.out * sign))
    pitch = Quaternion((1, 0, 0), math.radians(f.heel))
    rot = yaw @ pitch
    ball = Vector((f.x, f.y, BALL_REST[s].z + f.lift))
    ankle = ball + rot @ (ANKLE_REST[s] - BALL_REST[s])
    c.foot[s].location = ankle
    c.foot[s].rotation_quaternion = rot @ c.foot_rest[s]


# Relaxed arms at the sides from the A-pose: down 40°, a little forward, the
# elbow soft.
ARMS_DOWN = {
    "upperarm_l": (6, -40, 0), "upperarm_r": (6, -40, 0),
    "forearm_l": (14, 0, 0), "forearm_r": (14, 0, 0),
}


def apply_pose(rig, c: Controls, p: Pose) -> None:
    reset_pose(rig)
    set_pelvis(rig, **p.pelvis)
    for s in SIDES:
        c.arm_ik(s, 0.0)
    joints = {**ARMS_DOWN, **p.joints}
    for bone, ang in joints.items():
        set_joint(rig, bone, *ang)
    feet = p.feet or {"l": Foot(0.13, -0.11), "r": Foot(-0.13, -0.11)}
    for s in SIDES:
        place_foot(c, s, feet[s])
    for s, xyz in p.hands.items():
        c.arm_ik(s, 1.0)
        c.hand[s].location = Vector(xyz)


def mirror(p: Pose) -> Pose:
    """Left-right mirror (a right-handed stance from a left-handed one)."""
    def sw(n: str) -> str:
        return n[:-2] + ("_r" if n.endswith("_l") else "_l") if n.endswith(("_l", "_r")) else n

    pel = dict(p.pelvis)
    for k in ("side", "lateral", "twist"):
        if k in pel:
            pel[k] = -pel[k]
    joints = {}
    for b, (fl, ab, tw) in p.joints.items():
        # Spine/neck side-bend and twist flip sign; limbs swap sides (their abd/twist already mirror).
        joints[sw(b)] = (fl, ab, tw) if b.endswith(("_l", "_r")) else (fl, -ab, -tw)
    feet = {("r" if s == "l" else "l"): Foot(-f.x, f.y, f.heel, f.out, f.lift) for s, f in p.feet.items()}
    hands = {("r" if s == "l" else "l"): (-x, y, z) for s, (x, y, z) in p.hands.items()}
    return Pose(pel, joints, feet, hands)


FIST = {f"{f}_{i}_{s}": (70 if f != "thumb" else 30, 0, 0) for s in SIDES for f in ("index", "fingers", "thumb") for i in ("01", "02", "03")}
OPEN = {f"{f}_{i}_{s}": (12 if f != "thumb" else 5, 0, 0) for s in SIDES for f in ("index", "fingers", "thumb") for i in ("01", "02", "03")}

# --- Stances -----------------------------------------------------------------
# Hips sit back to balance a forward trunk: each stance's pelvis offset was
# set so the centre of mass falls inside the feet (build_anims.py gate).

STANCES: dict[str, Pose] = {}

# Standing idle: weight even, knees soft, arms relaxed.
STANCES["idle"] = Pose(
    pelvis={"up": -0.015},
    joints={"spine_02": (2, 0, 0), "neck_01": (4, 0, 0), "head": (-2, 0, 0), **OPEN},
    feet={"l": Foot(0.14, -0.10, out=10), "r": Foot(-0.14, -0.11, out=10)},
)

# Offensive/defensive lineman three-point (right hand down).
STANCES["ol_3pt"] = Pose(
    pelvis={"forward": 0.12, "up": -0.36, "flex": 84},  # flat back: hips ~0.65 m, shoulders ~0.64 m
    joints={
        "spine_01": (4, 0, 0), "spine_02": (6, 0, 0), "spine_03": (4, 0, 0), "spine_04": (-2, 0, 0),
        "neck_01": (-30, 0, 0), "neck_02": (-18, 0, 0), "head": (-16, 0, 0),
        # Off arm: forearm resting across the left thigh.
        "upperarm_l": (40, -30, 10), "forearm_l": (70, 0, 0), "hand_l": (-10, 0, 0),
        **FIST,
    },
    feet={"l": Foot(0.23, -0.10, heel=12, out=6), "r": Foot(-0.21, 0.06, heel=24, out=4)},
    hands={"r": (-0.13, -0.62, 0.075)},
)

# Defensive lineman four-point (both hands down, hips higher, weight forward).
STANCES["dl_4pt"] = Pose(
    pelvis={"forward": 0.12, "up": -0.35, "flex": 84},  # hips just above the shoulders
    joints={
        "spine_01": (4, 0, 0), "spine_02": (6, 0, 0), "spine_03": (6, 0, 0),
        "neck_01": (-32, 0, 0), "neck_02": (-18, 0, 0), "head": (-18, 0, 0), **FIST,
    },
    feet={"l": Foot(0.24, -0.02, heel=26, out=4), "r": Foot(-0.24, 0.06, heel=28, out=4)},
    hands={"l": (0.16, -0.70, 0.075), "r": (-0.16, -0.70, 0.075)},
)

# Receiver's two-point stance: staggered, outside foot back, chest over the front knee.
STANCES["wr_2pt"] = Pose(
    pelvis={"forward": -0.13, "up": -0.14, "flex": 26, "twist": -6},
    joints={
        "spine_02": (8, 0, 0), "spine_03": (6, 0, 0), "neck_01": (-14, 0, 0), "head": (-8, 0, 0),
        "upperarm_l": (30, -34, 0), "forearm_l": (70, 0, 0),
        "upperarm_r": (10, -30, 0), "forearm_r": (55, 0, 0), **OPEN,
    },
    feet={"l": Foot(0.10, -0.22, heel=10, out=0), "r": Foot(-0.13, 0.28, heel=34, out=6)},
)

# Linebacker ready: square, feet a bit wider than the shoulders, hips down, hands up.
STANCES["lb_ready"] = Pose(
    pelvis={"forward": -0.07, "up": -0.20, "flex": 30},
    joints={
        "spine_02": (8, 0, 0), "spine_03": (4, 0, 0), "neck_01": (-16, 0, 0), "head": (-10, 0, 0),
        "upperarm_l": (40, -26, 0), "forearm_l": (78, 0, 0),
        "upperarm_r": (40, -26, 0), "forearm_r": (78, 0, 0), **OPEN,
    },
    feet={"l": Foot(0.26, -0.08, heel=14, out=8), "r": Foot(-0.26, -0.06, heel=14, out=8)},
)

# Defensive back (off coverage): on the balls of the feet, one foot back, chest over the toes.
STANCES["db_ready"] = Pose(
    pelvis={"forward": -0.11, "up": -0.17, "flex": 32},
    joints={
        "spine_02": (10, 0, 0), "spine_03": (6, 0, 0), "neck_01": (-18, 0, 0), "head": (-10, 0, 0),
        "upperarm_l": (24, -32, 0), "forearm_l": (70, 0, 0),
        "upperarm_r": (24, -32, 0), "forearm_r": (70, 0, 0), **OPEN,
    },
    feet={"l": Foot(0.17, -0.18, heel=24, out=2), "r": Foot(-0.17, 0.10, heel=30, out=4)},
)

# Running back (I-formation / offset): hands on the thighs, eyes up.
STANCES["rb_2pt"] = Pose(
    pelvis={"forward": -0.06, "up": -0.18, "flex": 40},
    joints={"spine_02": (10, 0, 0), "spine_03": (8, 0, 0), "neck_01": (-24, 0, 0), "head": (-16, 0, 0), **OPEN},
    feet={"l": Foot(0.19, -0.10, heel=12, out=6), "r": Foot(-0.19, -0.10, heel=12, out=6)},
    hands={"l": (0.16, -0.14, 0.66), "r": (-0.16, -0.14, 0.66)},
)

# Quarterback under center: knees bent, hands under the center (at his crotch height).
STANCES["qb_center"] = Pose(
    pelvis={"forward": -0.11, "up": -0.16, "flex": 34},
    joints={"spine_02": (12, 0, 0), "spine_03": (8, 0, 0), "neck_01": (-14, 0, 0), "head": (-12, 0, 0), **OPEN},
    feet={"l": Foot(0.20, -0.06, heel=8, out=8), "r": Foot(-0.20, -0.04, heel=8, out=8)},
    hands={"l": (0.03, -0.31, 0.66), "r": (-0.03, -0.3, 0.63)},
)

# Quarterback in the shotgun: upright, knees soft, hands out for the snap.
STANCES["qb_gun"] = Pose(
    pelvis={"up": -0.07, "flex": 14},
    joints={
        "spine_02": (6, 0, 0), "neck_01": (-6, 0, 0),
        "upperarm_l": (36, -34, 0), "forearm_l": (50, 0, 0),
        "upperarm_r": (36, -34, 0), "forearm_r": (50, 0, 0), **OPEN,
    },
    feet={"l": Foot(0.18, -0.10, heel=6, out=6), "r": Foot(-0.18, -0.08, heel=6, out=6)},
)

# The huddle: bent at the waist, hands on the knees, listening.
STANCES["huddle"] = Pose(
    pelvis={"forward": -0.09, "up": -0.12, "flex": 60},
    joints={"spine_02": (8, 0, 0), "spine_03": (6, 0, 0), "neck_01": (-22, 0, 0), "head": (-10, 0, 0), **OPEN},
    feet={"l": Foot(0.20, -0.10, out=10), "r": Foot(-0.20, -0.10, out=10)},
    # Hands on the lower thighs, just above the knees (knees at ~0.47 m).
    hands={"l": (0.16, -0.1, 0.57), "r": (-0.16, -0.1, 0.57)},
)

"""The football skeleton: one rig for every player (TECH_PLAN §9.1).

Blender coordinates, meters: Z up, the character faces -Y (glTF export turns
that into +Z forward, Y up, which is three's convention), and the character's
left is +X. Rest pose is an A-pose (upper arms 45 degrees down), which deforms
the shoulders better than a T-pose.

Proportions are a 1.88 m, 98 kg (6'2", 215 lb) skill-position athlete, the
middle of the roster. Everyone else is this body scaled (height) and shaped
(blend shapes, weight) at runtime. Segment lengths follow standard
anthropometric ratios (Drillis & Contini: thigh 0.245 H, shank 0.246 H,
upper arm 0.186 H, forearm 0.146 H, hand 0.108 H, foot 0.152 H), with the
joint heights rounded to what reads right on a padded athlete.

Bones that the runtime drives by name are listed in RUNTIME_BONES and mirrored
in src/anim/skeleton.ts (a test checks the exported file against it).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

HEIGHT = 1.88

# Joint positions (x, y, z). Left side only; the right side mirrors x.
_A = math.radians(45.0)  # A-pose: upper arm 45 degrees below horizontal
_SHOULDER = (0.195, 0.015, 1.505)
_UPPER_ARM = 0.30
_FOREARM = 0.268
_ELBOW = (_SHOULDER[0] + _UPPER_ARM * math.cos(_A), 0.035, _SHOULDER[2] - _UPPER_ARM * math.sin(_A))
_WRIST = (_ELBOW[0] + _FOREARM * math.cos(_A), 0.02, _ELBOW[2] - _FOREARM * math.sin(_A))


def _along(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _hand_frame():
    """Directions for the hand: along the arm, the palm faces the thigh (-X side of the hand)."""
    d = [math.cos(_A), 0.0, -math.sin(_A)]
    return d


J: dict[str, tuple[float, float, float]] = {
    "root": (0.0, 0.0, 0.0),
    "pelvis": (0.0, 0.01, 1.00),
    "spine_01": (0.0, 0.015, 1.10),
    "spine_02": (0.0, 0.02, 1.21),
    "spine_03": (0.0, 0.015, 1.33),
    "spine_04": (0.0, 0.005, 1.44),
    "neck_01": (0.0, 0.02, 1.575),
    "neck_02": (0.0, 0.01, 1.625),
    "head": (0.0, 0.0, 1.675),
    "head_end": (0.0, 0.0, 1.88),
    "clavicle_l": (0.035, -0.005, 1.515),
    "shoulder_l": _SHOULDER,
    "elbow_l": _ELBOW,
    "wrist_l": _WRIST,
    "hip_l": (0.098, 0.01, 0.975),
    "knee_l": (0.108, -0.012, 0.52),
    "ankle_l": (0.112, 0.03, 0.085),
    "ball_l": (0.118, -0.115, 0.022),
    "toe_end_l": (0.12, -0.19, 0.018),
}

_hd = _hand_frame()


def _hand(off_along: float, off_side: float, off_fwd: float, off_down: float = 0.0):
    w = J["wrist_l"]
    # Along the forearm (in the XZ plane), forward (-Y is the thumb side),
    # and palm-ward: perpendicular to the forearm, toward the thigh.
    return (
        w[0] + _hd[0] * off_along - math.sin(_A) * off_down,
        w[1] + off_fwd,
        w[2] + _hd[2] * off_along - math.cos(_A) * off_down,
    )


# Hand: palm toward the thigh, thumb forward (-Y). Two finger chains carry
# four fingers: the index on its own, and middle, ring and pinky together on
# "fingers" (they close and open as one in every hand state we key). The
# chain sits between the middle and ring fingers so all three bind to it.
# Knuckle spacing ~19 mm and finger lengths from hand anthropometry (a hand
# ~0.19 m long: middle finger the longest, pinky ~80% of it).
FINGERS = {
    # name: (offset toward the pinky side (m), knuckle along, finger length)
    "index": (-0.026, 0.093, 0.094),
    "middle": (-0.007, 0.096, 0.100),
    "ring": (0.012, 0.093, 0.094),
    "pinky": (0.029, 0.087, 0.076),
}
J.update(
    {
        "hand_end_l": _hand(0.095, 0, 0),
        "thumb_01_l": _hand(0.022, 0, -0.030, 0.012),
        "thumb_02_l": _hand(0.055, 0, -0.047, 0.020),
        "thumb_03_l": _hand(0.083, 0, -0.056, 0.024),
        "thumb_end_l": _hand(0.107, 0, -0.060, 0.026),
    }
)
for _f, (_off, _k, _len) in FINGERS.items():
    # Phalanges ~0.45 / 0.30 / 0.25 of the finger.
    for _n, _t in (("01", 0.0), ("02", 0.45), ("03", 0.75), ("end", 1.0)):
        J[f"{_f}_{_n}_l"] = _hand(_k + _len * _t, 0, _off)
# The shared chain for middle, ring and pinky.
for _n in ("01", "02", "03", "end"):
    J[f"fingers_{_n}_l"] = tuple((J[f"middle_{_n}_l"][i] + J[f"ring_{_n}_l"][i]) / 2 for i in range(3))

# Twist joints sit part-way along their segment.
J["upperarm_twist_l"] = _along(J["shoulder_l"], J["elbow_l"], 0.5)
J["forearm_twist_l"] = _along(J["elbow_l"], J["wrist_l"], 0.6)
J["thigh_twist_l"] = _along(J["hip_l"], J["knee_l"], 0.5)
J["calf_twist_l"] = _along(J["knee_l"], J["ankle_l"], 0.5)
# Shoulder pad spring bones (secondary motion) ride on top of the shoulder.
J["pad_l"] = (0.17, 0.01, 1.56)
J["pad_end_l"] = (0.24, 0.01, 1.57)


def _mirror():
    for k in list(J):
        if k.endswith("_l"):
            x, y, z = J[k]
            J[k[:-2] + "_r"] = (-x, y, z)


_mirror()


@dataclass(frozen=True)
class Bone:
    name: str
    parent: str | None
    head: str
    tail: str
    deform: bool = True


def _side(bones: list[Bone], s: str) -> None:
    def b(name, parent, head, tail, deform=True):
        bones.append(Bone(f"{name}_{s}", f"{parent}_{s}" if parent and not parent.startswith("=") else (parent[1:] if parent else None), f"{head}_{s}", f"{tail}_{s}", deform))

    b("clavicle", "=spine_04", "clavicle", "shoulder")
    b("upperarm", "clavicle", "shoulder", "elbow")
    b("upperarm_twist", "upperarm", "upperarm_twist", "elbow")
    b("forearm", "upperarm", "elbow", "wrist")
    b("forearm_twist", "forearm", "forearm_twist", "wrist")
    b("hand", "forearm", "wrist", "hand_end")
    for f in ("thumb", "index", "fingers"):
        b(f"{f}_01", "hand", f"{f}_01", f"{f}_02")
        b(f"{f}_02", f"{f}_01", f"{f}_02", f"{f}_03")
        b(f"{f}_03", f"{f}_02", f"{f}_03", f"{f}_end")
    b("pad", "=spine_04", "pad", "pad_end")
    b("thigh", "=pelvis", "hip", "knee")
    b("thigh_twist", "thigh", "thigh_twist", "knee")
    b("calf", "thigh", "knee", "ankle")
    b("calf_twist", "calf", "calf_twist", "ankle")
    b("foot", "calf", "ankle", "ball")
    b("toe", "foot", "ball", "toe_end")


def bones() -> list[Bone]:
    out = [
        Bone("root", None, "root", "pelvis", deform=False),
        Bone("pelvis", "root", "pelvis", "spine_01"),
        Bone("spine_01", "pelvis", "spine_01", "spine_02"),
        Bone("spine_02", "spine_01", "spine_02", "spine_03"),
        Bone("spine_03", "spine_02", "spine_03", "spine_04"),
        Bone("spine_04", "spine_03", "spine_04", "neck_01"),
        Bone("neck_01", "spine_04", "neck_01", "neck_02"),
        Bone("neck_02", "neck_01", "neck_02", "head"),
        Bone("head", "neck_02", "head", "head_end"),
    ]
    _side(out, "l")
    _side(out, "r")
    return out


# Bones the runtime addresses by name (IK chains, look-at, lean, springs).
RUNTIME_BONES = [
    "root", "pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "neck_01", "neck_02", "head",
    *[f"{b}_{s}" for s in ("l", "r") for b in (
        "clavicle", "upperarm", "upperarm_twist", "forearm", "forearm_twist", "hand",
        "thigh", "thigh_twist", "calf", "calf_twist", "foot", "toe", "pad",
    )],
]

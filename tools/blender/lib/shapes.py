"""Body-type blend shapes, as displacement fields over the rest pose.

Every mesh piece (skin, jersey, pants...) gets the same field, so gear moves
with the body underneath it. The runtime mixes them from each player's
height and weight (src/render/players): `heavy` for a big frame (linemen),
`lean` for a slight one (corners, receivers), `belly` for the lineman gut.

Amounts are meters of surface offset at weight 1, chosen so the extremes
bracket the roster: a 6'5" 340 lb tackle sits near heavy 1 + belly 0.8, and a
5'9" 175 lb corner near lean 1 (see src/render/players/bodyShape.ts).
"""

from __future__ import annotations

import math

from mathutils import Vector

from .geo import smoothstep

# How much each part follows the body shape (helmets and facemasks don't grow).
PART_FOLLOW = {0: 1.0, 1: 0.35, 2: 0.7, 3: 0.15, 4: 1.0, 5: 1.0, 6: 0.0, 7: 0.0}


def _mass_region(p: Vector) -> float:
    """Where a heavier frame carries its mass: torso and thighs most, forearms and shins less, the head barely."""
    torso = smoothstep(0.80, 0.95, p.z) * (1 - smoothstep(1.58, 1.66, p.z))
    near_axis = 1 - smoothstep(0.22, 0.34, abs(p.x))
    legs = (0.55 + 0.45 * smoothstep(0.1, 0.9, p.z)) if p.z < 0.9 else 0.0
    arms = 0.55 if abs(p.x) > 0.24 and p.z > 0.9 else 0.0
    neck = 0.5 if 1.56 < p.z < 1.70 and abs(p.x) < 0.09 else 0.0
    return max(torso * near_axis, legs, arms, neck)


def heavy(p: Vector, n: Vector) -> Vector:
    return n * (0.030 * _mass_region(p))


def lean(p: Vector, n: Vector) -> Vector:
    return n * (-0.012 * _mass_region(p))


def belly(p: Vector, n: Vector) -> Vector:
    if not 0.9 < p.z < 1.45 or abs(p.x) > 0.26:
        return Vector((0, 0, 0))
    bump = math.sin(math.pi * (p.z - 0.9) / 0.55) ** 1.5
    front = smoothstep(0.02, -0.08, p.y)
    side = 1 - smoothstep(0.08, 0.22, abs(p.x))
    return Vector((0, -1, 0)) * (0.085 * bump * front * side) + n * (0.012 * bump)


SHAPES = {"heavy": heavy, "lean": lean, "belly": belly}

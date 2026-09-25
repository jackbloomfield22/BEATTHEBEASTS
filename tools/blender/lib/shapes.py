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

# How much each part follows the body shape (helmets, masks, visor and the
# chin strap don't grow; gloves and cleats a little; the official's shirt does, his cap doesn't).
PART_FOLLOW = {0: 1.0, 1: 0.35, 2: 0.7, 3: 0.15, 4: 1.0, 5: 1.0, 6: 0.0, 7: 0.0, 8: 0.0, 9: 0.0, 10: 0.0, 11: 0.0, 12: 0.0, 13: 0.8, 14: 1.0, 15: 1.0, 16: 0.0}
JERSEY, SKIN, SOCK, COLLAR = 4, 0, 2, 14


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


# --- Per-player variety (M4.5): each is independent of the frame shapes
# above, so two players of the same weight still differ. The runtime drives
# them from position and a seeded pick (src/render/players/variety.ts).


def pads(p: Vector, n: Vector, part: int = JERSEY) -> Vector:
    """Shoulder-pad size: + a lineman's big pads (wider, higher caps), - a
    receiver's slim pads. Jersey and its collar only."""
    if part not in (JERSEY, COLLAR) or p.z < 1.30:
        return Vector((0, 0, 0))
    w = smoothstep(1.30, 1.48, p.z) * smoothstep(0.06, 0.20, abs(p.x))
    out = Vector((p.x, 0, 0)).normalized() if abs(p.x) > 1e-4 else Vector((0, 0, 0))
    return (n * 0.022 + out * 0.018 + Vector((0, 0, 0.012)) * smoothstep(1.50, 1.58, p.z)) * w


def neck(p: Vector, n: Vector, part: int = SKIN) -> Vector:
    """A thicker neck and heavier traps (linemen, linebackers)."""
    if part not in (SKIN, COLLAR) or not 1.48 < p.z < 1.74 or abs(p.x) > 0.19:
        return Vector((0, 0, 0))
    w = smoothstep(1.48, 1.56, p.z) * (1 - smoothstep(1.68, 1.74, p.z))
    return n * (0.014 * w)


def waist(p: Vector, n: Vector, part: int = SKIN) -> Vector:
    """A thicker waist and trunk (+) or a narrow, cut one (-)."""
    if not 0.95 < p.z < 1.32 or abs(p.x) > 0.25:
        return Vector((0, 0, 0))
    return n * (0.018 * math.sin(math.pi * (p.z - 0.95) / 0.37))


def calves(p: Vector, n: Vector, part: int = SKIN) -> Vector:
    """Fuller calves, mostly behind."""
    if part not in (SKIN, SOCK) or not 0.12 < p.z < 0.50:
        return Vector((0, 0, 0))
    bump = math.sin(math.pi * (p.z - 0.12) / 0.38)
    back = 0.5 + 0.5 * smoothstep(-0.02, 0.05, p.y)
    return n * (0.012 * bump * back)


def arms(p: Vector, n: Vector, part: int = SKIN) -> Vector:
    """Bigger arms: deltoids, biceps, triceps and forearms (sleeves follow)."""
    if abs(p.x) < 0.22 or p.z < 0.95 or p.z > 1.60:
        return Vector((0, 0, 0))
    return n * 0.010


SHAPES = {"heavy": heavy, "lean": lean, "belly": belly, "pads": pads, "neck": neck, "waist": waist, "calves": calves, "arms": arms}
# The variety shapes read the part id (the frame shapes apply to everything).
PART_AWARE = {"pads", "neck", "waist", "calves", "arms"}

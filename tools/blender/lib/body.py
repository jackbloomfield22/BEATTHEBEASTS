"""The base athlete's body: lofted parts fused by a voxel remesh.

All shapes are ours, scripted from the skeleton's joints (no scanned or
downloaded body). Most of a football player is gear, so the body is shaped
for what shows: neck, arms, a face inside the facemask, and the limb
silhouettes the gear is built over. Ring sizes are half-widths in meters,
sized for the 1.88 m / 98 kg base (a chest about 1.06 m around, an upper
arm about 0.38 m, a thigh about 0.62 m: typical for a pro skill player).
"""

from __future__ import annotations

import math

from mathutils import Vector

from .geo import Ring, ellipsoid, loft, union_remesh
from .skeleton import J, _A


def _lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


# (z, half-width, half-depth, y offset: + is back, back-flattening)
# An athlete's V-taper: hips ~0.33 m across, waist ~0.29, lats and chest ~0.41.
TORSO = [
    (0.84, 0.110, 0.080, 0.012, 0.0),
    (0.90, 0.155, 0.108, 0.018, 0.0),
    (0.96, 0.168, 0.118, 0.022, 0.1),  # hips and glutes
    (1.03, 0.160, 0.110, 0.012, 0.15),
    (1.10, 0.146, 0.102, 0.002, 0.2),  # waist
    (1.19, 0.154, 0.108, -0.008, 0.25),
    (1.29, 0.176, 0.120, -0.014, 0.3),  # lower chest
    (1.39, 0.200, 0.126, -0.012, 0.3),  # chest, lats
    (1.47, 0.204, 0.116, -0.002, 0.25),
    (1.52, 0.182, 0.098, 0.008, 0.2),  # shoulder line
    (1.555, 0.13, 0.080, 0.014, 0.1),  # trapezius slope
    (1.585, 0.068, 0.062, 0.018, 0.0),
]


def torso(name="torso", z0: float = 0.0, z1: float = 9.0, grow: float = 0.0, base: Ring | None = None):
    """The torso loft, optionally only the rings between z0 and z1, inflated by
    `grow` (gear shells), and started from a `base` ring (tapers a shell's end)."""
    rows = [r for r in TORSO if z0 <= r[0] <= z1]
    rings = ([base] if base else []) + [Ring((0, y, z), w + grow, d + grow, squash=s) for z, w, d, y, s in rows]
    return loft(name, rings, side_hint=(1, 0, 0), segs=40)


def neck():
    return loft("neck", [Ring((0, 0.022, 1.50), 0.070), Ring((0, 0.018, 1.60), 0.066), Ring((0, 0.008, 1.70), 0.058)], segs=20)


def head():
    parts = [
        ellipsoid("cranium", (0, 0.004, 1.775), (0.077, 0.097, 0.108), segs=28),
        ellipsoid("jaw", (0, -0.022, 1.708), (0.056, 0.055, 0.048), segs=20),
        ellipsoid("chin", (0, -0.060, 1.688), (0.022, 0.016, 0.020), segs=12),
        ellipsoid("nose", (0, -0.092, 1.755), (0.009, 0.014, 0.020), segs=12),
        ellipsoid("brow", (0, -0.080, 1.792), (0.055, 0.015, 0.012), segs=16),
    ]
    for s in (1, -1):
        parts.append(ellipsoid("ear", (0.075 * s, 0.010, 1.765), (0.010, 0.020, 0.028), segs=12))
        parts.append(ellipsoid("cheek", (0.042 * s, -0.064, 1.738), (0.022, 0.017, 0.018), segs=12))
    return parts


def arm(s: str):
    sh, el, wr = Vector(J[f"shoulder_{s}"]), Vector(J[f"elbow_{s}"]), Vector(J[f"wrist_{s}"])
    inner = sh + (sh - el).normalized() * 0.05  # start inside the torso
    rings = [
        Ring(inner, 0.058),
        Ring(sh, 0.066, 0.062),
        Ring(sh.lerp(el, 0.18), 0.066, 0.060),  # deltoid
        Ring(sh.lerp(el, 0.5), 0.058, 0.054),  # biceps
        Ring(sh.lerp(el, 0.85), 0.047, 0.044),
        Ring(el, 0.043, 0.042),
        Ring(el.lerp(wr, 0.22), 0.047, 0.043),  # forearm flexors
        Ring(el.lerp(wr, 0.6), 0.038, 0.032),
        Ring(wr, 0.029, 0.021),
    ]
    # Width across the arm is front-back (Y) so the forearm reads flat at the wrist.
    return loft(f"arm_{s}", rings, side_hint=(0, 1, 0), segs=20)


def hand(s: str):
    sg = 1 if s == "l" else -1
    wr = Vector(J[f"wrist_{s}"])
    d = Vector((math.cos(_A) * sg, 0, -math.sin(_A)))
    palm_n = Vector((-math.sin(_A) * sg, 0, -math.cos(_A)))  # palm normal, toward the thigh
    parts = [
        loft(
            f"palm_{s}",
            [Ring(wr - d * 0.01, 0.027, 0.018), Ring(wr + d * 0.04, 0.042, 0.017), Ring(wr + d * 0.09, 0.044, 0.014)],
            side_hint=(0, 1, 0),
            segs=16,
        )
    ]
    for f, r, fw in (("index", 0.0105, None), ("fingers", 0.0105, 0.027), ("thumb", 0.012, None)):
        pts = [J[f"{f}_01_{s}"], J[f"{f}_02_{s}"], J[f"{f}_03_{s}"], J[f"{f}_end_{s}"]]
        rings = [Ring(p, fw if fw else r, r) for p in pts]
        parts.append(loft(f"{f}_{s}", rings, side_hint=(0, 1, 0), segs=12))
    # Slight cupping: the palm's heel (thenar) pad.
    parts.append(ellipsoid(f"thenar_{s}", tuple(wr + d * 0.035 + palm_n * 0.008 + Vector((0, -0.018, 0))), (0.018, 0.018, 0.018), segs=12))
    return parts


def leg(s: str):
    hp, kn, an = Vector(J[f"hip_{s}"]), Vector(J[f"knee_{s}"]), Vector(J[f"ankle_{s}"])
    # Start inside the pelvis so the thigh grows out of the hip, not over it.
    top = hp + (hp - kn).normalized() * 0.08 + Vector((-0.035 if s == "l" else 0.035, 0, 0))
    rings = [
        Ring(top, 0.070, 0.085),
        Ring(hp + Vector((-0.012 if s == "l" else 0.012, 0, 0)), 0.088, 0.098),
        Ring(hp.lerp(kn, 0.3), 0.092, 0.090, squash=0.1),  # quads, hamstrings
        Ring(hp.lerp(kn, 0.7), 0.074, 0.072, squash=0.1),
        Ring(kn, 0.056, 0.056),
        Ring(kn.lerp(an, 0.25), 0.060, 0.062, squash=0.25),  # calf, fuller behind
        Ring(kn.lerp(an, 0.55), 0.048, 0.048, squash=0.2),
        Ring(an, 0.034, 0.036),
    ]
    return loft(f"leg_{s}", rings, side_hint=(1, 0, 0), segs=24)


def foot(s: str):
    x = J[f"ankle_{s}"][0]
    rings = [
        Ring((x, 0.068, 0.045), 0.030, 0.030),  # heel
        Ring((x, 0.030, 0.052), 0.038, 0.046),
        Ring((x * 1.02, -0.045, 0.036), 0.045, 0.030),
        Ring((x * 1.04, -0.115, 0.026), 0.050, 0.022),  # ball
        Ring((x * 1.05, -0.170, 0.020), 0.038, 0.016),
        Ring((x * 1.05, -0.192, 0.018), 0.018, 0.010),
    ]
    return loft(f"foot_{s}", rings, side_hint=(1, 0, 0), segs=16)


def build_body(voxel: float = 0.005):
    parts = [torso(), neck(), *head()]
    for s in ("l", "r"):
        parts += [arm(s), *hand(s), leg(s), foot(s)]
    return union_remesh(parts, "body", voxel=voxel, smooth_iters=12)

"""Football gear, built around the skeleton like the body: jersey over
shoulder pads, pants with thigh and knee pads, helmet shell and facemask,
cleats. Gloves and socks are regions of the body mesh (a tight fabric over
the hand and calf reads the same and costs nothing).

Sizes: a modern helmet shell is ~0.25 m wide and ~0.30 m deep outside; pads
push the shoulder line to ~0.54 m across (vs ~0.41 m bare); game pants are
padded and end just below the knee.
"""

from __future__ import annotations

import math

from mathutils import Vector

from .body import torso
from .geo import Ring, delete_verts, ellipsoid, loft, smoothstep, tube_path, union_remesh
from .skeleton import J

# Part ids, written to TEXCOORD_0.x as id / PART_SCALE (the runtime shader
# styles each part; one mesh and one draw call per player).
PART_SCALE = 16.0
PARTS = {"skin": 0, "glove": 1, "sock": 2, "cleat": 3, "jersey": 4, "pants": 5, "helmet": 6, "facemask": 7}


def _v(k):
    return Vector(J[k])


def along_upper_arm(co, s):
    """How far along the upper arm (0 shoulder, 1 elbow) a point sits, and its distance from the arm axis."""
    a, b = _v(f"shoulder_{s}"), _v(f"elbow_{s}")
    ab = b - a
    t = (Vector(co) - a).dot(ab) / ab.length_squared
    return t, (Vector(co) - (a + ab * t)).length


SLEEVE_END = 0.5  # fraction of the upper arm the sleeve covers
PANTS_HEM_Z = 0.44  # just under the knee (knee joint at 0.52)
PANTS_TOP_Z = 1.13


def jersey(voxel=0.006):
    # The torso shell: the body's rings, inflated for fabric over pads.
    body_torso = torso("jersey_torso")
    parts = [body_torso]
    # Scale that shell outward about the torso axis (fabric + chest/back plates).
    for v in body_torso.data.vertices:
        z = v.co.z
        grow = 0.018 + 0.03 * smoothstep(1.2, 1.45, z)  # plates bulk up the chest and back
        r = Vector((v.co.x, v.co.y - 0.0, 0))
        if r.length > 1e-4:
            v.co += r.normalized() * grow
    # Shoulder pads: arched caps over each shoulder, joined across the back and chest.
    for sx in (1, -1):
        parts.append(ellipsoid("pad_cap", (0.165 * sx, 0.002, 1.54), (0.135, 0.158, 0.066), segs=28))
        parts.append(ellipsoid("pad_flap", (0.21 * sx, 0.0, 1.49), (0.075, 0.12, 0.06), segs=20))
        # Sleeve: from under the pad to half the upper arm.
        sh, el = _v(f"shoulder_{sx > 0 and 'l' or 'r'}"), _v(f"elbow_{sx > 0 and 'l' or 'r'}")
        parts.append(loft("sleeve", [Ring(sh - (el - sh).normalized() * 0.04, 0.085), Ring(sh.lerp(el, 0.2), 0.082, 0.078), Ring(sh.lerp(el, SLEEVE_END + 0.06), 0.071, 0.066)], side_hint=(0, 1, 0), segs=20))
    parts.append(loft("pad_arch", [Ring((0, 0.008, 1.50), 0.24, 0.155), Ring((0, 0.010, 1.555), 0.235, 0.150), Ring((0, 0.014, 1.595), 0.14, 0.10)], segs=40))
    ob = union_remesh(parts, "jersey", voxel=voxel, smooth_iters=10)
    neck_r = 0.082

    def cut(co):
        if co.z < 0.99:
            return True  # tucked into the pants
        if co.z > 1.555 and math.hypot(co.x, co.y - 0.015) < neck_r:
            return True  # collar opening
        for s in ("l", "r"):
            t, _ = along_upper_arm(co, s)
            if t > SLEEVE_END + 0.05 and (co.x > 0) == (s == "l") and abs(co.x) > 0.2:
                return True  # sleeve opening
        return co.z > 1.62

    delete_verts(ob, cut)
    return ob


def pants(voxel=0.006):
    t = torso("pants_hips")
    for v in t.data.vertices:
        r = Vector((v.co.x, v.co.y, 0))
        if r.length > 1e-4:
            v.co += r.normalized() * 0.028
    parts = [t]
    for s in ("l", "r"):
        hp, kn = _v(f"hip_{s}"), _v(f"knee_{s}")
        top = hp + (hp - kn).normalized() * 0.08 + Vector((-0.035 if s == "l" else 0.035, 0, 0))
        parts.append(
            loft(
                "pant_leg",
                [
                    Ring(top, 0.09, 0.10),
                    Ring(hp, 0.112, 0.118),
                    Ring(hp.lerp(kn, 0.35), 0.110, 0.108),  # thigh pad
                    Ring(hp.lerp(kn, 0.75), 0.092, 0.090),
                    Ring(kn, 0.078, 0.084),  # knee pad
                    Ring(kn + (kn - hp).normalized() * 0.10, 0.070, 0.072),
                ],
                side_hint=(1, 0, 0),
                segs=24,
            )
        )
    ob = union_remesh(parts, "pants", voxel=voxel, smooth_iters=10)
    delete_verts(ob, lambda co: co.z > PANTS_TOP_Z or co.z < PANTS_HEM_Z)
    return ob


def helmet(voxel=0.005):
    center = Vector((0, 0.012, 1.785))
    shell = ellipsoid("shell", tuple(center), (0.126, 0.150, 0.138), segs=40)
    inner = union_remesh([shell], "helmet", voxel=voxel, smooth_iters=2)

    def cut(co):
        rel = co - center
        if rel.z < -0.125:
            return True
        # Face opening: front, below the brow line; the jaw guards wrap forward on the sides.
        if rel.y < -0.02 and rel.z < 0.025 and abs(rel.x) < 0.085:
            return True
        # Ear/jaw line: the shell's lower edge rises toward the back of the neck.
        if rel.z < -0.08 + 0.10 * smoothstep(0.0, 0.14, rel.y):
            return True
        return False

    delete_verts(inner, cut)
    return inner


def facemask(segs=8, bars=3):
    """Tubes around the face opening: `bars` horizontal bars plus a center bar."""
    c = Vector((0, 0.012, 1.785))
    parts = []
    r = 0.0055
    zs = [0.0, -0.045, -0.085][:bars]
    for dz in zs:
        pts = []
        for k in range(13):
            a = math.radians(-58 + k * (116 / 12))
            # Bars bow out in front of the face, ~3 cm off the shell.
            rr = 0.152 + 0.012 * math.cos(a)
            pts.append(tuple(c + Vector((math.sin(a) * 0.118, -math.cos(a) * rr, dz - 0.012 * (1 - math.cos(a))))))
        parts.append(tube_path("bar", pts, r, segs=segs))
    # Center bar and the side struts to the shell.
    parts.append(tube_path("vbar", [tuple(c + Vector((0, -0.164, 0.012))), tuple(c + Vector((0, -0.166, -0.045))), tuple(c + Vector((0, -0.162, -0.095)))], r, segs=segs))
    for sx in (1, -1):
        parts.append(tube_path("strut", [tuple(c + Vector((0.100 * sx, -0.085, 0.012))), tuple(c + Vector((0.104 * sx, -0.080, -0.060))), tuple(c + Vector((0.095 * sx, -0.065, -0.105)))], r, segs=segs))
    from .geo import join

    return join(parts, "facemask")


def cleats(voxel=0.005):
    parts = []
    for s in ("l", "r"):
        x = J[f"ankle_{s}"][0]
        parts.append(
            loft(
                "shoe",
                [
                    Ring((x, 0.080, 0.050), 0.036, 0.040),
                    Ring((x, 0.040, 0.066), 0.046, 0.062),
                    Ring((x * 1.02, -0.045, 0.048), 0.052, 0.042),
                    Ring((x * 1.04, -0.12, 0.034), 0.056, 0.030),
                    Ring((x * 1.05, -0.185, 0.026), 0.042, 0.022),
                    Ring((x * 1.05, -0.212, 0.022), 0.018, 0.014),
                ],
                side_hint=(1, 0, 0),
                segs=20,
            )
        )
    ob = union_remesh(parts, "cleats", voxel=voxel, smooth_iters=6)
    # Flat sole.
    for v in ob.data.vertices:
        if v.co.z < 0.006:
            v.co.z = 0.004
    return ob

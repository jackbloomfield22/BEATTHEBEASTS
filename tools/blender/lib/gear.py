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

from .body import hand_parts, torso
from .geo import superellipsoid, Ring, cut, delete_verts, ellipsoid, loft, smoothstep, tube_path, union_remesh
from .skeleton import J

# Part ids, written to TEXCOORD_0.x as id / PART_SCALE (the runtime shader
# styles each part; one mesh and one draw call per player).
PART_SCALE = 16.0
PARTS = {
    "skin": 0, "glove": 1, "sock": 2, "cleat": 3, "jersey": 4, "pants": 5, "helmet": 6,
    # Facemask styles (each player shows one; the runtime hides the others):
    # skill (three bars), lineman cage, quarterback two-bar, and the one
    # generic mask the Low LOD carries.
    "mask_skill": 7, "mask_cage": 8, "mask_qb": 9, "mask_low": 10,
    "visor": 11, "strap": 12, "towel": 13, "collar": 14,
    # The official (M6): the striped short-sleeve shirt and the cap. His
    # long pants, shoes and bare skin reuse pants, cleat and skin.
    "shirt": 15, "cap": 16,
    # The character pass: the helmet's rubber edging (dark, satin).
    "helmet_trim": 17,
}


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
    """Closed jersey-over-pads shape; open it with cut_jersey() after decimation."""
    # The torso shell: the body's rings, inflated for fabric, and more over the
    # chest and back plates so the pad caps blend in instead of bulging.
    body_torso = torso("jersey_torso")
    parts = [body_torso]
    for v in body_torso.data.vertices:
        grow = 0.012 + 0.036 * smoothstep(1.22, 1.50, v.co.z)
        r = Vector((v.co.x, v.co.y, 0))
        if r.length > 1e-4:
            v.co += r.normalized() * grow
    # Shoulder pads: a broad, flat plateau over each shoulder (not a dome).
    for sx in (1, -1):
        # A flat-topped cap with squared corners and a defined outer edge
        # (a plain ellipsoid read as a pool float), and the epaulet's lip
        # turning down over the deltoid.
        parts.append(superellipsoid("pad_cap", (0.165 * sx, 0.012, 1.546), (0.128, 0.148, 0.052), plan=0.5, vert=0.45, segs=40))
        parts.append(superellipsoid("pad_lip", (0.268 * sx, 0.012, 1.508), (0.030, 0.132, 0.048), plan=0.6, vert=0.7, segs=24))
        s = "l" if sx > 0 else "r"
        sh, el = _v(f"shoulder_{s}"), _v(f"elbow_{s}")
        parts.append(loft("sleeve", [Ring(sh - (el - sh).normalized() * 0.04, 0.085), Ring(sh.lerp(el, 0.2), 0.082, 0.078), Ring(sh.lerp(el, SLEEVE_END + 0.1), 0.071, 0.066)], side_hint=(0, 1, 0), segs=20))
    # The arch over the back and chest that ties the caps together. It ends in
    # a wide, low neck opening (a raised back read as a hood in profile).
    parts.append(loft("pad_arch", [Ring((0, 0.010, 1.50), 0.235, 0.150), Ring((0, 0.012, 1.550), 0.215, 0.140), Ring((0, 0.014, 1.588), 0.112, 0.100)], segs=40))
    return union_remesh(parts, "jersey", voxel=voxel, smooth_iters=24)


COLLAR_Z = 1.585
JERSEY_HEM_Z = 1.085  # tucked 4.5 cm into the pants (top at 1.13): a deeper tuck pokes out when the trunk twists against the hips


def cut_jersey(ob):
    planes = [((0, 0, JERSEY_HEM_Z), (0, 0, 1)), ((0, 0, COLLAR_Z), (0, 0, 1))]
    for s in ("l", "r"):
        sh, el = _v(f"shoulder_{s}"), _v(f"elbow_{s}")
        planes.append((tuple(sh.lerp(el, SLEEVE_END + 0.05)), tuple((el - sh).normalized())))

    def inside(co):
        if co.z < JERSEY_HEM_Z or co.z > COLLAR_Z:
            return True
        for s in ("l", "r"):
            if (co.x > 0) == (s == "l") and abs(co.x) > 0.2:
                t, _ = along_upper_arm(co, s)
                if t > SLEEVE_END + 0.05:
                    return True
        return False

    cut(ob, planes, inside)


def pants(voxel=0.006):
    """Closed pants shape; open it with cut_pants() after decimation."""
    # The seat and waist: the torso's hip rings, inflated well outside the
    # tucked jersey hem (+0.012), closed so the voxel union keeps it; it
    # starts at 0.90 so there's no skirt between the legs.
    t = torso("pants_hips", 0.90, 1.19, grow=0.034, base=Ring((0, 0.02, 0.855), 0.125, 0.085))
    parts = [t]
    for s in ("l", "r"):
        hp, kn = _v(f"hip_{s}"), _v(f"knee_{s}")
        # The legs start at the hip joint, inside the hip shell, so the shell
        # alone makes the waist and seat (no leg tops poking through it).
        top = hp + Vector((-0.02 if s == "l" else 0.02, 0, -0.01))
        parts.append(
            loft(
                "pant_leg",
                # Game pants are stretch fabric over thigh and knee pads:
                # ~1 cm outside the thigh (body.leg), tapering to a snug
                # band under the knee.
                [
                    Ring(top, 0.090, 0.098),
                    Ring(hp.lerp(kn, 0.12), 0.101, 0.104),
                    Ring(hp.lerp(kn, 0.35), 0.101, 0.099),  # thigh pad
                    Ring(hp.lerp(kn, 0.75), 0.084, 0.082),
                    Ring(kn, 0.070, 0.075),  # knee pad
                    # Snug under the knee, but outside the calf (0.060 / 0.062
                    # there, fuller behind) so the leg never shows through.
                    Ring(kn + (kn - hp).normalized() * 0.10, 0.068, 0.073),
                ],
                side_hint=(1, 0, 0),
                segs=24,
            )
        )
    return union_remesh(parts, "pants", voxel=voxel, smooth_iters=30)


def cut_pants(ob):
    cut(ob, [((0, 0, PANTS_TOP_Z), (0, 0, 1)), ((0, 0, PANTS_HEM_Z), (0, 0, 1))], lambda co: co.z > PANTS_TOP_Z or co.z < PANTS_HEM_Z)


HELMET_CENTER = Vector((0, 0.014, 1.772))
# The shell's outer half-sizes (m): a modern shell is ~0.25-0.26 m wide and
# ~0.30 m long outside, and stands ~0.28 m from its bottom edge to the crown.
HELMET_R = (0.128, 0.150, 0.140)
# The bottom edge, side on: the jaw flap's edge rises from the jaw toward
# the ear (front plane), peaks under the ear, and falls again to the nape
# where the shell flares (back plane): the modern shell's profile.
# Each plane is z = z0 + slope * y; the shell is cut below the lower one.
HELMET_EDGE_FRONT = (1.693, 0.45)
HELMET_EDGE_BACK = (1.700, -0.25)
HELMET_BROW = HELMET_CENTER.z + 0.03
HELMET_SIDE = 0.086  # half-width of the face opening
HELMET_CHAMFER = 0.026  # the opening's top corners, cut at 45 degrees
# Below the cheekbone the jaw flaps close in around the jaw: the opening's
# sides lean in by HELMET_JAW_IN per metre of drop below HELMET_JAW_Z.
HELMET_JAW_Z = 1.738
HELMET_JAW_IN = 0.42


def _helmet_point(u: Vector) -> Vector:
    """A unit-sphere direction to a point on the shell (rest pose, Blender
    frame: the face looks down -Y). An ellipsoid over the crown; below the
    equator the sides fall nearly vertical (a superquadric profile), as a
    real shell's do, instead of rounding in under the ears like a ball. Then
    the shell's features as displacements:
      - the jaw flaps: the lower front of each side runs forward and wraps
        in over the jaw (the face opening is cut between them);
      - the rear flare: the back's lower edge turns out over the nape;
      - the brow bumper: a raised band across the front over the eyes."""
    c = HELMET_CENTER
    rx, ry, rz = HELMET_R
    x, y, z = u
    lat = math.asin(max(-1.0, min(1.0, z)))
    lon = math.atan2(y, x)
    ev = 1.0 if z >= 0 else 0.58
    ep = 0.92

    def f(v: float, e: float) -> float:
        return math.copysign(abs(v) ** e, v)

    px = f(math.cos(lat), ev) * f(math.cos(lon), ep) * rx
    py = f(math.cos(lat), ev) * f(math.sin(lon), ep) * ry
    pz = f(math.sin(lat), ev) * rz
    low = smoothstep(-0.02, -0.11, pz)  # 0 above the cheekbone, 1 at the jaw
    front = smoothstep(-0.02, -0.09, py)  # ahead of the ear
    side = smoothstep(0.045, 0.085, abs(px))
    # Jaw flaps: forward 3 cm at the jaw, wrapping in by up to 12%.
    jaw = low * front * side
    py -= 0.042 * jaw
    px *= 1.0 - 0.12 * jaw * smoothstep(-0.05, -0.12, py)
    # Rear flare over the nape.
    back = smoothstep(0.06, 0.13, py) * smoothstep(-0.07, -0.125, pz)
    py += 0.014 * back
    pz -= 0.006 * back
    # Brow bumper: a 4 mm band above the face opening.
    brow = (1.0 - smoothstep(0.035, 0.05, abs(pz - (HELMET_BROW - c.z) - 0.016))) * smoothstep(-0.07, -0.11, py) * (1.0 - smoothstep(0.07, 0.10, abs(px)))
    n = Vector((px / rx**2, py / ry**2, pz / rz**2)).normalized()
    return c + Vector((px, py, pz)) + n * 0.004 * brow


def helmet(voxel=0.004):
    """Closed helmet shell; open it with cut_helmet() after decimation."""
    import bmesh

    from .geo import new_object

    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=1.0)
    for v in bm.verts:
        v.co = _helmet_point(v.co.normalized())
    shell = new_object("shell", bm)
    return union_remesh([shell], "helmet", voxel=voxel, smooth_iters=2)


def _helmet_bottom(co) -> bool:
    return co.z < min(z0 + k * co.y for z0, k in (HELMET_EDGE_FRONT, HELMET_EDGE_BACK))


def _helmet_face(co) -> bool:
    c = HELMET_CENTER
    ax = abs(co.x)
    jaw = ax - HELMET_SIDE + HELMET_JAW_IN * (HELMET_JAW_Z - co.z)
    return co.y < c.y - 0.02 and co.z < HELMET_BROW and ax < HELMET_SIDE and (ax - HELMET_SIDE) + (co.z - HELMET_BROW) < -HELMET_CHAMFER and jaw < 0


def cut_helmet(ob):
    c = HELMET_CENTER
    chamfer = []
    for sx in (1, -1):
        # The 45-degree corner: |x| + z = side + brow - chamfer.
        n = Vector((sx, 0.0, 1.0)).normalized()
        chamfer.append(((sx * (HELMET_SIDE - HELMET_CHAMFER), 0.0, HELMET_BROW), tuple(n)))
        # The jaw flap's front edge: |x| = side - jaw_in * (jaw_z - z).
        chamfer.append(((sx * HELMET_SIDE, 0.0, HELMET_JAW_Z), tuple(Vector((sx, 0.0, -HELMET_JAW_IN)).normalized())))
    planes = [
        *[((0, 0, z0), tuple(Vector((0.0, -k, 1.0)).normalized())) for z0, k in (HELMET_EDGE_FRONT, HELMET_EDGE_BACK)],
        ((0, 0, HELMET_BROW), (0, 0, 1)),
        ((HELMET_SIDE, 0, 0), (1, 0, 0)),
        ((-HELMET_SIDE, 0, 0), (1, 0, 0)),
        *chamfer,
    ]
    cut(ob, planes, lambda co: _helmet_bottom(co) or _helmet_face(co), region=lambda co: co.z < HELMET_BROW + 0.02 and (co.y < c.y - 0.01 or _helmet_bottom(co + Vector((0, 0, -0.05)))))


def helmet_trim(shell, spacing: float = 0.012, radius: float = 0.0052, segs: int = 6):
    """The rubber edging around the shell's openings (the face and the
    bottom edge): a closed tube along each boundary loop of the cut shell,
    smoothed so a decimated edge doesn't zig-zag. Gives the shell a visible
    thickness and a clean, dark edge, as every real helmet has."""
    import bmesh

    from .geo import new_object

    c = HELMET_CENTER
    rx, ry, rz = HELMET_R
    src = bmesh.new()
    src.from_mesh(shell.data)
    edges = [e for e in src.edges if e.is_boundary]
    nxt: dict = {}
    for e in edges:
        a, b = e.verts
        nxt.setdefault(a, []).append(b)
        nxt.setdefault(b, []).append(a)
    seen = set()
    loops = []
    for start in list(nxt):
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        prev, cur = None, start
        while True:
            cand = [v for v in nxt[cur] if v is not prev and v not in seen]
            if not cand:
                break
            prev, cur = cur, cand[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) > 8:
            loops.append([v.co.copy() for v in loop])
    src.free()
    bm = bmesh.new()
    for pts in loops:
        # Smooth, then resample at even spacing.
        for _ in range(3):
            pts = [(pts[i - 1] + pts[i] * 2 + pts[(i + 1) % len(pts)]) / 4 for i in range(len(pts))]
        length = sum((pts[(i + 1) % len(pts)] - pts[i]).length for i in range(len(pts)))
        n = max(8, int(length / spacing))
        cum = [0.0]
        for i in range(len(pts)):
            cum.append(cum[-1] + (pts[(i + 1) % len(pts)] - pts[i]).length)
        res, j = [], 0
        for k in range(n):
            t = length * k / n
            while cum[j + 1] < t:
                j += 1
            a, b = pts[j], pts[(j + 1) % len(pts)]
            res.append(a.lerp(b, (t - cum[j]) / max(1e-9, cum[j + 1] - cum[j])))
        rings = []
        for k, p in enumerate(res):
            tan = (res[(k + 1) % n] - res[k - 1]).normalized()
            d = p - c
            out = Vector((d.x / rx**2, d.y / ry**2, d.z / rz**2)).normalized()
            out = (out - tan * out.dot(tan)).normalized()
            side = tan.cross(out).normalized()
            ring = []
            for s in range(segs):
                ang = 2 * math.pi * s / segs
                ring.append(bm.verts.new(p + out * (radius * math.cos(ang)) + side * (radius * math.sin(ang))))
            rings.append(ring)
        for k in range(n):
            r0, r1 = rings[k], rings[(k + 1) % n]
            for s in range(segs):
                s2 = (s + 1) % segs
                bm.faces.new((r0[s], r0[s2], r1[s2], r1[s]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object("helmet_trim", bm)


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


def glove(s: str, voxel: float = 0.0028):
    """A receiver-style glove: the hand (body.hand_parts) a millimetre proud,
    with a cuff that overlaps the wrist so the edge is clean."""
    wr, el = _v(f"wrist_{s}"), _v(f"elbow_{s}")
    d = (wr - el).normalized()
    parts = hand_parts(s, grow=0.0012)
    parts.append(loft("cuff", [Ring(wr - d * 0.045, 0.034, 0.028), Ring(wr - d * 0.005, 0.034, 0.027), Ring(wr + d * 0.02, 0.034, 0.024)], side_hint=(0, 1, 0), segs=16))
    return union_remesh(parts, f"glove_{s}", voxel=voxel, smooth_iters=4)


def collar_insert():
    """Closes the jersey's neck opening: the collar band from the neck down
    and out to the jersey's edge (no hollow jersey inside visible)."""
    # The band stands ~1.5 cm proud of the jersey's edge (1.585, ~0.11 x 0.10
    # across) so it reads as a collar.
    rings = [Ring((0, 0.022, 1.545), 0.080, 0.074), Ring((0, 0.022, 1.575), 0.088, 0.081), Ring((0, 0.020, 1.600), 0.100, 0.090)]
    return loft("collar", rings, segs=32, cap=False)


def chin_strap():
    """A hard chin cup on straps that run up to the shell's sides."""
    c = HELMET_CENTER
    parts = [ellipsoid("cup", tuple(c + Vector((0, -0.084, -0.098))), (0.030, 0.018, 0.024), segs=14)]
    for sx in (1, -1):
        parts.append(tube_path("strap", [tuple(c + Vector((0.026 * sx, -0.086, -0.094))), tuple(c + Vector((0.070 * sx, -0.060, -0.082))), tuple(c + Vector((0.104 * sx, -0.030, -0.070)))], 0.0045, segs=6))
    from .geo import join

    return join(parts, "chin_strap")


def visor():
    """A smoked eye shield just inside the facemask across the eye opening."""
    import bmesh

    from .geo import new_object

    c = HELMET_CENTER
    bm = bmesh.new()
    cols, rows = 12, 3
    verts = []
    for j in range(rows + 1):
        z = c.z + 0.030 - 0.058 * j / rows
        row = []
        for i in range(cols + 1):
            a = math.radians(-50 + 100 * i / cols)
            row.append(bm.verts.new((math.sin(a) * 0.110, c.y - math.cos(a) * 0.142, z)))
        verts.append(row)
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    return new_object("visor", bm)


def facemask(segs=8, bars=3, style="skill"):
    """Tubes around the face opening. Styles by position: `skill` (three bars
    and a short center bar between the lower two, so the eyes are open),
    `cage` (a lineman's closed cage: four bars, two uprights and a nose
    bumper, down to the chin), `qb` (two open bars). Every style ends in the
    side struts that run back to the jaw flaps (gear.helmet), where the
    clips hold it (facemask_clips)."""
    c = HELMET_CENTER
    parts = []
    r = 0.0058  # a 1/4-in (6.35 mm) steel bar, about
    zs = {"skill": [0.0, -0.045, -0.085], "cage": [0.012, -0.022, -0.056, -0.092], "qb": [0.0, -0.070]}[style][:bars if style == "skill" else None]
    for dz in zs:
        pts = []
        for k in range(13):
            a = math.radians(-58 + k * (116 / 12))
            # Bars bow out in front of the face, ~3 cm off the shell.
            rr = 0.152 + 0.012 * math.cos(a)
            pts.append(tuple(c + Vector((math.sin(a) * 0.118, -math.cos(a) * rr, dz - 0.012 * (1 - math.cos(a))))))
        parts.append(tube_path("bar", pts, r, segs=segs))
    if style == "cage":
        for sx in (1, -1):
            parts.append(tube_path("upright", [tuple(c + Vector((0.030 * sx, -0.166, 0.016))), tuple(c + Vector((0.032 * sx, -0.168, -0.050))), tuple(c + Vector((0.028 * sx, -0.160, -0.110)))], r, segs=segs))
    elif style == "skill" and len(zs) > 2:
        parts.append(tube_path("vbar", [tuple(c + Vector((0, -0.166, zs[1] + 0.004))), tuple(c + Vector((0, -0.165, (zs[1] + zs[2]) / 2))), tuple(c + Vector((0, -0.163, zs[2] - 0.004)))], r, segs=segs))
    for sx in (1, -1):
        parts.append(tube_path("strut", [tuple(c + Vector((0.100 * sx, -0.085, 0.012))), tuple(c + Vector((0.104 * sx, -0.080, -0.060))), tuple(c + Vector((0.095 * sx, -0.065, -0.105)))], r, segs=segs))
    from .geo import join

    return join(parts, f"facemask_{style}")


def facemask_clips(segs: int = 12):
    """The four clips that hold the mask to the shell: two over the brow on
    the top bar, one on each jaw flap at the strut. Dark rubber blocks."""
    from .geo import join

    c = HELMET_CENTER
    parts = []
    for sx in (1, -1):
        # Over the brow: where the top bar passes the shell's front edge.
        a = math.radians(28)
        rr = 0.152 + 0.012 * math.cos(a)
        parts.append(superellipsoid("clip", tuple(c + Vector((sx * math.sin(a) * 0.118, -math.cos(a) * rr + 0.006, 0.008))), (0.011, 0.010, 0.013), plan=0.4, vert=0.4, segs=segs))
        # On the jaw flap, over the strut's lower end.
        parts.append(superellipsoid("clip", tuple(c + Vector((sx * 0.101, -0.072, -0.092))), (0.009, 0.014, 0.013), plan=0.4, vert=0.4, segs=segs))
    return join(parts, "mask_clips")


def towel():
    """A hand towel tucked into the waistband over the left front pocket
    (a quarterback's or a receiver's), hanging ~19 cm down the thigh.

    The character pass: it was a flat 8 cm slab skinned like the thigh, and
    at speed it read as a white number on the pants. Now it's cloth: the top
    folds over the waistband and tucks behind it, two soft lengthwise folds
    run down it, and it narrows and curls a little at its free end. Its
    weights are set by build_character.towel_weights (the pelvis at the
    tuck, more of the thigh toward the end)."""
    import bmesh

    from .geo import new_object

    bm = bmesh.new()
    cols, rows = 8, 10
    # Down the front of the left thigh: the tuck point and the hang.
    top = Vector((0.112, -0.120, 1.122))
    grid = []
    for j in range(rows + 1):
        v = j / rows
        row = []
        for i in range(cols + 1):
            u = i / cols - 0.5
            # Width 9 cm, narrowing to 7.5 at the end; a fold over the
            # waistband in the first 12% (it goes up over the belt and back
            # down behind it), two soft folds lengthwise.
            w = 0.090 - 0.015 * v
            x = top.x + u * w + 0.010 * v
            z = top.z - 0.19 * v
            y = top.y + 0.013 * v  # the thigh falls away under the hip shell
            fold = 0.0035 * math.cos(u * 2 * math.pi * 1.5) * smoothstep(0.1, 0.4, v)
            curl = 0.006 * smoothstep(0.75, 1.0, v) * (2 * abs(u)) ** 2
            # The body is ~1.2 cm behind the towel's face at the hip and
            # thigh (pants shell): keep it proud of the pants.
            y -= fold + curl
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    # The tuck: a short flap behind the top edge, inside the waistband.
    tuck = [bm.verts.new((grid[0][i].co.x, grid[0][i].co.y + 0.012, grid[0][i].co.z - 0.030)) for i in range(cols + 1)]
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    for i in range(cols):
        bm.faces.new((tuck[i + 1], tuck[i], grid[0][i], grid[0][i + 1]))
    return new_object("towel", bm)


# --- The official (M6) --------------------------------------------------------
# An official wears no pads and no helmet: a short-sleeve shirt that
# follows the body (black-and-white vertical stripes, a black collar; the
# stripes are drawn by the runtime shader, playerMaterial.ts), long pants
# to the shoe, a cap, and shoes. No numbers, names or marks.

SHIRT_HEM_Z = 1.02  # tucked ~11 cm into the pants (top at 1.13)
SHIRT_COLLAR_Z = 1.60  # the crew neck, high on the base of the neck (hides the skin cut)
SHIRT_SLEEVE_END = 0.52  # share of the upper arm the sleeve covers
OFFICIAL_PANTS_HEM_Z = 0.115  # over the shoe's top


def shirt(voxel=0.006):
    """Closed shirt shape; open it with cut_shirt() after decimation. The
    body's torso rings with ~1.2 cm of fabric ease, short sleeves a little
    looser than the arm, and a neck band."""
    t = torso("shirt_torso", 0.96, 1.60, grow=0.012)
    parts = [t]
    for s in ("l", "r"):
        sh, el = _v(f"shoulder_{s}"), _v(f"elbow_{s}")
        # ~0.6-0.8 cm of ease over the deltoid and biceps (body.arm).
        parts.append(loft("sleeve", [Ring(sh - (el - sh).normalized() * 0.05, 0.072), Ring(sh.lerp(el, 0.18), 0.074, 0.069), Ring(sh.lerp(el, SHIRT_SLEEVE_END + 0.1), 0.064, 0.060)], side_hint=(0, 1, 0), segs=20))
        # Over the upper trapezius (body.neck's slopes, 1.2 cm proud), so the
        # shirt runs up the shoulders to the collar instead of the traps
        # showing through it.
        sx = 1.0 if s == "l" else -1.0
        parts.append(loft("trap", [Ring((0.160 * sx, 0.028, 1.515), 0.036, 0.044), Ring((0.110 * sx, 0.032, 1.565), 0.038, 0.044), Ring((0.060 * sx, 0.032, 1.610), 0.034, 0.038)], side_hint=(0, 1, 0), segs=16))
    # The crew collar stands ~1 cm off the neck (body.neck: 0.080 x 0.074 at its base).
    # Deeper behind: the back of the neck and the traps' slope fill it there.
    parts.append(loft("neck_band", [Ring((0, 0.026, 1.52), 0.090, 0.090), Ring((0, 0.031, 1.56), 0.089, 0.096), Ring((0, 0.028, 1.615), 0.087, 0.092)], segs=24))
    return union_remesh(parts, "shirt", voxel=voxel, smooth_iters=18)


def cut_shirt(ob):
    planes = [((0, 0, SHIRT_HEM_Z), (0, 0, 1)), ((0, 0, SHIRT_COLLAR_Z), (0, 0, 1))]
    for s in ("l", "r"):
        sh, el = _v(f"shoulder_{s}"), _v(f"elbow_{s}")
        planes.append((tuple(sh.lerp(el, SHIRT_SLEEVE_END)), tuple((el - sh).normalized())))

    def inside(co):
        if co.z < SHIRT_HEM_Z:
            return True
        if co.z > SHIRT_COLLAR_Z and math.hypot(co.x, co.y - 0.02) < 0.105:
            return True
        for s in ("l", "r"):
            if (co.x > 0) == (s == "l") and abs(co.x) > 0.2:
                t, _ = along_upper_arm(co, s)
                if t > SHIRT_SLEEVE_END:
                    return True
        return False

    cut(ob, planes, inside)


def official_pants(voxel=0.006):
    """Long pants from the waist to the shoe, a straight leg with ~1.5 cm
    of ease over the thigh and more at the calf and hem."""
    t = torso("opants_hips", 0.90, 1.19, grow=0.026, base=Ring((0, 0.02, 0.855), 0.125, 0.085))
    parts = [t]
    for s in ("l", "r"):
        hp, kn, an = _v(f"hip_{s}"), _v(f"knee_{s}"), _v(f"ankle_{s}")
        top = hp + Vector((-0.02 if s == "l" else 0.02, 0, -0.01))
        parts.append(loft("opant_leg", [
            Ring(top, 0.090, 0.098),
            Ring(hp.lerp(kn, 0.3), 0.100, 0.100),
            Ring(hp.lerp(kn, 0.75), 0.082, 0.082),
            Ring(kn, 0.072, 0.074),
            Ring(kn.lerp(an, 0.35), 0.072, 0.076),
            Ring(an + Vector((0, 0.0, 0.03)), 0.060, 0.064),
            Ring(an + Vector((0, 0.0, 0.0)), 0.060, 0.066),
        ], side_hint=(1, 0, 0), segs=24))
    return union_remesh(parts, "official_pants", voxel=voxel, smooth_iters=24)


def cut_official_pants(ob):
    cut(ob, [((0, 0, PANTS_TOP_Z), (0, 0, 1)), ((0, 0, OFFICIAL_PANTS_HEM_Z), (0, 0, 1))], lambda co: co.z > PANTS_TOP_Z or co.z < OFFICIAL_PANTS_HEM_Z)


def cap(voxel=0.003):
    """A ball cap: a crown over the cranium (body.head, ~0.9 cm clear of it)
    with a short curved bill over the brow. Open it with cut_cap()."""
    import bmesh

    from .geo import new_object

    # The band sits on the forehead ~2 cm above the brow (body.head: brow
    # at 1.79) and above the ears, a little lower behind.
    crown = ellipsoid("crown", (0, 0.006, 1.80), (0.085, 0.105, 0.095), segs=36)
    # The bill: a thin plate curving down at its front edge.
    bm = bmesh.new()
    cols, rows = 12, 5
    top, bot = [], []
    for j in range(rows + 1):
        rt, rb = [], []
        v = j / rows
        for i in range(cols + 1):
            # A bill ~7 cm long at the center, tapering to the sides, curved down.
            a = math.radians(-52 + 104 * i / cols)
            ln = 0.072 * math.cos(math.radians(-52 + 104 * i / cols) * 1.65) + 0.004
            x = math.sin(a) * (0.084 + 0.3 * ln * v)
            y = 0.006 - math.cos(a) * 0.100 - ln * v
            z = 1.806 - 0.016 * v * v - 0.004 * (1 - math.cos(a))
            rt.append(bm.verts.new((x, y, z + 0.006)))
            rb.append(bm.verts.new((x, y, z - 0.006)))
        top.append(rt)
        bot.append(rb)
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]))
            bm.faces.new((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1]))
    for j in range(rows):
        for row, i in ((0, 0), (0, cols)):
            bm.faces.new((top[j][i], top[j + 1][i], bot[j + 1][i], bot[j][i]) if i == 0 else (top[j][i], bot[j][i], bot[j + 1][i], top[j + 1][i]))
    for i in range(cols):
        bm.faces.new((top[rows][i], top[rows][i + 1], bot[rows][i + 1], bot[rows][i]))
    bill = new_object("bill", bm)
    return union_remesh([crown, bill], "cap", voxel=voxel, smooth_iters=2)


def cut_cap(ob):
    """Open the crown at the headband (just above the ears, lower behind)."""

    # One tilted plane (a clean edge): 1.805 m over the brow, 1.776 m behind.
    n = Vector((0.0, 0.145, 1.0))

    def below(co):
        return (Vector(co) - Vector((0, 0.006, 1.79))).dot(n) < 0.0

    cut(ob, [((0, 0.006, 1.79), tuple(n))], lambda co: below(co) and co.y > -0.095)

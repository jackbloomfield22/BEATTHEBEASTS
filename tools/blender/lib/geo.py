"""Mesh building blocks: lofted tubes of elliptical rings, voxel unions,
smoothing, decimation. Everything the body and gear scripts need, no
third-party geometry."""

from __future__ import annotations

import math
from typing import Iterable, Sequence

import bmesh
import bpy
from mathutils import Vector

Vec3 = tuple[float, float, float]


def new_object(name: str, bm: bmesh.types.BMesh) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


class Ring:
    """One cross-section: center, half-width along `side`, half-depth along the forward axis."""

    def __init__(self, center: Vec3, w: float, d: float | None = None, squash: float = 0.0):
        self.c = Vector(center)
        self.w = w
        self.d = w if d is None else d
        # squash > 0 flattens the back half of the ring (a flatter back than chest).
        self.squash = squash


def _catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def refine(rings: Sequence[Ring], sub: int) -> list[Ring]:
    """Catmull-Rom through the rings (centers and sizes), `sub` steps per span: smooth lofts, no creases."""
    if sub <= 1 or len(rings) < 3:
        return list(rings)
    out: list[Ring] = []
    n = len(rings)
    for i in range(n - 1):
        r0, r1, r2, r3 = rings[max(i - 1, 0)], rings[i], rings[i + 1], rings[min(i + 2, n - 1)]
        for k in range(sub):
            t = k / sub
            c = _catmull(r0.c, r1.c, r2.c, r3.c, t)
            w = max(0.002, _catmull(r0.w, r1.w, r2.w, r3.w, t))
            d = max(0.002, _catmull(r0.d, r1.d, r2.d, r3.d, t))
            sq = min(0.9, max(0.0, _catmull(r0.squash, r1.squash, r2.squash, r3.squash, t)))
            out.append(Ring(tuple(c), w, d, sq))
    out.append(rings[-1])
    return out


def loft(name: str, rings: Sequence[Ring], side_hint: Vec3 = (1, 0, 0), segs: int = 24, cap: bool = True, sub: int = 3) -> bpy.types.Object:
    """A tube through the ring centers, each ring perpendicular to the path.

    `side_hint` picks the ring's width axis (projected off the path tangent),
    so a torso ring is wide left-right and a thigh ring can be turned.
    """
    rings = refine(rings, sub)
    bm = bmesh.new()
    hint = Vector(side_hint)
    loops = []
    n = len(rings)
    for i, r in enumerate(rings):
        a = rings[max(i - 1, 0)].c
        b = rings[min(i + 1, n - 1)].c
        t = (b - a).normalized()
        side = (hint - t * hint.dot(t)).normalized()
        fwd = t.cross(side).normalized()
        loop = []
        for k in range(segs):
            ang = 2 * math.pi * k / segs
            cx, sy = math.cos(ang), math.sin(ang)
            d = r.d * (1 - r.squash * max(0.0, sy)) if r.squash else r.d
            loop.append(bm.verts.new(r.c + side * (r.w * cx) + fwd * (d * sy)))
        loops.append(loop)
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((loops[i][k], loops[i][k2], loops[i + 1][k2], loops[i + 1][k]))
    if cap:
        for loop, flip in ((loops[0], True), (loops[-1], False)):
            c = bm.verts.new(sum((v.co for v in loop), Vector()) / len(loop))
            for k in range(segs):
                vs = (loop[k], loop[(k + 1) % segs], c)
                bm.faces.new(tuple(reversed(vs)) if flip else vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm)


def ellipsoid(name: str, center: Vec3, radii: Vec3, segs: int = 24) -> bpy.types.Object:
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0] + center[0], v.co.y * radii[1] + center[1], v.co.z * radii[2] + center[2]))
    return new_object(name, bm)


def superellipsoid(name: str, center: Vec3, radii: Vec3, plan: float = 0.45, vert: float = 0.5, segs: int = 32) -> bpy.types.Object:
    """A rounded box: an ellipsoid pushed toward its bounding box. `plan` and
    `vert` are the superquadric exponents (1 = ellipsoid, toward 0 = box):
    squarer corners seen from above, a flatter top with a defined edge."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=1.0)

    def f(c: float, e: float) -> float:
        return math.copysign(abs(c) ** e, c)

    for v in bm.verts:
        x, y, z = v.co
        # Latitude/longitude form of the superquadric keeps the poles clean.
        lat = math.asin(max(-1.0, min(1.0, z)))
        lon = math.atan2(y, x)
        cx = f(math.cos(lat), vert) * f(math.cos(lon), plan)
        cy = f(math.cos(lat), vert) * f(math.sin(lon), plan)
        cz = f(math.sin(lat), vert)
        v.co = Vector((cx * radii[0] + center[0], cy * radii[1] + center[1], cz * radii[2] + center[2]))
    return new_object(name, bm)


def tube_path(name: str, pts: Sequence[Vec3], radius: float, segs: int = 8) -> bpy.types.Object:
    """A constant-radius tube along a polyline (facemask bars)."""
    d = Vector(pts[-1]) - Vector(pts[0])
    hint = (0, 0, 1) if abs(d.z) < 0.5 * d.length else (1, 0, 0)
    return loft(name, [Ring(p, radius) for p in pts], side_hint=hint, segs=segs)


def join(objs: Iterable[bpy.types.Object], name: str) -> bpy.types.Object:
    objs = list(objs)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = objs[0]
    ob.name = name
    ob.data.name = name
    return ob


def apply_modifier(ob: bpy.types.Object, mod: bpy.types.Modifier) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def union_remesh(objs: Iterable[bpy.types.Object], name: str, voxel: float = 0.006, smooth_iters: int = 6) -> bpy.types.Object:
    """Fuse overlapping parts into one clean, manifold skin (voxel remesh), then relax it."""
    ob = join(objs, name)
    m = ob.modifiers.new("remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    m.adaptivity = 0.0
    apply_modifier(ob, m)
    if smooth_iters:
        s = ob.modifiers.new("smooth", "LAPLACIANSMOOTH")
        s.iterations = smooth_iters
        s.lambda_factor = 0.5
        s.use_volume_preserve = True
        apply_modifier(ob, s)
    return ob


def decimate_to(ob: bpy.types.Object, target_tris: int) -> bpy.types.Object:
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > target_tris:
        m = ob.modifiers.new("dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = target_tris / tris
        m.use_collapse_triangulate = True
        apply_modifier(ob, m)
    return ob


def tri_count(ob: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def duplicate(ob: bpy.types.Object, name: str) -> bpy.types.Object:
    o2 = ob.copy()
    o2.data = ob.data.copy()
    o2.name = name
    o2.data.name = name
    bpy.context.scene.collection.objects.link(o2)
    return o2


def delete_verts(ob: bpy.types.Object, pred) -> None:
    """Delete every vertex where pred(co) is true (and the faces that use it)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    dead = [v for v in bm.verts if pred(v.co)]
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


def smoothstep(e0: float, e1: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def cut(ob: bpy.types.Object, planes, inside, region=None) -> None:
    """Open a mesh cleanly: split it along each plane (co, normal), optionally
    only where `region(point)` holds, then delete every face whose center is
    `inside(point)`. Cutting after decimation keeps hems and openings straight
    at every LOD (deleting remeshed vertices leaves stair-steps)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for co, no in planes:
        geom = [f for f in bm.faces if region is None or region(f.calc_center_median())]
        edges = {e for f in geom for e in f.edges}
        verts = {v for f in geom for v in f.verts}
        bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + geom, plane_co=Vector(co), plane_no=Vector(no))
    dead = [f for f in bm.faces if inside(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()

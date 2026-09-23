"""Build the armature from the skeleton spec and bind meshes to it."""

from __future__ import annotations

import bpy
from mathutils import Vector

from .skeleton import J, bones


def build_armature(name: str = "rig") -> bpy.types.Object:
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    for b in bones():
        e = eb.new(b.name)
        e.head = Vector(J[b.head])
        e.tail = Vector(J[b.tail])
        e.use_deform = b.deform
        if b.parent:
            e.parent = eb[b.parent]
            # Chained bones connect when they meet, so IK and FK agree.
            # The pelvis stays free (it translates: crouches, stances, gait bob).
            e.use_connect = b.name != "pelvis" and (e.parent.tail - e.head).length < 1e-4
    # Consistent rolls: every bone's local Z points forward-ish (-Y), so a
    # positive X rotation bends a knee or an elbow the same way on both sides.
    for e in eb:
        e.align_roll(Vector((0, -1, 0)) if abs(e.vector.normalized().y) < 0.9 else Vector((0, 0, 1)))
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def bind(mesh: bpy.types.Object, rig: bpy.types.Object) -> None:
    """Heat-diffusion weights (Blender's automatic weights), then clean them up."""
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    limit_weights(mesh, 4)


def limit_weights(mesh: bpy.types.Object, n: int = 4, floor: float = 0.01) -> None:
    """At most n influences per vertex (glTF and three skin with 4), normalized."""
    groups = mesh.vertex_groups
    for v in mesh.data.vertices:
        every = sorted(((g.weight, g.group) for g in v.groups), reverse=True)
        # Never strip a vertex bare: keep its strongest influence even when all
        # are tiny (the exporter would bind a bare vertex to a placeholder bone).
        ws = [x for x in every if x[0] > floor][:n] or every[:1]
        total = sum(w for w, _ in ws) or 1.0
        keep = {gi for _, gi in ws}
        for g in list(v.groups):
            if g.group not in keep:
                groups[g.group].remove([v.index])
        for w, gi in ws:
            groups[gi].add([v.index], w / total, "REPLACE")


def remap_weights(mesh: bpy.types.Object, mapping: dict[str, str]) -> None:
    """Move every weight on bone A to bone B (e.g. a jersey ignores the neck)."""
    groups = mesh.vertex_groups
    for src, dst in mapping.items():
        if src not in groups:
            continue
        gs = groups[src]
        gd = groups.get(dst) or groups.new(name=dst)
        for v in mesh.data.vertices:
            w = next((g.weight for g in v.groups if g.group == gs.index), 0.0)
            if w > 0:
                cur = next((g.weight for g in v.groups if g.group == gd.index), 0.0)
                gd.add([v.index], cur + w, "REPLACE")
        groups.remove(gs)


def transfer_weights(src: bpy.types.Object, dst: bpy.types.Object, rig: bpy.types.Object) -> None:
    """Skin gear from the body: each gear vertex copies the weights of the nearest body surface."""
    for g in src.vertex_groups:
        if g.name not in dst.vertex_groups:
            dst.vertex_groups.new(name=g.name)
    m = dst.modifiers.new("dt", "DATA_TRANSFER")
    m.object = src
    m.use_vert_data = True
    m.data_types_verts = {"VGROUP_WEIGHTS"}
    m.vert_mapping = "POLYINTERP_NEAREST"
    m.layers_vgroup_select_src = "ALL"
    m.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.select_all(action="DESELECT")
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.modifier_apply(modifier=m.name)
    dst.parent = rig
    am = dst.modifiers.new("rig", "ARMATURE")
    am.object = rig
    limit_weights(dst, 4)


def fill_bare(mesh: bpy.types.Object, deform: set[str]) -> int:
    """Give every vertex with no deform weight the weights of its nearest
    weighted vertex (the weight transfer can come back empty at a tip)."""
    from mathutils.kdtree import KDTree

    names = {g.index: g.name for g in mesh.vertex_groups}

    def ok(v):
        return any(names[g.group] in deform and g.weight > 0 for g in v.groups)

    good = [v for v in mesh.data.vertices if ok(v)]
    bare = [v for v in mesh.data.vertices if not ok(v)]
    if not bare:
        return 0
    kd = KDTree(len(good))
    for i, v in enumerate(good):
        kd.insert(v.co, i)
    kd.balance()
    for v in bare:
        _, i, _ = kd.find(v.co)
        src = good[i]
        for g in list(v.groups):
            mesh.vertex_groups[g.group].remove([v.index])
        for g in src.groups:
            mesh.vertex_groups[g.group].add([v.index], g.weight, "REPLACE")
    return len(bare)


def crotch_weights(mesh: bpy.types.Object, half_width: float = 0.08, top: float = 0.96) -> None:
    """Blend the pants' crotch across the midline: right thigh -> pelvis ->
    left thigh. Nearest-surface transfer gives neighbouring midline vertices
    opposite legs, which tears the seam as soon as the legs spread."""
    from .geo import smoothstep

    g = mesh.vertex_groups
    for name in ("thigh_l", "thigh_r", "pelvis"):
        if name not in g:
            g.new(name=name)
    for v in mesh.data.vertices:
        x, z = v.co.x, v.co.z
        if abs(x) > half_width or z > top:
            continue
        # How far into the blend zone (1 on the midline, 0 at its edge).
        k = 1 - smoothstep(half_width * 0.5, half_width, abs(x))
        side = smoothstep(-half_width * 0.6, half_width * 0.6, x)  # 0 right .. 1 left
        pelvis = 0.35 * k
        blend = {"thigh_l": (1 - pelvis) * side, "thigh_r": (1 - pelvis) * (1 - side), "pelvis": pelvis}
        old = {g[gi.group].name: gi.weight for gi in v.groups}
        for gi in list(v.groups):
            g[gi.group].remove([v.index])
        for name in set(old) | set(blend):
            w = old.get(name, 0.0) * (1 - k) + blend.get(name, 0.0) * k
            if w > 1e-4:
                g[name].add([v.index], w, "REPLACE")

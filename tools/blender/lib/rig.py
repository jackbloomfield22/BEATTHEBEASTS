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
            e.use_connect = (e.parent.tail - e.head).length < 1e-4
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
        ws = sorted(((g.weight, g.group) for g in v.groups if g.weight > floor), reverse=True)[:n]
        total = sum(w for w, _ in ws) or 1.0
        keep = {gi for _, gi in ws}
        for g in list(v.groups):
            if g.group not in keep:
                groups[g.group].remove([v.index])
        for w, gi in ws:
            groups[gi].add([v.index], w / total, "REPLACE")


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

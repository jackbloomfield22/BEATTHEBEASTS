"""Contact sheets for reviewing poses and clips in Blender (Cycles, CPU).

The geared player (public/assets/characters/player.glb, LOD 0) is imported
and re-bound to a freshly built rig, so previews show exactly the shipped
mesh. Parts are colored from the part id in TEXCOORD_0 (a Beasts-like kit
with skin, so limbs read against the dark gear)."""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Vector
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PLAYER = os.path.join(ROOT, "public", "assets", "characters", "player.glb")

# By part id (gear.PARTS; linear RGB): skin, glove, sock, cleat, jersey,
# pants, helmet, the four facemasks, visor, strap, towel, collar.
PART_COLORS = [
    (0.42, 0.24, 0.14), (0.9, 0.9, 0.9), (0.05, 0.05, 0.06), (0.02, 0.02, 0.02),
    (0.30, 0.02, 0.04), (0.75, 0.75, 0.78), (0.02, 0.02, 0.025), (0.6, 0.6, 0.62),
    (0.6, 0.6, 0.62), (0.6, 0.6, 0.62), (0.6, 0.6, 0.62), (0.03, 0.03, 0.04),
    (0.85, 0.85, 0.85), (0.9, 0.9, 0.88), (0.02, 0.02, 0.02),
    (0.85, 0.85, 0.85), (0.02, 0.02, 0.025),  # the official's shirt (stripes are the runtime's) and cap
]
# Parts a preview player doesn't wear (one mask style, no visor or towel).
HIDDEN = {8, 9, 11, 13}


def import_player(rig: bpy.types.Object, lod: int = 0, variant: str = "player") -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=PLAYER)
    new = [o for o in bpy.data.objects if o not in before]
    mesh = next(o for o in new if o.type == "MESH" and o.name.startswith(f"{variant}_lod{lod}"))
    for o in new:
        if o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    mesh.parent = None
    mesh.matrix_world.identity()
    for m in list(mesh.modifiers):
        mesh.modifiers.remove(m)
    am = mesh.modifiers.new("rig", "ARMATURE")
    am.object = rig
    mesh.parent = rig
    _hide_parts(mesh, HIDDEN)
    _part_material(mesh)
    return mesh


def _hide_parts(mesh: bpy.types.Object, parts: set[int]) -> None:
    import bmesh

    uv = mesh.data.uv_layers[0]
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    lay = bm.loops.layers.uv[uv.name]
    dead = [f for f in bm.faces if int(f.loops[0][lay].uv.x * 16) in parts]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(mesh.data)
    bm.free()


def _part_material(mesh: bpy.types.Object) -> None:
    mat = bpy.data.materials.new("parts")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = mesh.data.uv_layers[0].name
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position = 0.0
    els[0].color = (*PART_COLORS[0], 1)
    for i in range(1, len(PART_COLORS)):
        e = els.new(i / 16.0)
        e.color = (*PART_COLORS[i], 1)
    nt.links.new(uv.outputs["UV"], sep.inputs[0])
    nt.links.new(sep.outputs["X"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    mesh.data.materials.clear()
    mesh.data.materials.append(mat)


def setup_scene(size: int = 420) -> bpy.types.Object:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 10
    sc.cycles.use_denoising = False
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.58, 0.62, 1)
    bpy.ops.mesh.primitive_plane_add(size=12)
    ground = bpy.context.active_object
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.12, 0.22, 0.1, 1)
    ground.data.materials.append(gm)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.2
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(48), 0, math.radians(35))
    cam = bpy.data.cameras.new("cam")
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


VIEWS = {
    "side": ((3.6, -0.25, 0.85), (0, -0.25, 0.72), 55),
    "front": ((0.9, -3.6, 1.0), (0, -0.25, 0.8), 55),
    "broadcast": ((2.6, -2.6, 3.0), (0, -0.2, 0.7), 55),
    # Three-quarter front at chest height, close: arms and hands read (M6 line play).
    "three": ((2.3, -2.6, 1.25), (0, -0.2, 0.8), 50),
    "head": ((0.55, -1.3, 1.78), (0, 0, 1.62), 50),
    "head_back": ((-0.5, 1.2, 1.85), (0, 0, 1.55), 50),
}


def render_views(cam: bpy.types.Object, names: list[str], tmp: str) -> list[str]:
    out = []
    for n in names:
        pos, tgt, lens = VIEWS[n]
        cam.data.lens = lens
        cam.location = pos
        cam.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(tmp, f"_{n}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        out.append(path)
    return out


def sheet(rows: list[tuple[str, list[str]]], path: str, cell: int = 420) -> None:
    """Rows of rendered images with a label each, into one PNG."""
    cols = max(len(r[1]) for r in rows)
    img = Image.new("RGB", (cols * cell, len(rows) * (cell + 22)), (20, 20, 22))
    d = ImageDraw.Draw(img)
    for ri, (label, files) in enumerate(rows):
        y = ri * (cell + 22)
        d.text((6, y + 4), label, fill=(230, 230, 230))
        for ci, f in enumerate(files):
            img.paste(Image.open(f).convert("RGB").resize((cell, cell)), (ci * cell, y + 22))
    img.save(path)

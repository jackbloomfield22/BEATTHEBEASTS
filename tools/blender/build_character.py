"""Build the player: body + gear, bound to the football rig, three LODs, body
shapes, exported as public/assets/characters/player.glb.

    python3 tools/blender/build_character.py

Each LOD is ONE skinned mesh with one material. A per-vertex part id
(skin, glove, sock, cleat, jersey, pants, helmet, facemask) rides in
TEXCOORD_0.x as id / PART_SCALE, and the runtime's uniform shader styles each
part (src/render/players/playerMaterial.ts): one draw call per player.
Morph targets heavy / lean / belly shape the body per player.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib import gear  # noqa: E402
from lib.body import build_body  # noqa: E402
from lib.geo import decimate_to, delete_verts, duplicate, tri_count  # noqa: E402
from lib.rig import bind, build_armature, limit_weights, transfer_weights  # noqa: E402
from lib.shapes import PART_FOLLOW, SHAPES  # noqa: E402
from lib.skeleton import RUNTIME_BONES, J  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "characters", "player.glb")
MANIFEST = os.path.join(ROOT, "public", "assets", "characters", "player.json")

# Triangle budgets per LOD (TECH_PLAN §5.7: High ~22k, Medium ~9k, Low ~3k).
BUDGET = [
    {"body": 7000, "jersey": 5500, "pants": 3500, "helmet": 2600, "cleats": 1200, "mask": (6, 3)},
    {"body": 3000, "jersey": 2200, "pants": 1400, "helmet": 1100, "cleats": 500, "mask": (4, 3)},
    {"body": 1000, "jersey": 700, "pants": 450, "helmet": 380, "cleats": 200, "mask": (3, 2)},
]


def covered(co: Vector) -> bool:
    """Body skin that no camera can see: under the jersey, pants or cleats."""
    if co.z < 0.10:
        return True  # inside the cleats
    if gear.PANTS_HEM_Z + 0.05 < co.z < 1.0 and abs(co.x) < 0.24:
        return True  # hips and thighs, under the pants
    # Keep the neck and the top of the chest and back under the collar, so a
    # look down the collar opening lands on skin, not through the jersey.
    if co.z > 1.47 and math.hypot(co.x, co.y - 0.02) < 0.16:
        return False
    if 0.95 <= co.z < 1.575:
        for s in ("l", "r"):
            if (co.x > 0) == (s == "l") and abs(co.x) > 0.16:
                t, _ = gear.along_upper_arm(co, s)
                if t > gear.SLEEVE_END - 0.06:
                    return False  # bare arm below the sleeve
        return abs(co.x) < 0.33  # torso and upper arm, under the jersey
    return False


def body_part(co: Vector) -> int:
    for s in ("l", "r"):
        w = Vector(J[f"wrist_{s}"])
        if (co.x > 0) == (s == "l") and abs(co.x) > abs(w.x) - 0.015 and co.z < w.z + 0.03:
            return gear.PARTS["glove"]
    if co.z < gear.PANTS_HEM_Z + 0.06:
        return gear.PARTS["sock"]
    return gear.PARTS["skin"]


def tag(ob: bpy.types.Object, part_of) -> None:
    """Write the part id into a UV map (exported as TEXCOORD_0) and a point attribute for the shape pass."""
    me = ob.data
    attr = me.attributes.new("part", "INT", "POINT")
    for v in me.vertices:
        attr.data[v.index].value = part_of(v.co)
    uv = me.uv_layers.new(name="part")
    for loop in me.loops:
        pid = attr.data[loop.vertex_index].value
        uv.data[loop.index].uv = ((pid + 0.5) / gear.PART_SCALE, 0.5)


def rigid(ob: bpy.types.Object, rig: bpy.types.Object, bone: str) -> None:
    g = ob.vertex_groups.new(name=bone)
    g.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")
    ob.parent = rig
    am = ob.modifiers.new("rig", "ARMATURE")
    am.object = rig


def add_shapes(ob: bpy.types.Object) -> None:
    me = ob.data
    part = me.attributes["part"]
    ob.shape_key_add(name="Basis", from_mix=False)
    for name, field in SHAPES.items():
        key = ob.shape_key_add(name=name, from_mix=False)
        for v in me.vertices:
            f = PART_FOLLOW[part.data[v.index].value]
            if f:
                key.data[v.index].co = v.co + field(v.co, v.normal) * f


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = objs[0]
    ob.name = ob.data.name = name
    return ob


def main() -> None:
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = build_armature("rig")

    full_body = build_body()
    # Weight source: a lighter copy of the whole body (heat weights are slow on 200k faces).
    src = duplicate(full_body, "weight_source")
    decimate_to(src, 60000)
    bind(src, rig)

    visible = duplicate(full_body, "body_visible")
    delete_verts(visible, covered)

    pieces = {
        "jersey": gear.jersey(),
        "pants": gear.pants(),
        "helmet": gear.helmet(),
        "cleats": gear.cleats(),
    }
    mat = bpy.data.materials.new("player")

    stats = []
    lods = []
    for i, b in enumerate(BUDGET):
        parts = []
        body = decimate_to(duplicate(visible, f"body_{i}"), b["body"])
        tag(body, body_part)
        transfer_weights(src, body, rig)
        parts.append(body)
        finish = {"jersey": gear.cut_jersey, "pants": gear.cut_pants, "cleats": lambda ob: None}
        for name, pid in (("jersey", "jersey"), ("pants", "pants"), ("cleats", "cleat")):
            p = decimate_to(duplicate(pieces[name], f"{name}_{i}"), b[name])
            finish[name](p)
            tag(p, lambda co, pid=pid: gear.PARTS[pid])
            transfer_weights(src, p, rig)
            parts.append(p)
        helm = decimate_to(duplicate(pieces["helmet"], f"helmet_{i}"), b["helmet"])
        gear.cut_helmet(helm)
        tag(helm, lambda co: gear.PARTS["helmet"])
        rigid(helm, rig, "head")
        segs, bars = b["mask"]
        mask = gear.facemask(segs=segs, bars=bars)
        mask.name = f"mask_{i}"
        tag(mask, lambda co: gear.PARTS["facemask"])
        rigid(mask, rig, "head")
        parts += [helm, mask]
        ob = join(parts, f"player_lod{i}")
        for m in list(ob.modifiers)[1:]:
            ob.modifiers.remove(m)  # one armature modifier after the join
        limit_weights(ob, 4)
        ob.data.validate(clean_customdata=False)  # drop degenerate faces left by decimation
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        add_shapes(ob)
        stats.append({"lod": i, "triangles": tri_count(ob), "vertices": len(ob.data.vertices)})
        lods.append(ob)

    for o in list(bpy.data.objects):
        if o not in lods and o is not rig:
            bpy.data.objects.remove(o, do_unlink=True)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for o in lods:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_morph=True,
        export_morph_normal=False,
        export_animations=False,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_def_bones=False,
    )
    info = {
        "file": "player.glb",
        "lods": stats,
        "bones": len([b for b in rig.data.bones if b.use_deform]),
        "runtimeBones": RUNTIME_BONES,
        "parts": gear.PARTS,
        "partScale": gear.PART_SCALE,
        "shapes": list(SHAPES),
        "bytes": os.path.getsize(OUT),
    }
    with open(MANIFEST, "w") as f:
        json.dump(info, f, indent=2)
        f.write("\n")
    print(json.dumps({k: info[k] for k in ("lods", "bones", "bytes")}), f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()

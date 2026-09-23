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
from lib.rig import bind, build_armature, crotch_weights, fill_bare, limit_weights, remap_weights, transfer_weights  # noqa: E402
from lib.shapes import PART_AWARE, PART_FOLLOW, SHAPES  # noqa: E402
from lib.skeleton import RUNTIME_BONES, J  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "characters", "player.glb")
MANIFEST = os.path.join(ROOT, "public", "assets", "characters", "player.json")

# Triangle budgets per LOD (TECH_PLAN §5.7: High ~22k, Medium ~9k, Low ~3k).
# The High LOD carries every facemask style (the runtime hides all but the
# player's); the Medium LOD too; the Low LOD one generic mask and none of the
# small extras (visor, strap, towel), which don't read at that distance.
BUDGET = [
    {"body": 7000, "jersey": 5000, "pants": 3000, "helmet": 2600, "cleats": 1200, "glove": 900, "collar": 400, "mask": (6, 3), "extras": True},
    {"body": 3000, "jersey": 2100, "pants": 1300, "helmet": 1100, "cleats": 500, "glove": 260, "collar": 160, "mask": (4, 3), "extras": True},
    {"body": 1000, "jersey": 700, "pants": 450, "helmet": 380, "cleats": 200, "glove": 70, "collar": 48, "mask": (3, 2), "extras": False},
]
HAND_BONES = ("forearm", "forearm_twist", "hand", "thumb_01", "thumb_02", "thumb_03", "index_01", "index_02", "index_03", "fingers_01", "fingers_02", "fingers_03")


def covered(co: Vector) -> bool:
    """Body skin that no camera can see: under the jersey, pants or cleats."""
    if co.z < 0.10:
        return True  # inside the cleats
    if gear.PANTS_HEM_Z + 0.02 < co.z < 1.0 and abs(co.x) < 0.24:
        return True  # hips and thighs, under the pants (the leg stays 2 cm up inside the hem)
    # Keep the neck column; everything else under the collar band and pads is
    # hidden (skin lying on the jersey's inside z-fights through its edge).
    if co.z > 1.44 and math.hypot(co.x, co.y - 0.02) < 0.092:
        return False
    if 0.95 <= co.z < 1.62:
        for s in ("l", "r"):
            if (co.x > 0) == (s == "l") and abs(co.x) > 0.16:
                t, _ = gear.along_upper_arm(co, s)
                if t > gear.SLEEVE_END - 0.06:
                    return False  # bare arm below the sleeve
        return abs(co.x) < 0.33  # torso and upper arm, under the jersey
    return False


def body_part(co: Vector) -> int:
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
            pid = part.data[v.index].value
            f = PART_FOLLOW[pid]
            if f:
                d = field(v.co, v.normal, pid) if name in PART_AWARE else field(v.co, v.normal)
                key.data[v.index].co = v.co + d * f


def smooth_weights(ob: bpy.types.Object, repeat: int = 4, factor: float = 0.5, where=None) -> None:
    """Smooth every vertex group, only over the vertices `where` accepts (a
    paint mask), then normalize."""
    for v in ob.data.vertices:
        v.select = where(v.co) if where else True
    ob.data.use_paint_mask_vertex = True
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=factor, repeat=repeat)
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.use_paint_mask_vertex = False
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)


def traps_to_chest(ob: bpy.types.Object) -> None:
    """Skin from the collar down rides the chest: traps and neck base swung
    with the clavicles and neck turned against the pads (the gait's thorax
    counter-rotation and head stabilization) and poked through the jersey.
    The neck turns above the collar band instead."""
    groups = ob.vertex_groups
    chest = groups.get("spine_04") or groups.new(name="spine_04")
    movers = [g for g in groups if g.name.startswith(("clavicle_", "neck_01", "neck_02", "upperarm_l", "upperarm_r"))]
    for v in ob.data.vertices:
        co = v.co
        if not (1.45 < co.z < 1.63 and abs(co.x) < 0.19):
            continue
        # Fully the chest's up to the collar top (1.60), fading to the neck by 1.63.
        k = 1.0 if co.z < 1.60 else (1.63 - co.z) / 0.03
        moved = 0.0
        for g in list(v.groups):
            gg = groups[g.group]
            if gg in movers:
                w = g.weight * k
                moved += w
                gg.add([v.index], g.weight - w, "REPLACE")
        if moved:
            cur = next((g.weight for g in v.groups if g.group == chest.index), 0.0)
            chest.add([v.index], cur + moved, "REPLACE")


def sharpen_knees(ob: bpy.types.Object, half: float = 0.03) -> None:
    """A sharp thigh-to-calf hand-over in the pants: blended ~50/50 over a wide
    band, the fabric behind a bent knee averaged into a web that hung from
    the thigh like a skirt. Here it switches within ±3 cm of the joint."""
    from lib.geo import smoothstep as ss

    groups = ob.vertex_groups
    for s in ("l", "r"):
        knee_z = J[f"knee_{s}"][2]
        leg = [groups.get(n) for n in (f"thigh_{s}", f"thigh_twist_{s}", f"calf_{s}", f"calf_twist_{s}")]
        thigh = groups.get(f"thigh_{s}") or groups.new(name=f"thigh_{s}")
        calf = groups.get(f"calf_{s}") or groups.new(name=f"calf_{s}")
        for v in ob.data.vertices:
            co = v.co
            if (co.x > 0) != (s == "l") or not knee_z - 0.10 < co.z < knee_z + 0.12:
                continue
            leg_w = sum(g.weight for g in v.groups if groups[g.group] in leg)
            if leg_w <= 0:
                continue
            wc = 1.0 - ss(knee_z - half, knee_z + half, co.z)
            for g in leg:
                if g is not None:
                    g.remove([v.index])
            if wc > 0:
                calf.add([v.index], leg_w * wc, "REPLACE")
            if wc < 1:
                thigh.add([v.index], leg_w * (1 - wc), "REPLACE")


def pads_rigid(ob: bpy.types.Object) -> None:
    """Shoulder pads are a hard shell on the chest: the jersey over them rides
    spine_04 alone (clavicle and arm weights warped the caps into the collar
    as the arms swung). The sleeves beyond the pad edge still follow the arms."""
    groups = ob.vertex_groups
    chest = groups.get("spine_04") or groups.new(name="spine_04")
    for v in ob.data.vertices:
        co = v.co
        if co.z < 1.36:
            continue
        k = min(1.0, (co.z - 1.36) / 0.06) * (1.0 - min(1.0, max(0.0, (abs(co.x) - 0.19) / 0.07)))
        if k <= 0:
            continue
        moved = 0.0
        for g in list(v.groups):
            if g.group == chest.index:
                continue
            w = g.weight * k
            moved += w
            groups[g.group].add([v.index], g.weight - w, "REPLACE")
        cur = next((g.weight for g in v.groups if g.group == chest.index), 0.0)
        chest.add([v.index], cur + moved, "REPLACE")


def bind_glove(glove: bpy.types.Object, rig: bpy.types.Object, s: str, sigma: float = 0.011) -> None:
    """Skin a glove to the forearm, hand and finger bones by distance to each
    bone segment (Gaussian falloff, normalized, 4 influences). Blender's heat
    weighting fails on a mesh this small and left every glove vertex on the
    forearm, so the fingers never moved."""
    from mathutils.geometry import intersect_point_line

    segs = []
    for b in HAND_BONES:
        bone = rig.data.bones[f"{b}_{s}"]
        segs.append((bone.name, bone.head_local.copy(), bone.tail_local.copy()))
    for name, _, _ in segs:
        glove.vertex_groups.new(name=name)
    for v in glove.data.vertices:
        ws = []
        for name, a, b in segs:
            pt, t = intersect_point_line(v.co, a, b)
            t = min(1.0, max(0.0, t))
            d = (v.co - (a + (b - a) * t)).length
            ws.append((math.exp(-((d / sigma) ** 2)), name))
        ws.sort(reverse=True)
        ws = ws[:4]
        total = sum(w for w, _ in ws)
        if total < 1e-9:
            ws, total = [(1.0, ws[0][1])], 1.0
        for w, name in ws:
            if w / total > 0.01:
                glove.vertex_groups[name].add([v.index], w / total, "REPLACE")
    glove.parent = rig
    am = glove.modifiers.new("rig", "ARMATURE")
    am.object = rig


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
        "collar": gear.collar_insert(),
    }
    gloves = {}
    for s in ("l", "r"):
        gloves[s] = gear.glove(s)
        bind_glove(gloves[s], rig, s)
    mat = bpy.data.materials.new("player")

    stats = []
    lods = []
    for i, b in enumerate(BUDGET):
        parts = []
        body = decimate_to(duplicate(visible, f"body_{i}"), b["body"])
        tag(body, body_part)
        transfer_weights(src, body, rig)
        # The traps below the collar belong to the trunk: skinned to the
        # clavicles and neck they swing with the arms and poke through the pads.
        traps_to_chest(body)
        parts.append(body)
        finish = {"jersey": gear.cut_jersey, "pants": gear.cut_pants, "cleats": lambda ob: None}
        for name, pid in (("jersey", "jersey"), ("pants", "pants"), ("cleats", "cleat")):
            p = decimate_to(duplicate(pieces[name], f"{name}_{i}"), b[name])
            finish[name](p)
            tag(p, lambda co, pid=pid: gear.PARTS[pid])
            transfer_weights(src, p, rig)
            if name == "jersey":
                # Pads and collar ride on the chest: no neck or head influence
                # (neck extension in stances tore the collar open).
                remap_weights(p, {"neck_01": "spine_04", "neck_02": "spine_04", "head": "spine_04"})
                pads_rigid(p)
                limit_weights(p, 4)
            if name == "pants":
                crotch_weights(p)
                # Spread the pelvis/thigh hand-over so a deep hip flexion
                # folds the fabric instead of tearing it. Only at the hip:
                # smoothing across the knee left the hem behind the calf.
                smooth_weights(p, repeat=6, where=lambda co: co.z > 0.78)
                sharpen_knees(p)
                limit_weights(p, 4)
            parts.append(p)
        for s in ("l", "r"):
            g = decimate_to(duplicate(gloves[s], f"glove_{s}_{i}"), b["glove"])
            for m in list(g.modifiers):
                g.modifiers.remove(m)
            for vg in list(g.vertex_groups):
                g.vertex_groups.remove(vg)
            tag(g, lambda co: gear.PARTS["glove"])
            transfer_weights(gloves[s], g, rig)
            parts.append(g)
        col = decimate_to(duplicate(pieces["collar"], f"collar_{i}"), b["collar"])
        tag(col, lambda co: gear.PARTS["collar"])
        rigid(col, rig, "spine_04")  # the collar rides the pads; the neck turns inside it
        parts.append(col)
        helm = decimate_to(duplicate(pieces["helmet"], f"helmet_{i}"), b["helmet"])
        gear.cut_helmet(helm)
        tag(helm, lambda co: gear.PARTS["helmet"])
        rigid(helm, rig, "head")
        parts.append(helm)
        segs, bars = b["mask"]
        styles = ("skill", "cage", "qb") if b["extras"] else ("skill",)
        for style in styles:
            mask = gear.facemask(segs=segs, bars=bars, style=style)
            mask.name = f"mask_{style}_{i}"
            pid = gear.PARTS[f"mask_{style}"] if b["extras"] else gear.PARTS["mask_low"]
            tag(mask, lambda co, pid=pid: pid)
            rigid(mask, rig, "head")
            parts.append(mask)
        if b["extras"]:
            for name, make in (("strap", gear.chin_strap), ("visor", gear.visor)):
                ob = make()
                ob.name = f"{name}_{i}"
                tag(ob, lambda co, name=name: gear.PARTS[name])
                rigid(ob, rig, "head")
                parts.append(ob)
            tw = gear.towel()
            tw.name = f"towel_{i}"
            tag(tw, lambda co: gear.PARTS["towel"])
            transfer_weights(src, tw, rig)
            parts.append(tw)
        ob = join(parts, f"player_lod{i}")
        for m in list(ob.modifiers)[1:]:
            ob.modifiers.remove(m)  # one armature modifier after the join
        limit_weights(ob, 4)
        ob.data.validate(clean_customdata=False)  # drop degenerate faces left by decimation
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        # Every vertex must be skinned to at least one deform bone, or the
        # exporter binds it to a placeholder and it spikes when posed.
        deform = {b.name for b in rig.data.bones if b.use_deform}
        fill_bare(ob, deform)
        names = {g.index: g.name for g in ob.vertex_groups}
        bare = [v for v in ob.data.vertices if not any(names[g.group] in deform and g.weight > 0 for g in v.groups)]
        assert not bare, f"lod{i}: {len(bare)} vertices without deform weights"
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

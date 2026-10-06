"""Pose-space correctives for the arms overhead (the character pass,
docs/characters/CHARACTERS.md; the fix docs/m65/BODIES.md section 3 left
open).

With an arm overhead (the high point, the one-hander, a celebration) the
whole elevation sits in the shoulder joint and the clavicle: the pad cap's
lip and the top of the sleeve, skinned between the shell and the arm,
fold up against the side of the helmet like a wing, and the fabric under
the lip bunches through itself.

A corrective shape per side fixes the pose it was made in and fades in with
the arm's elevation:
  1. pose the rig at REF_CLIP:REF_FRAME (both arms overhead);
  2. take the linear-blend-skinned mesh there, and relax the shoulder
     region of the jersey and skin in place (Taubin smoothing: a Laplacian
     step and a negative one, so the region keeps its volume) with the
     region's edges held: the folds open, the bunching spreads into the
     sleeve and the cap's lip settles back over the arm;
  3. carry each vertex's offset back to the rest pose through the inverse
     of its own blended skinning matrix, so that skinning the shape key
     reproduces the relaxed surface exactly in that pose;
  4. store it as shape keys `reach_l` / `reach_r`, scaled so that weight
     reach_weight(elevation) at the reference pose gives the full offset.
The runtime sets the weights from the same elevation every frame
(src/render/players/playerAsset.ts, REACH_FROM/REACH_TO mirror these), and
the build's skinning gate applies them as it measures (lib/skin.py).
"""

from __future__ import annotations

import math

import bpy
import numpy as np

from .geo import smoothstep

REF_CLIP, REF_FRAME = "catch_high_point", 25
# Elevation of the upper arm (degrees between the upper arm and the trunk's
# down axis, pelvis below the chest): the A-pose rest is ~45, a sprint's
# backswing ~60, a hand at the facemask ~110, straight overhead ~170. The
# shape fades in between REACH_FROM and REACH_TO.
REACH_FROM, REACH_TO = 105.0, 160.0
# The region relaxed (Blender rest frame, m): the cap, its lip and the
# sleeve, and the skin of the upper arm and armpit under them.
REGION_X = (0.09, 0.14, 0.40, 0.46)  # |x|: fade in, full, full, fade out
REGION_Z = (1.22, 1.30, 1.62, 1.68)  # z: fade in, full, full, fade out
PARTS = (0, 4)  # skin, jersey (gear.PARTS)
# Taubin passes at LOD0; a coarser LOD moves further per pass (its edges are
# longer), so build_character gives LOD1 and LOD2 fewer.
ITERATIONS = 24
LAMBDA, MU = 0.55, -0.58


def arm_elevation(rig, side: str) -> float:
    """Degrees between the upper arm (shoulder to elbow) and the trunk's
    down axis (chest to pelvis), from the posed bone heads. The runtime
    measures the same way (playerAsset.ts reachElevation)."""
    pb = rig.pose.bones
    mw = rig.matrix_world
    sh = mw @ pb[f"upperarm_{side}"].head
    el = mw @ pb[f"forearm_{side}"].head
    down = (mw @ pb["pelvis"].head) - (mw @ pb["spine_04"].head)
    a = (el - sh).normalized()
    d = down.normalized()
    return math.degrees(math.acos(max(-1.0, min(1.0, a.dot(d)))))


def reach_weight(elevation: float) -> float:
    return smoothstep(REACH_FROM, REACH_TO, elevation)


# Along the upper arm (0 shoulder, 1 elbow): the region stops short of the
# elbow, whose own fold the elbow gate guards.
REGION_ARM = (0.42, 0.58)


def _region(co) -> float:
    from .gear import along_upper_arm

    ax = abs(co.x)
    fx = smoothstep(REGION_X[0], REGION_X[1], ax) * (1.0 - smoothstep(REGION_X[2], REGION_X[3], ax))
    fz = smoothstep(REGION_Z[0], REGION_Z[1], co.z) * (1.0 - smoothstep(REGION_Z[2], REGION_Z[3], co.z))
    t, _ = along_upper_arm(co, "l" if co.x > 0 else "r")
    fa = 1.0 - smoothstep(REGION_ARM[0], REGION_ARM[1], t)
    return fx * fz * fa


def _skin_matrices(ob, rig) -> np.ndarray:
    """Each vertex's blended 3x3 skinning matrix (rest -> pose) at the rig's current pose."""
    names = {g.index: g.name for g in ob.vertex_groups}
    mats = {}
    for b in rig.data.bones:
        if b.use_deform:
            m = rig.pose.bones[b.name].matrix @ b.matrix_local.inverted()
            mats[b.name] = np.array(m.to_3x3())
    out = np.zeros((len(ob.data.vertices), 3, 3))
    for v in ob.data.vertices:
        tot = 0.0
        for g in v.groups:
            n = names[g.group]
            if n in mats and g.weight > 0:
                out[v.index] += g.weight * mats[n]
                tot += g.weight
        out[v.index] = out[v.index] / tot if tot > 0 else np.eye(3)
    return out


def _deformed(ob) -> np.ndarray:
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    return co.reshape(-1, 3)


def add_reach_correctives(target, rig, iterations: int = ITERATIONS) -> dict:
    """Add reach_l and reach_r to a player LOD (after its body shapes).
    `rig` is a throwaway armature the caller built for posing (posing adds
    IK constraints and control empties, which the exported rig must not
    carry); the work is done on a copy of the LOD bound to it, and only the
    two shape keys land on `target`. Returns how far the relaxation moved
    the region (m: mean and max) and the reference pose's weights."""
    from .anim_rig import Controls
    from .geo import duplicate
    from .poses import apply_pose
    from .skin import clip_poses

    ob = duplicate(target, f"{target.name}_corrective")
    ob.parent = None
    ob.matrix_world.identity()
    for mod in ob.modifiers:
        if mod.type == "ARMATURE":
            mod.object = rig
    me = ob.data
    keys = me.shape_keys.key_blocks if me.shape_keys else []
    for kb in keys:
        kb.value = 0.0
    apply_pose(rig, Controls(rig), clip_poses(REF_CLIP)[REF_FRAME])
    bpy.context.view_layer.update()
    part = me.attributes["part"]
    n = len(me.vertices)
    mask = np.zeros(n)
    for v in me.vertices:
        if part.data[v.index].value in PARTS:
            mask[v.index] = _region(v.co)
    P = _deformed(ob)
    # Neighbour lists (uniform Laplacian over the mesh edges).
    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    deg = np.bincount(ev.ravel(), minlength=n).astype(float)
    Q = P.copy()

    def lap(X):
        acc = np.zeros_like(X)
        np.add.at(acc, ev[:, 0], X[ev[:, 1]])
        np.add.at(acc, ev[:, 1], X[ev[:, 0]])
        return acc / np.maximum(deg, 1.0)[:, None] - X

    m = mask[:, None]
    for _ in range(iterations):
        Q = Q + LAMBDA * m * lap(Q)
        Q = Q + MU * m * lap(Q)
    dpose = Q - P
    S = _skin_matrices(ob, rig)
    drest = np.einsum("vij,vj->vi", np.linalg.inv(S), dpose)
    stats = {}
    for side, sgn in (("l", 1.0), ("r", -1.0)):
        w = reach_weight(arm_elevation(rig, side))
        key = target.shape_key_add(name=f"reach_{side}", from_mix=False)
        basis = np.empty(n * 3)
        target.data.vertices.foreach_get("co", basis)
        basis = basis.reshape(-1, 3)
        on = (np.sign(basis[:, 0]) == sgn) & (mask > 0)
        co = basis.copy()
        co[on] += drest[on] / max(w, 1e-3)
        key.data.foreach_set("co", co.ravel())
        moved = np.linalg.norm(dpose[on], axis=1)
        stats[side] = {"weight": round(w, 3), "mean": round(float(moved.mean()) if moved.size else 0.0, 4), "max": round(float(moved.max()) if moved.size else 0.0, 4)}
    for kb in target.data.shape_keys.key_blocks:
        kb.value = 0.0
    bpy.data.objects.remove(ob, do_unlink=True)
    return stats


def set_reach(meshes, rig) -> None:
    """Set every mesh's reach_l / reach_r from the rig's current pose (the gate's frames)."""
    wl, wr = reach_weight(arm_elevation(rig, "l")), reach_weight(arm_elevation(rig, "r"))
    for m in meshes:
        ks = m.data.shape_keys
        if not ks:
            continue
        for name, w in (("reach_l", wl), ("reach_r", wr)):
            kb = ks.key_blocks.get(name)
            if kb is not None:
                kb.value = w


"""Skin deformation probes (M6.5 #12): how the skinned mesh holds up at a
joint under a pose, for the build's skinning gate and tools/blender/skin_check.py.

A face belongs to a joint region when one of its vertices blends the two
sides of the joint (each at least MIN_W): the shoulder (trunk to upper
arm), the elbow, the hip (pelvis to thigh) and the knee. For each region
and pose:
  - squash: the smallest face-area ratio, deformed over rest (a fold
    collapsing; 0 is a face squashed flat), and `collapsed`, the share of
    the region's faces below COLLAPSED;
  - flips: faces whose normal turned more than FLIP_DEG from where their
    own bones' blended rotation carries the rest normal, i.e. the skin
    folded through itself (a face that merely turns with the limb doesn't
    count);
  - stretch: the largest edge-length ratio.
Faces smaller than MIN_AREA at rest (slivers left by decimation, hems)
are left out: their ratios swing wildly without anything showing.
Linear blend skinning (three.js, and Blender's armature modifier without
preserve volume) is what's measured, so the numbers are the runtime's.
"""

from __future__ import annotations

import math

import bpy
import numpy as np

MIN_W = 0.1
FLIP_DEG = 120.0
COLLAPSED = 0.2
MIN_AREA = 4e-6  # m² (2 x 4 mm); LOD0's median face is ~6e-5

# The pad caps (lib/gear.py: the cap over each shoulder, above its lip).
CAP_Z = 1.47
CAP_X = (0.12, 0.30)

TRUNK = ("spine_03", "spine_04", "clavicle", "pad")
REGIONS = {
    "shoulder": (TRUNK, ("upperarm",)),
    "elbow": (("upperarm",), ("forearm",)),
    "hip": (("pelvis", "spine_01"), ("thigh",)),
    "knee": (("thigh",), ("calf",)),
}


def _side_of(name: str) -> str:
    return name[-1] if name.endswith(("_l", "_r")) else ""


def _base(name: str) -> str:
    n = name[:-2] if name.endswith(("_l", "_r")) else name
    return n.replace("_twist", "")


class SkinProbe:
    def __init__(self, mesh: bpy.types.Object, rig: bpy.types.Object) -> None:
        self.mesh, self.rig = mesh, rig
        me = mesh.data
        me.calc_loop_triangles()
        nv = len(me.vertices)
        rest = np.empty(nv * 3)
        me.vertices.foreach_get("co", rest)
        self.rest = rest.reshape(-1, 3)
        tris = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
        me.loop_triangles.foreach_get("vertices", tris)
        self.tris = tris.reshape(-1, 3)
        names = {g.index: g.name for g in mesh.vertex_groups}
        self.bones = [b.name for b in rig.data.bones if b.use_deform]
        bi = {n: i for i, n in enumerate(self.bones)}
        self.W = np.zeros((nv, len(self.bones)))
        blends = {r: np.zeros(nv, dtype=bool) for r in REGIONS}
        for v in me.vertices:
            ws = [(g.weight, names[g.group]) for g in v.groups if names[g.group] in bi]
            tot = sum(w for w, _ in ws) or 1.0
            for w, n in ws:
                self.W[v.index, bi[n]] = w / tot
            for r, (a, b) in REGIONS.items():
                for side in ("l", "r"):
                    wa = sum(w for w, n in ws if _base(n) in a and _side_of(n) in ("", side))
                    wb = sum(w for w, n in ws if _base(n) in b and _side_of(n) == side)
                    if wa >= MIN_W and wb >= MIN_W:
                        blends[r][v.index] = True
        a, b, c = (self.rest[self.tris[:, k]] for k in range(3))
        n = np.cross(b - a, c - a)
        self.rest_area = np.linalg.norm(n, axis=1) / 2
        self.rest_n = n / np.maximum(1e-12, np.linalg.norm(n, axis=1))[:, None]
        self.rest_edges = np.stack([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1), np.linalg.norm(a - c, axis=1)], axis=1)
        big = self.rest_area > MIN_AREA
        self.faces = {r: np.where(blends[r][self.tris].any(axis=1) & big)[0] for r in REGIONS}

    def parts(self) -> np.ndarray:
        """Each vertex's part id (gear.PARTS): the build's point attribute, or TEXCOORD_0.x in an imported file."""
        me = self.mesh.data
        n = len(me.vertices)
        if "part" in me.attributes:
            out = np.empty(n, dtype=np.int64)
            me.attributes["part"].data.foreach_get("value", out)
            return out
        out = np.zeros(n, dtype=np.int64)
        uv = me.uv_layers[0].data
        for loop in me.loops:
            out[loop.vertex_index] = int(uv[loop.index].uv.x * 16)
        return out

    def cap_lift(self, co: np.ndarray | None = None) -> float:
        """How far the pad caps stand off the chest (m, 95th percentile over
        the caps' vertices): where they are against where the chest alone
        would carry them. The fin at the sprint's arm swing (M6.5 #12)."""
        if not hasattr(self, "_cap"):
            p = self.parts()
            r = self.rest
            self._cap = (p == 4) & (r[:, 2] > CAP_Z) & (np.abs(r[:, 0]) > CAP_X[0]) & (np.abs(r[:, 0]) < CAP_X[1])
        co = self.deformed() if co is None else co
        m = self.rig.pose.bones["spine_04"].matrix @ self.rig.data.bones["spine_04"].matrix_local.inverted()
        a = np.array(m)
        rigid = self.rest[self._cap] @ a[:3, :3].T + a[:3, 3]
        return float(np.percentile(np.linalg.norm(co[self._cap] - rigid, axis=1), 95))

    def deformed(self) -> np.ndarray:
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.mesh.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        return co.reshape(-1, 3)

    def _bone_rot(self) -> np.ndarray:
        out = np.empty((len(self.bones), 3, 3))
        for i, n in enumerate(self.bones):
            m = self.rig.pose.bones[n].matrix @ self.rig.data.bones[n].matrix_local.inverted()
            out[i] = np.array(m.to_3x3())
        return out

    def measure(self, co: np.ndarray | None = None) -> dict:
        co = self.deformed() if co is None else co
        R = self._bone_rot()
        a, b, c = (co[self.tris[:, k]] for k in range(3))
        n = np.cross(b - a, c - a)
        area = np.linalg.norm(n, axis=1) / 2
        out = {}
        for r, idx in self.faces.items():
            if idx.size == 0:
                out[r] = {"squash": 1.0, "collapsed": 0.0, "flips": 0, "stretch": 1.0, "faces": 0}
                continue
            ratio = area[idx] / self.rest_area[idx]
            # Where the face's bones carry its rest normal (the three vertices' blended rotations, averaged).
            wf = self.W[self.tris[idx]].mean(axis=1)
            Rf = np.einsum("fb,bij->fij", wf, R)
            want = np.einsum("fij,fj->fi", Rf, self.rest_n[idx])
            want /= np.maximum(1e-12, np.linalg.norm(want, axis=1))[:, None]
            got = n[idx] / np.maximum(1e-12, np.linalg.norm(n[idx], axis=1))[:, None]
            cosang = np.sum(want * got, axis=1)
            flips = int(np.sum(cosang < math.cos(math.radians(FLIP_DEG))))
            e = np.stack([np.linalg.norm(b[idx] - a[idx], axis=1), np.linalg.norm(c[idx] - b[idx], axis=1), np.linalg.norm(a[idx] - c[idx], axis=1)], axis=1)
            st = float(np.max(e / np.maximum(1e-9, self.rest_edges[idx])))
            out[r] = {"squash": float(np.min(ratio)), "collapsed": float(np.mean(ratio < COLLAPSED)), "flips": flips, "stretch": st, "faces": int(idx.size)}
        return out


# --- The build's skinning gate (build_character.py writes it to player.json) ---

# Two groups: the fast clips a broadcast sees on every play ("speed"), and
# the full-extension reaches ("reach": arms overhead, the layout).
GATE_GROUPS = {
    "speed": ["run", "sprint", "carry_sprint", "cut_plant_sharp_l"],
    "reach": ["catch_high_point", "dive"],
}
GATE_CLIPS = [c for g in GATE_GROUPS.values() for c in g]
# At speed the pad caps ride the chest: the 95th percentile of their
# vertices stands at most this far off it (m). The shipped M6.5 build
# stood them 12 cm off at the sprint's arm swing (the fin); the pad shell
# holds them to ~2 cm. (Overhead, the cap is meant to rise with the girdle.)
CAP_LIFT_MAX = 0.04
# Per group and region, the worst frame of any of its clips at any LOD: the
# share of the region's faces collapsed below COLLAPSED of their area, and
# the share folded through themselves. Set from the M6.5 #12 build
# (docs/m65/BODIES.md has the before and after) with a little room: a
# regression guard, not a claim that a fold at full extension is gone.
GATE = {
    # Measured: shoulder 1.8% / 9.5% (the armpit crease in the sprint's
    # backswing, LOD1), elbow 4.7 / 8.5, hip 1.5 / 3.2, knee 4.2 / 15.6 (the
    # back of the knee in the sharp cut's plant). Before the fix the
    # shoulder collapsed 2.6% here and the cap stood up off the shoulder.
    "speed": {
        "shoulder": {"collapsed": 0.022, "flips": 0.11},
        "elbow": {"collapsed": 0.055, "flips": 0.10},
        "hip": {"collapsed": 0.018, "flips": 0.04},
        "knee": {"collapsed": 0.05, "flips": 0.18},
    },
    # Measured: shoulder 2.6 / 18.3 (the armpit under an arm at full
    # extension; 5.2% collapsed before), elbow 4.3 / 12.7, hip 1.3 / 2.4,
    # knee 5.4 / 13.9.
    "reach": {
        "shoulder": {"collapsed": 0.03, "flips": 0.21},
        "elbow": {"collapsed": 0.05, "flips": 0.15},
        "hip": {"collapsed": 0.016, "flips": 0.03},
        "knee": {"collapsed": 0.065, "flips": 0.17},
    },
}


def clip_poses(name: str):
    from .actions import action_clips
    from .gait import GAITS, gait_pose

    if name in GAITS:
        g = GAITS[name]
        return [gait_pose(g, f) for f in range(g.frames)]
    cl = next(c for c in action_clips() if c.name == name)
    return [cl.pose(f) for f in range(cl.frames if cl.kind == "locomotion" else cl.frames + 1)]


def gate_lods(rig, meshes: list) -> dict:
    """Pose every gate clip on the rig and measure each LOD mesh (shape keys
    at 0: the base body). Returns per region the worst shares and the pass."""
    from .anim_rig import Controls
    from .corrective import set_reach
    from .poses import apply_pose

    for m in meshes:
        if m.data.shape_keys:
            for kb in m.data.shape_keys.key_blocks:
                kb.value = 0.0
    probes = [SkinProbe(m, rig) for m in meshes]
    c = Controls(rig)
    out = {}
    ok = True
    for group, names in GATE_GROUPS.items():
        worst = {r: {"collapsed": 0.0, "flips": 0.0, "at": {}} for r in REGIONS}
        lift, lift_at = 0.0, ""
        for name in names:
            for f, pose in enumerate(clip_poses(name)):
                apply_pose(rig, c, pose)
                # The arms-overhead correctives at the runtime's weights (lib/corrective.py).
                set_reach(meshes, rig)
                bpy.context.view_layer.update()
                for lod, p in enumerate(probes):
                    co = p.deformed()
                    if group == "speed":
                        cl = p.cap_lift(co)
                        if cl > lift:
                            lift, lift_at = cl, f"{name}:{f} lod{lod}"
                    for r, m in p.measure(co).items():
                        w = worst[r]
                        fl = m["flips"] / max(1, m["faces"])
                        if m["collapsed"] > w["collapsed"]:
                            w["collapsed"], w["at"]["collapsed"] = m["collapsed"], f"{name}:{f} lod{lod}"
                        if fl > w["flips"]:
                            w["flips"], w["at"]["flips"] = fl, f"{name}:{f} lod{lod}"
        res = {}
        for r, w in worst.items():
            lim = GATE[group][r]
            passed = w["collapsed"] <= lim["collapsed"] and w["flips"] <= lim["flips"]
            ok &= passed
            res[r] = {"collapsed": round(w["collapsed"], 4), "flips": round(w["flips"], 4), "at": w["at"], "max": lim, "pass": passed}
        out[group] = {"clips": names, "regions": res}
        if group == "speed":
            ok &= lift <= CAP_LIFT_MAX
            out[group]["capLift"] = {"m": round(lift, 4), "at": lift_at, "max": CAP_LIFT_MAX, "pass": lift <= CAP_LIFT_MAX}
    return {"groups": out, "pass": ok}

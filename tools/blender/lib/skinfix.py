"""Skinning fixes for speed (M6.5 #12), applied by build_character.py after
the weight transfer. Measured with lib/skin.py (tools/blender/skin_check.py,
skin_stills.py; docs/m65/BODIES.md has the before and after).

pad_shell: the shoulder pad is a hard shell. The old hand-over
(build_character.pads_rigid) faded the cap from the chest to the upper arm
between |x| 0.22 and 0.30, so the cap's outer third (the epaulet and its
lip, x 0.22..0.30 m) was 70-95% upper arm: at the sprint's full arm swing
it travelled 10-13 cm with the arm while the rest of the cap stayed on the
chest, and stood up off the shoulder like a fin. Now the whole cap, out to
its lip, is shell (the sleeve slides under the lip, as a jersey does over
real pads), split between the pad bone (on the chest, with the runtime's
bounce spring) and, toward the outer edge, the clavicle, so the cap rides
the shoulder girdle when it elevates for an arm overhead (the build's
scapulohumeral rhythm, lib/poses.py). Below the lip the sleeve still
follows the arm: the hand-over sits in a 6 cm band under the lip
(LIP_BAND), where the fabric stretches rather than folds.
"""

from __future__ import annotations

import bpy

from .geo import smoothstep

# The pad cap and its lip (lib/gear.py jersey: cap to |x| 0.293 m, the lip
# 0.238..0.298 and down to z 1.46 over the deltoid). Above LIP_BAND[1] the
# jersey is shell; below LIP_BAND[0], outside the chest plate, it is sleeve.
LIP_BAND = (1.40, 1.46)
# Out to here (m) the shell holds (the lip's edge plus the widest pads
# variety shape, +4 cm: lib/shapes.py pads); past it the sleeve takes over.
SHELL_X = (0.33, 0.36)
# The clavicle's share of the shell grows toward the outer edge (the cap
# sits on the acromion; the plates over the chest and back stay on the
# chest).
CLAV_X = (0.12, 0.26)
CLAV_MAX = 0.8
CHEST_X = 0.20  # inside this the old chest-plate hand-over (pads_rigid) stands
PAD_X = (0.10, 0.18)  # the pad bone's share of the shell comes in across the plates


def pad_shell(ob: bpy.types.Object, where=None) -> int:
    """Re-skin the pad caps of a jersey mesh (rest coordinates, Blender
    frame) as a shell; `where(vertex)` limits it to some vertices (the jersey's
    part of a joined mesh). Returns how many vertices changed."""
    groups = ob.vertex_groups
    chest = groups.get("spine_04") or groups.new(name="spine_04")
    changed = 0
    for s in ("l", "r"):
        pad = groups.get(f"pad_{s}") or groups.new(name=f"pad_{s}")
        clav = groups.get(f"clavicle_{s}") or groups.new(name=f"clavicle_{s}")
        for v in ob.data.vertices:
            co = v.co
            if (co.x > 0) != (s == "l") or co.z < LIP_BAND[0] or (where and not where(v)):
                continue
            ax = abs(co.x)
            if ax < CHEST_X * 0.5:
                continue  # the collar and the plates over the sternum and spine
            # How much of this vertex is shell: above the lip band, inside the edge.
            k = smoothstep(LIP_BAND[0], LIP_BAND[1], co.z) * (1.0 - smoothstep(SHELL_X[0], SHELL_X[1], ax))
            if ax < CHEST_X:
                k = max(k, smoothstep(LIP_BAND[0] - 0.04, LIP_BAND[0] + 0.02, co.z))
            if k <= 0.0:
                continue
            cl = CLAV_MAX * smoothstep(CLAV_X[0], CLAV_X[1], ax)
            # The pad bone's bounce pivots at its head (x 0.17): toward the
            # middle the chest takes over, so the plates don't shear at the sternum.
            pd = (1.0 - cl) * smoothstep(PAD_X[0], PAD_X[1], ax)
            old = {groups[g.group].name: g.weight for g in v.groups}
            new = {n: w * (1.0 - k) for n, w in old.items()}
            new[pad.name] = new.get(pad.name, 0.0) + k * pd
            new[clav.name] = new.get(clav.name, 0.0) + k * cl
            new[chest.name] = new.get(chest.name, 0.0) + k * (1.0 - cl - pd)
            for g in list(v.groups):
                groups[g.group].remove([v.index])
            for n, w in new.items():
                if w > 1e-4:
                    groups[n].add([v.index], w, "REPLACE")
            changed += 1
    return changed

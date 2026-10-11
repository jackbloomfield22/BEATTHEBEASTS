"""Passing round 10 (docs/passing/PASSING10.md): the throw's finish.

Keyed here like every clip (CLAUDE.md rule 6): no downloaded, captured or
third-party motion.

Round nine's critique: the follow-through was short (the finish reached
0.15-0.19 s after the release and blended off into a stand over the next
0.25-0.43 s), and every throw finished the same way whatever it was: a
five-yard slant and a fifty-yard post. From the broadcast camera the release
read and then the arm was simply down.

Each QB's windup stays his own (actions.py qb_throw, actions_pass.py
qb_throw_quick / qb_throw_long: the Release rating's compact motion, the M4
throw, the loop). From the release frame on, a finish chosen by the throw
takes over (render/game/choreo.ts throwFinish swaps the playing throw for its
finish at the sim's release; up to the release frame the two are the same
clip, pose for pose and travel for travel, so the swap never shows):

- `_fin_flick`, the quick game (a slant, a hitch, a quick out: a driven ball
  under ~12 yd): compact. The ball's out with the arm and the hips, the hand
  comes through across the belly to the front hip (no big drop of the
  shoulder), the back foot comes up and lands level with the front one as the
  weight goes onto it. Finished 0.13 s after the release, held a beat.
- `_fin_drive`, the full throw (the driven intermediate ball and the deep
  ball): the whole body through it. The hips turn past square to the target
  (~40 deg), the chest goes over the front knee, the throwing arm finishes
  across the body outside the front thigh, the glove arm pulled in to the
  hip, the back foot swings through and lands a quarter metre past the front
  one with the weight over it; held, then a gather step up with the front
  foot. Finished 0.22 s after the release.
- `_fin_touch`, touch (a lofted ball: the fade, a ball dropped in over a man):
  the arm doesn't come down across him, it follows the ball out and up toward
  the target and stays there (the hand high and out in front, the wrist
  turned over, "reach for the target"), the body taller and less turned, the
  back foot comes up onto its toe and steps softly through; the eyes go up
  with the ball. Finished 0.22 s after the release, held a beat longer.

From quarterback coaching (the weight transfer onto the front foot, "finish
across the body", "the back foot comes through", "touch: the hand goes to the
target") and the broadcast picture of each throw. The hand targets are the
throwing (right) hand's wrist, as actions_pass.py keys them: x is his left, y
ahead is -, z up (m); the times are after the release (s).
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import IDLE, RELAXED, STANCES, Clip, hands_of, keyed, shift, with_upper
from .gait import FPS, smoothstep
from .transitions import Plant, Steps

# Each finish: the keys after the release (time after it, the throwing hand, the glove hand, the elbow poles,
# the pelvis's twist and flex and drop, the spine's flex / side bend / twist, the gaze), when the back foot
# lifts and lands and how far past the front foot it lands (m), the front foot's gather step (lift, land, m)
# when the back foot goes past it, how long the finish holds, and how long the whole recovery to a stand is.
# (Passing round 12: `kick`, the back foot's flight between its lift and its landing: when it's up (s after the
# release), how long it stays up, how high (m) and how far its heel is turned up (deg), and how far forward of where it
# was (m); `glove_pole`, the glove arm's elbow pole.)
#
# Passing round 12 (docs/passing/PASSING12.md). From the broadcast camera the QB is ~75-100 px tall at the release,
# seen from behind and above (the eye ~4-9 m behind him, 2-8 m to one side, 7 m up), and round ten's finishes were
# keyed for the side view: the flick's hand finished at his own front hip (0.10 m to his left), inside his silhouette
# from behind, and from behind and to his right (a throw to the right) the drive's too; the back foot came up 7 cm and
# landed beside the front one, so from above the legs read as one shape. A finish reads at that distance by its
# silhouette: the throwing arm long and its hand clear of the body, the glove elbow pulled back out of it, the back
# heel kicked up behind him as the hip drives through. Re-keyed within what a QB really does (from quarterback
# coaching: "thumb to the opposite pocket", the hand finishing outside the front thigh; "pull the front elbow back
# to the hip"; the back heel flips up as the back hip comes through, the quick game's "flamingo"): the flick's hand
# outside the front hip, the drive's outside the front knee, both a little longer in the arm; the hips 4-6 deg more
# round; the glove elbow back past his hip; the back heel up behind him (heel 70-80 deg, the ball of the foot
# 0.12-0.20 m up) for a beat before it comes down; the flick held 0.1 s longer. Measured from the broadcast eyes
# (qbfin.py, scratch; PASSING12.md has the numbers before and after).
FINISHES = {
    "flick": dict(
        keys=[
            (0.05, (0.04, -0.60, 1.44), (0.30, -0.10, 1.08), (-0.5, -0.4, 1.30), (16, 18, -0.12), (8, -2, 9), (5.0, 0.0, 0.9)),
            (0.13, (0.28, -0.50, 1.00), (0.34, 0.06, 1.02), (-0.6, -0.4, 1.15), (31, 25, -0.13), (12, -2, 14), (6.0, 0.0, 0.9)),
        ],
        hold=0.36, back=(0.02, 0.34, 0.0), gather=None, T=0.66,
        kick=(0.10, 0.14, 0.12, 75.0, 0.10), glove_pole=(0.8, 0.5, 1.0),
    ),
    "drive": dict(
        keys=[
            (0.07, (0.06, -0.62, 1.40), (0.32, -0.12, 1.06), (-0.7, -0.3, 1.30), (20, 22, -0.12), (10, -2, 9), (5.0, 0.0, 0.9)),
            (0.22, (0.32, -0.52, 0.82), (0.36, 0.08, 1.00), (-0.7, -0.3, 1.15), (39, 30, -0.13), (16, -3, 11), (3.0, 0.0, 0.9)),
            (0.46, (0.30, -0.50, 0.86), (0.35, 0.07, 1.02), (-0.7, -0.3, 1.15), (37, 27, -0.12), (14, -3, 10), (2.0, 0.0, 0.9)),
        ],
        hold=0.46, back=(0.04, 0.36, 0.25), gather=(0.58, 0.76), T=1.02,
        kick=(0.12, 0.10, 0.20, 80.0, 0.30), glove_pole=(0.8, 0.5, 1.0),
    ),
    "touch": dict(
        keys=[
            (0.08, (-0.04, -0.66, 1.64), (0.30, -0.06, 1.10), (-0.6, -0.4, 1.45), (14, 16, -0.12), (6, -2, 8), (0.0, 0.0, 0.9)),
            (0.22, (0.05, -0.62, 1.40), (0.32, 0.02, 1.06), (-0.5, -0.5, 1.35), (24, 18, -0.12), (7, -2, 10), (-6.0, 0.0, 0.9)),
            (0.42, (0.06, -0.60, 1.36), (0.32, 0.03, 1.06), (-0.5, -0.5, 1.30), (24, 17, -0.12), (6, -2, 10), (-8.0, 0.0, 0.9)),
        ],
        hold=0.42, back=(0.10, 0.40, 0.0), gather=None, T=0.86,
        kick=(0.16, 0.12, 0.10, 65.0, 0.12), glove_pole=(0.8, 0.5, 1.0),
    ),
}


def finish(base: Clip, kind: str) -> Clip:
    """`base` (a throw: actions.py qb_throw, actions_pass.py qb_throw_quick or
    qb_throw_long) as it is up to its release frame, then the `kind` finish."""
    d = FINISHES[kind]
    fr = base.events["release"]
    tr = fr / FPS
    T = tr + d["T"]
    # The body's travel: the base's up to the release, then on through the finish (the back foot's step past the
    # front one carries the hips that much further), eased in from the base's own pace at the release.
    s_rel = -base._travel(tr)[1]
    h = 1 / FPS
    v_rel = max(0.0, (-base._travel(tr)[1] + base._travel(tr - h)[1]) / h)
    # Where the stand ends: the base's own end, plus the back foot's step past the front one (the stand's feet are the
    # idle stance's, so the hand-over to it is where the feet really are).
    s_end = -base._travel(base.frames / FPS)[1] + d["back"][2]
    span = d["hold"] + 0.12

    def fwd(t: float) -> float:
        if t <= tr:
            return -base._travel(t)[1]
        u = min(1.0, (t - tr) / span)
        # Cubic Hermite from (s_rel, v_rel·span) to (s_end, 0): the stride's pace carried through the release.
        h00, h10, h01 = 2 * u**3 - 3 * u**2 + 1, u**3 - 2 * u**2 + u, -2 * u**3 + 3 * u**2
        # (The start tangent capped at 3x the distance left: monotone, so the body never travels back.)
        return h00 * s_rel + h10 * min(v_rel * span, 3 * max(0.0, s_end - s_rel)) + h01 * s_end

    def travel(t: float):
        return (0.0, -fwd(t))

    rel = base._pose(tr)
    qset = copy.deepcopy(STANCES["qb_set"])
    sp = lambda f, a, tw: {"spine_02": (f, a, tw), "spine_03": (f * 0.85, a, tw), "spine_04": (f * 0.5, 0, tw * 0.75)}  # noqa: E731

    def key(t_after: float, hr, hl, er, pel, spine, gaze):
        p = shift(with_upper(qset, {"r": hr, "l": hl}, {**hands_of(RELAXED, "r"), **hands_of(RELAXED, "l")}, {"r": er, "l": d.get("glove_pole", (0.7, 0.3, 1.0))}), 0.0, -fwd(tr + t_after))
        p.pelvis.update({"twist": pel[0], "flex": pel[1], "up": pel[2]})
        p.joints.update(sp(*spine))
        p.gaze = gaze
        return p

    fin_keys = [(tr + k[0], key(*k)) for k in d["keys"]]
    hold_t = tr + d["hold"]
    last = fin_keys[-1][1]
    if fin_keys[-1][0] < hold_t:
        fin_keys.append((hold_t, copy.deepcopy(last)))
    # The stand he recovers to: the idle stance where the feet end.
    stand = shift(copy.deepcopy(IDLE), 0.0, -s_end)
    keys = [(tr, rel), *fin_keys, (T, stand)]

    # The feet: both planted at the release (every base throw lands the front foot before it and lifts the back one after).
    r0, l0 = copy.deepcopy(rel.feet["r"]), copy.deepcopy(rel.feet["l"])
    lift_r, land_r, _past = d["back"]
    # The back foot comes up off its toe (the base throws have it rolled up ~35-40 deg by the release) and lands where the
    # stand has it: `past` m beyond the front foot for the drive, about level for the flick and the touch.
    plants = [Plant("r", tr, tr + lift_r, r0), Plant("r", tr + land_r, math.inf, copy.deepcopy(stand.feet["r"]))]
    if d.get("kick"):
        # (Passing round 12) The back heel kicked up behind him as the hip drives through: the foot held up in the air
        # (not a plant), its heel turned up, part of the way to where it lands, then down onto its plant.
        k_up, k_hold, k_lift, k_heel, k_fwd = d["kick"]
        land_f = stand.feet["r"]
        air = replace(copy.deepcopy(r0), heel=k_heel, lift=k_lift, x=r0.x + (land_f.x - r0.x) * 0.3, y=r0.y - k_fwd)
        plants.append(Plant("r", tr + k_up, tr + k_up + k_hold, air, contact=False))
    if d["gather"]:
        g0, g1 = d["gather"]
        # The gather: the front foot comes up level with the back one, at the stand's width.
        plants += [Plant("l", tr, tr + g0, l0, roll=10.0), Plant("l", tr + g1, math.inf, copy.deepcopy(stand.feet["l"]))]
    else:
        plants += [Plant("l", tr, math.inf, l0)]
    steps = Steps(plants, height=0.07)
    fol = fin_keys[-1][1]
    idle = copy.deepcopy(IDLE)

    def pose(t: float):
        if t <= tr:
            return base._pose(t)
        p = keyed(keys, t)
        if t > hold_t:
            # The hands let go of IK into the stand's hanging arms over the recovery, as the base throws do.
            k = 1.0 - smoothstep(hold_t, T, t)
            p.hands = {s: (*hh[:3], (hh[3] if len(hh) > 3 else 1.0) * k) for s, hh in fol.hands.items()}
            p.arms = {s: replace(a, weight=a.weight * (1.0 - k)) for s, a in idle.arms.items()}
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    frames = round(T * FPS)
    # Planted frames: the base's up to the release, the finish's after it.
    mine = steps.contacts(frames)

    def runs(sets: dict) -> dict:
        out = {}
        for s in "lr":
            fs = [f for f in range(frames + 1) if (f <= fr and any(a <= f < b for a, b in base.contacts[s])) or (f > fr and any(a <= f < b for a, b in mine[s]))]
            rr, cur = [], []
            for f in fs:
                if cur and f != cur[-1] + 1:
                    rr.append([cur[0], cur[-1] + 1])
                    cur = []
                cur.append(f)
            if cur:
                rr.append([cur[0], cur[-1] + 1])
            out[s] = rr
        return out

    return Clip(f"{base.name}_fin_{kind}", "transition", T, pose, travel, base.frm, base.to, contacts=runs(mine), events={"release": fr})


def p10_clips(bases: list[Clip]) -> list[Clip]:
    return [finish(b, k) for b in bases for k in FINISHES]

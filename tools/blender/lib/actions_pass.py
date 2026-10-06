"""The passing game's clips (docs/passing/PASSING.md): the throw by the man
throwing it, and the drop. Keyed here like every clip (CLAUDE.md rule 6): no
downloaded, captured or third-party motion.

The M4 throw (actions.py qb_throw) was the only throwing motion: every QB,
every release rating, clean pocket or a rusher in his face, threw the same
motion, only played faster or slower to land its release frame on the
sim's release. Technique, from quarterback coaching and the broadcast:

- qb_throw_quick (a quick release, Release ~90+: Marino, Brees): the ball
  never drops below the shoulder; it goes from the chest straight up to the
  ear (the "high carry"), a short six-inch stride, the hips and shoulders
  turn together and the elbow comes through at shoulder height. A compact,
  efficient motion: the release at frame 8 (0.27 s).
- qb_throw_long (a long release, Release ~72 and under): the ball drops away
  from the chest toward the back hip before it comes up behind the head (the
  "loop" scouts time), a long stride, the elbow late; the release at frame
  14 (0.47 s). The same pocket, a beat slower to the release, and the
  windup reads from the broadcast camera.
- qb_throw_fade (off platform: a rusher in his face, or his feet not set):
  no step into the throw. The back foot drops back, the weight stays on it,
  the trunk leans away and the arm alone delivers it high, with a short
  follow-through: the fall-away throw. Release at frame 9 (0.30 s).
- catch_drop (overlay): the hands meet the ball (its "secure" frame lands on
  the arrival, as a catch clip's does), the ball squirts out of them, the
  hands open and chase it down in front of his knees, the chest folding
  after it, then the arms fall away.

Each throw carries a "release" event (the frame the ball leaves the hand):
the render starts it so that frame lands on the sim's release (choreo.ts
throwClip picks the clip from the QB's Release rating and his pressure).
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import GRIP, IDLE, RELAXED, SPINE_UP, SPREAD, STANCES, Clip, arm_mask, hands_of, keyed, shift, with_upper
from .actions_m65 import DIAMOND_WRIST, ready_pose, upper
from .gait import FPS, smoothstep
from .transitions import Plant, Steps

ARMS = arm_mask("l") + arm_mask("r")


def _throw(name: str, T: float, S: float, keys_t: tuple[float, float, float, float], load_r, cock_r, rel_r, fol_r, *, twist=(-30, -32, 8, 24), flex=(0, 10, 16, 26), lean=0.0, feet=None, glove=(0.20, -0.52, 1.46)) -> Clip:
    """A throw from the set: load, cock, release, follow-through, into a
    stand. `S` is how far the stride carries the body forward (negative:
    back, the fade); `keys_t` the load, cock, release and follow-through
    times (s); the hand targets are the throwing (right) hand's; `twist` and
    `flex` the pelvis at each key; `lean` the spine's extra flexion (deg,
    negative leans back); `feet` the plants (side, lift, land)."""
    tl, tc, tr, tf = keys_t
    qset = copy.deepcopy(STANCES["qb_set"])
    idle = copy.deepcopy(IDLE)
    fwd = lambda t: S * smoothstep(min(0.05, tl * 0.5), tf, t) ** 1.2  # noqa: E731

    def travel(t):
        return (0.0, -fwd(t))

    end = shift(idle, 0.0, -S)
    plants = []
    for side, lift, land in feet:
        roll = 6.0 if side == "l" else 28.0
        plants.append(Plant(side, -1, lift, qset.feet[side], roll=roll))
        plants.append(Plant(side, land, math.inf, replace(end.feet[side], heel=-6.0) if side == "l" else end.feet[side]))
    steps = Steps(plants, height=0.06)
    grip_r, spread_r = hands_of(GRIP, "r"), hands_of(SPREAD, "r")
    sp = lambda f, a, tw: {"spine_02": (f + lean * 0.4, a, tw), "spine_03": (f + lean * 0.35, a, tw), "spine_04": (f * 0.5 + lean * 0.25, 0, tw * 0.75)}  # noqa: E731

    load = with_upper(qset, {"r": load_r, "l": (load_r[0] + 0.10, load_r[1] - 0.08, load_r[2] - 0.06)}, {**GRIP, "hand_r": (-30, 0, 20)}, {"r": (-0.8, 0.3, 1.2), "l": (0.3, -0.2, 1.1)})
    load.pelvis.update({"twist": twist[0], "up": -0.10, "flex": flex[0]})
    load.joints.update(sp(3, 0, -8))
    load.gaze = (3.0, 0.0, 0.8)
    cock = shift(with_upper(qset, {"r": cock_r, "l": glove}, {**grip_r, **hands_of(SPREAD, "l"), "hand_r": (-45, 0, 30)}, {"r": (-0.9, 0.0, 1.55), "l": (0.6, 0.0, 1.2)}), 0.0, -fwd(tc))
    cock.pelvis.update({"twist": twist[1], "up": -0.12, "flex": flex[1]})
    cock.joints.update(sp(0, 4, -10))
    cock.gaze = (3.0, 0.0, 0.9)
    rel = shift(with_upper(qset, {"r": rel_r, "l": (0.26, -0.10, 1.12)}, {**spread_r, **hands_of(RELAXED, "l"), "hand_r": (10, 0, 0)}, {"r": (-0.7, -0.2, 1.35), "l": (0.7, 0.3, 1.0)}), 0.0, -fwd(tr))
    rel.pelvis.update({"twist": twist[2], "up": -0.11, "flex": flex[2]})
    rel.joints.update(sp(6, -2, 6))
    rel.gaze = (4.0, 0.0, 0.9)
    fol = shift(with_upper(qset, {"r": fol_r, "l": (0.28, 0.02, 1.06)}, {**hands_of(RELAXED, "r"), **hands_of(RELAXED, "l")}, {"r": (-0.3, -0.5, 1.2), "l": (0.7, 0.4, 1.0)}), 0.0, -fwd(tf))
    fol.pelvis.update({"twist": twist[3], "up": -0.12, "flex": flex[3]})
    fol.joints.update(sp(10, -2, 10))
    fol.gaze = (6.0, 0.0, 0.9)
    stand = copy.deepcopy(end)
    keys = [(0.0, qset), (tl, load), (tc, cock), (tr, rel), (tf, fol), (T, stand)]

    def pose(t):
        p = keyed(keys, t)
        if t > tf:
            k = 1.0 - smoothstep(tf, T, t)
            p.hands = {s: (*h[:3], (h[3] if len(h) > 3 else 1.0) * k) for s, h in fol.hands.items()}
            p.arms = {s: replace(a, weight=a.weight * (1.0 - k)) for s, a in idle.arms.items()}
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip(name, "transition", T, pose, travel, "stance_qb_set", "stance_idle", steps, events={"release": round(tr * FPS)})


def qb_throw_quick() -> Clip:
    """Compact: the ball carried high, straight up to the ear, a short stride; release frame 8."""
    return _throw(
        "qb_throw_quick", 0.70, 0.22, (0.07, 0.20, 8 / FPS, 0.42),
        load_r=(-0.17, 0.02, 1.66), cock_r=(-0.28, 0.12, 1.66), rel_r=(-0.11, -0.44, 1.80), fol_r=(0.10, -0.40, 1.08),
        twist=(-24, -28, 8, 20), flex=(0, 8, 14, 22),
        feet=[("l", 0.05, 0.19), ("r", 0.40, 0.56)],
    )


def qb_throw_long() -> Clip:
    """The loop: the ball drops toward the back hip before it comes up behind the head, a long stride; release frame 14."""
    return _throw(
        "qb_throw_long", 1.00, 0.44, (0.20, 0.40, 14 / FPS, 0.66),
        load_r=(-0.30, 0.22, 1.24), cock_r=(-0.36, 0.20, 1.58), rel_r=(-0.11, -0.46, 1.76), fol_r=(0.19, -0.36, 0.98),
        twist=(-36, -36, 8, 28), flex=(2, 10, 18, 28),
        feet=[("l", 0.16, 0.40), ("r", 0.62, 0.82)],
    )


def qb_throw_fade() -> Clip:
    """Off platform: the back foot drops back, the weight stays on it, the trunk leans away and the arm delivers it high; release frame 9."""
    return _throw(
        "qb_throw_fade", 0.78, -0.24, (0.08, 0.22, 9 / FPS, 0.46),
        load_r=(-0.18, 0.04, 1.62), cock_r=(-0.30, 0.18, 1.64), rel_r=(-0.13, -0.34, 1.82), fol_r=(-0.02, -0.34, 1.30),
        twist=(-26, -28, -6, 4), flex=(-2, 0, 2, 4), lean=-6.0,
        feet=[("r", 0.04, 0.22), ("l", 0.30, 0.50)],
    )


def catch_drop() -> Clip:
    """The hands meet it (secure frame 8), it squirts out, the hands chase it down, the arms fall away (overlay)."""
    T = 0.95
    ts = 8 / FPS
    z = 1.30
    reach = upper({"l": (0.065, -0.50, z), "r": (-0.065, -0.50, z)}, {**SPREAD, **DIAMOND_WRIST}, {"l": (0.7, 0.0, z - 0.4), "r": (-0.7, 0.0, z - 0.4)})
    # It's off his hands: they spring apart and up a little, fingers wide.
    pop = upper({"l": (0.17, -0.48, z + 0.10), "r": (-0.17, -0.48, z + 0.10)}, {**SPREAD, "hand_l": (-20, 0, 20), "hand_r": (-20, 0, -20)}, {"l": (0.7, 0.1, z - 0.3), "r": (-0.7, 0.1, z - 0.3)})
    # Chasing it down in front of his knees, the chest folding after it.
    chase = upper({"l": (0.12, -0.46, 0.80), "r": (-0.10, -0.50, 0.84)}, {**SPREAD, "hand_l": (-10, 0, 60), "hand_r": (-10, 0, -60)}, {"l": (0.55, 0.1, 0.9), "r": (-0.55, 0.1, 0.9)})
    chase.joints.update({"spine_02": (8, 0, 0), "spine_03": (12, 0, 0), "spine_04": (10, 0, 0)})
    # Gone: the arms fall away, the trunk comes back up.
    gone = ready_pose()
    gone.joints.update({"spine_03": (4, 0, 0)})
    keys = [(0.0, ready_pose()), (ts - 0.09, reach), (ts, reach), (ts + 0.08, pop), (ts + 0.30, chase), (ts + 0.42, chase), (T, gone)]
    return Clip("catch_drop", "overlay", T, lambda t: keyed(keys, t), mask=ARMS + SPINE_UP, events={"secure": round(ts * FPS)})


def pass_clips() -> list[Clip]:
    return [qb_throw_quick(), qb_throw_long(), qb_throw_fade(), catch_drop()]

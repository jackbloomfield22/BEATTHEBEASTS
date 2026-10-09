"""Passing round 5 (docs/passing/PASSING5.md): the catch as a moment.

Keyed here like every clip (CLAUDE.md rule 6): no downloaded, captured or
third-party motion. Each clip carries "secure" (the ball in the hands: the
runtime starts the clip so that frame meets the ball) and "tuck" (put away
high and tight) events, as the M6.5 set does.

What round 4's critique found, and why these exist:
- The run-speed catches were authored on the idle body, standing straight.
  An overlay's arm rotations are local to the chest, so laid over the run
  (the trunk 13-17 degrees forward and the hips 8 cm down, gait.py) the
  hands came out ~0.2 m lower than keyed: the diamond met the ball at the
  belt and the "chest" key brought it in to the navel (the in-game catch
  log: the ball at 0.85 m a tenth of a second after the catch). These are
  authored on RUN_BASE, the run's mean trunk, so a key's height is where
  the hands are when he's running, and the ball comes in to the sternum.
- Every in-stride catch was the same clip. A broadcast shows the hands
  catch at the chest (thumbs together), over the face mask (thumbs, the
  arms up), at the knees (pinkies, the trunk folding over it), at the shoe
  tops (the scoop), reached for across the body (both arms long, the trunk
  leaning after them) and through contact (the hands strong, the ball
  chinned at once, the shoulder into the man). sim/catchstyle.ts says which.

Technique, from receiver coaching and the broadcast:
- Late hands: the arms keep pumping and the hands come up in the last ~0.2 s
  (a corner reads early hands as the ball arriving).
- Eyes, hands, tuck: look it into the hands, let them give, bring it to the
  sternum with both hands, then high and tight (the runtime's look-at keeps
  the eyes on the ball; the clip owns the hands and the chest).
- Thumbs together above the waist (the diamond), pinkies together below it.
- Through contact: no give, "chin it": both forearms clamp the ball under
  the chin at once, elbows in, the near shoulder dropped into the defender.
"""

from __future__ import annotations

from .actions import GRIP, IDLE, RELAXED, SPINE_UP, SPREAD, TUCK_ELBOW_R, TUCK_R, Clip, arm_mask, hands_of, keyed, with_upper
from .actions_m65 import DIAMOND_WRIST, PINKIES_WRIST, sided
from .gait import FPS, GAITS
from .poses import Pose

RUN = GAITS["run"]
ARMS = arm_mask("l") + arm_mask("r")
MASK = ARMS + SPINE_UP

# The run's mean trunk (gait.py gait_pose at the run's lean, no stride): the
# pelvis down and pitched forward, the lower spine with it. Arms keyed on
# this land where they're keyed when the overlay rides the run.
RUN_BASE = Pose(
    pelvis={"up": RUN.pelvis_up, "flex": RUN.lean * 0.65},
    joints={"spine_01": (RUN.lean * 0.05, 0, 0), "spine_02": (RUN.lean * 0.15, 0, 0), "spine_03": (RUN.lean * 0.15, 0, 0), "neck_01": (3, 0, 0), **RELAXED},
    feet=dict(IDLE.feet),
)
# The chest on RUN_BASE leans this far ahead of the idle one at the sternum (m): RUN_BASE at 1.3 m, from the run's lean.
FWD = 0.07


def run_upper(hands: dict, joints: dict, elbow: dict, spine: tuple = (0.0, 0.0, 0.0)) -> Pose:
    """Hands, fingers and elbows keyed on the run's trunk; `spine` adds (flex) to spine_02..04 (negative: chest up)."""
    j = {**joints}
    for k, d in zip(SPINE_UP, spine):
        f0 = RUN_BASE.joints.get(k, (0, 0, 0))
        j[k] = (f0[0] + d, *(j.get(k, f0)[1:]))
    return with_upper(RUN_BASE, hands, j, elbow)


def events(secure: float, tuck: float) -> dict:
    return {"secure": round(secure * FPS), "tuck": round(tuck * FPS)}


def carriage() -> Pose:
    """The run's arm carriage at mid-swing, as the overlay fades in over it: elbows at ~90 degrees, hands at the hips."""
    return run_upper({"l": (0.21, -0.20, 1.02), "r": (-0.21, -0.20, 1.02)}, {**RELAXED}, {"l": (0.45, 0.35, 1.05), "r": (-0.45, 0.35, 1.05)})


def tuck() -> Pose:
    """High and tight in the right arm on the run's trunk (actions.carry_pose's tuck, ridden forward with the chest), the left hand over the nose."""
    return run_upper(
        {"r": (TUCK_R[0], TUCK_R[1] - FWD, TUCK_R[2] - 0.02), "l": (0.02, -0.30 - FWD, 1.28)},
        {**hands_of(GRIP, "r"), **hands_of(SPREAD, "l"), "hand_r": (-15, 0, 10), "hand_l": (20, 0, -10)},
        {"r": (TUCK_ELBOW_R[0], TUCK_ELBOW_R[1] - FWD, TUCK_ELBOW_R[2]), "l": (0.45, 0.2 - FWD, 0.9)},
    )


def sternum(spine: tuple = (2.0, 2.0, 1.0)) -> Pose:
    """Both hands on the ball at the sternum (the ball's centre ~1.33 m, a hand's width off the chest), elbows in."""
    return run_upper({"l": (0.07, -0.33 - FWD + 0.07, 1.31), "r": (-0.06, -0.31 - FWD + 0.07, 1.33)}, {**GRIP, "hand_l": (10, 0, -25), "hand_r": (-10, 0, 20)}, {"l": (0.45, 0.25, 1.0), "r": (-0.45, 0.25, 1.0)}, spine)


# --- The hands catch at the chest (RUN): late hands, the diamond, the give, the sternum, the tuck ---------


def hands_run() -> Clip:
    """The in-stride catch at the chest (overlay: arms and the upper spine).

    Re-keyed for passing round 5 on the run's trunk (see the module notes):
    the hands come up out of the run's carriage in the last 0.17 s (late
    hands), out to the ball in the diamond at chest height with the chest
    lifted a few degrees (arms long, ~0.55 m in front of the shoulders),
    give 8 cm as it lands, bring it to the sternum in both hands by +0.15 s
    with the chest folding over it, and put it away high and tight by
    +0.33 s. The runtime's IK puts the hands on the ball itself (a Catching
    95 meets it at the end of his arms, a 60 closer in: choreo.ts PLUCK).
    """
    T = 0.9
    ts, tt = 9 / FPS, 19 / FPS
    z = 1.36
    up = run_upper({"l": (0.12, -0.36, z - 0.10), "r": (-0.12, -0.36, z - 0.10)}, {**RELAXED, **DIAMOND_WRIST}, {"l": (0.55, 0.10, z - 0.45), "r": (-0.55, 0.10, z - 0.45)}, (-2, -2, -1))
    reach = run_upper({"l": (0.065, -0.60, z), "r": (-0.065, -0.60, z)}, {**SPREAD, **DIAMOND_WRIST}, {"l": (0.65, -0.05, z - 0.40), "r": (-0.65, -0.05, z - 0.40)}, (-3, -3, -2))
    give = run_upper({"l": (0.055, -0.50, z - 0.02), "r": (-0.055, -0.50, z - 0.02)}, {**GRIP, **DIAMOND_WRIST}, {"l": (0.60, 0.05, z - 0.45), "r": (-0.60, 0.05, z - 0.45)}, (-1, -1, 0))
    keys = [(0.0, carriage()), (ts - 0.17, up), (ts - 0.06, reach), (ts, reach), (ts + 0.05, give), (ts + 0.15, sternum()), (tt, tuck()), (T, tuck())]
    return Clip("catch_hands_run", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


def hands_run_low() -> Clip:
    """Below the belt: the pinkies together, palms up, the trunk folding over it; scooped up to the sternum, then the tuck."""
    T = 0.9
    ts, tt = 9 / FPS, 19 / FPS
    z = 0.84
    up = run_upper({"l": (0.11, -0.38, z + 0.16), "r": (-0.11, -0.38, z + 0.16)}, {**RELAXED, **PINKIES_WRIST}, {"l": (0.5, 0.15, z + 0.25), "r": (-0.5, 0.15, z + 0.25)}, (6, 4, 2))
    reach = run_upper({"l": (0.075, -0.52, z), "r": (-0.075, -0.52, z)}, {**SPREAD, **PINKIES_WRIST}, {"l": (0.5, 0.1, z + 0.25), "r": (-0.5, 0.1, z + 0.25)}, (12, 9, 5))
    give = run_upper({"l": (0.065, -0.46, z + 0.07), "r": (-0.065, -0.46, z + 0.07)}, {**GRIP, **PINKIES_WRIST}, {"l": (0.5, 0.1, z + 0.3), "r": (-0.5, 0.1, z + 0.3)}, (9, 7, 4))
    keys = [(0.0, carriage()), (ts - 0.17, up), (ts - 0.06, reach), (ts, reach), (ts + 0.05, give), (ts + 0.17, sternum()), (tt, tuck()), (T, tuck())]
    return Clip("catch_hands_run_low", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


def hands_high() -> Clip:
    """Over the face mask, not a jump ball: the arms up, the diamond above the eyes, the chest lifted; pulled down to the sternum, then the tuck."""
    T = 0.9
    ts, tt = 9 / FPS, 19 / FPS
    z = 1.80
    up = run_upper({"l": (0.13, -0.38, 1.50), "r": (-0.13, -0.38, 1.50)}, {**RELAXED, **DIAMOND_WRIST}, {"l": (0.6, 0.1, 1.1), "r": (-0.6, 0.1, 1.1)}, (-4, -4, -3))
    reach = run_upper({"l": (0.065, -0.46, z), "r": (-0.065, -0.46, z)}, {**SPREAD, "hand_l": (-55, 0, 0), "hand_r": (-55, 0, 0)}, {"l": (0.6, 0.0, 1.35), "r": (-0.6, 0.0, 1.35)}, (-8, -7, -5))
    give = run_upper({"l": (0.055, -0.40, z - 0.08), "r": (-0.055, -0.40, z - 0.08)}, {**GRIP, "hand_l": (-45, 0, 0), "hand_r": (-45, 0, 0)}, {"l": (0.6, 0.05, 1.3), "r": (-0.6, 0.05, 1.3)}, (-6, -5, -4))
    keys = [(0.0, carriage()), (ts - 0.17, up), (ts - 0.06, reach), (ts, reach), (ts + 0.05, give), (ts + 0.17, sternum()), (tt, tuck()), (T, tuck())]
    return Clip("catch_hands_high", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


def scoop() -> Clip:
    """At his shoe tops: the trunk folds deep over it (the runtime sinks his hips with it), the pinkies under the ball, scooped up into the chest."""
    T = 0.95
    ts, tt = 10 / FPS, 21 / FPS
    up = run_upper({"l": (0.11, -0.42, 0.95), "r": (-0.11, -0.42, 0.95)}, {**RELAXED, **PINKIES_WRIST}, {"l": (0.5, 0.15, 1.2), "r": (-0.5, 0.15, 1.2)}, (10, 8, 5))
    reach = run_upper({"l": (0.08, -0.62, 0.50), "r": (-0.08, -0.62, 0.50)}, {**SPREAD, "hand_l": (-20, 0, 75), "hand_r": (-20, 0, -75)}, {"l": (0.45, -0.1, 0.95), "r": (-0.45, -0.1, 0.95)}, (24, 18, 12))
    lift = run_upper({"l": (0.07, -0.55, 0.62), "r": (-0.07, -0.55, 0.62)}, {**GRIP, **PINKIES_WRIST}, {"l": (0.45, -0.05, 1.0), "r": (-0.45, -0.05, 1.0)}, (20, 15, 10))
    keys = [(0.0, carriage()), (ts - 0.2, up), (ts - 0.07, reach), (ts, reach), (ts + 0.07, lift), (ts + 0.22, sternum((4, 3, 2))), (tt, tuck()), (T, tuck())]
    return Clip("catch_scoop", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


def reach_side(side: str) -> Clip:
    """Across or outside his frame (authored on his left): both arms long to it at chest height, the trunk leaning and turning after them, the thumbs in; pulled across into the sternum, then the tuck (the right arm, as every carry)."""
    T = 0.9
    ts, tt = 9 / FPS, 20 / FPS
    m = sided(side)
    lean = {"spine_02": (0, 5, 6), "spine_03": (0, 7, 9), "spine_04": (0, 5, 7)}

    def leaning(p: Pose, k: float) -> Pose:
        for b, (fl, ab, tw) in lean.items():
            f0 = p.joints.get(b, (0, 0, 0))
            p.joints[b] = (f0[0] + fl, f0[1] + ab * k, f0[2] + tw * k)
        return p

    up = leaning(run_upper({"l": (0.30, -0.40, 1.28), "r": (0.06, -0.42, 1.28)}, {**RELAXED, **DIAMOND_WRIST}, {"l": (0.7, 0.1, 1.0), "r": (-0.3, 0.0, 0.95)}, (-1, -1, 0)), 0.5)
    reach = leaning(run_upper({"l": (0.66, -0.40, 1.33), "r": (0.48, -0.50, 1.33)}, {**SPREAD, "hand_l": (-35, 0, 35), "hand_r": (-35, 0, 35)}, {"l": (0.85, 0.2, 1.05), "r": (0.05, -0.05, 0.95)}, (-2, -2, -1)), 1.0)
    give = leaning(run_upper({"l": (0.55, -0.40, 1.32), "r": (0.38, -0.48, 1.32)}, {**GRIP, "hand_l": (-30, 0, 30), "hand_r": (-30, 0, 30)}, {"l": (0.8, 0.2, 1.0), "r": (0.0, 0.0, 0.95)}, (-1, -1, 0)), 0.9)
    keys = [(0.0, carriage()), (ts - 0.17, m(up)), (ts - 0.06, m(reach)), (ts, m(reach)), (ts + 0.05, m(give)), (ts + 0.18, m(sternum())), (tt, tuck()), (T, tuck())]
    return Clip(f"catch_reach_{side}", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


def contested(side: str) -> Clip:
    """Through contact, the defender on his left (authored on the left): the near shoulder dropped and turned into him (the box-out), the hands
    strong and late in front of the face mask; snatched with no give and chinned at once, both forearms clamped over it under the chin, the
    chest folded over it through the hit; tucked late (+0.4 s)."""
    T = 1.0
    ts, tt = 9 / FPS, 21 / FPS
    m = sided(side)
    # Into the man on the left: the trunk tips and turns toward him, the left shoulder down.
    box = {"spine_02": (0, 4, 5), "spine_03": (0, 6, 7), "spine_04": (0, 5, 5)}

    def boxing(p: Pose, k: float) -> Pose:
        for b, (fl, ab, tw) in box.items():
            f0 = p.joints.get(b, (0, 0, 0))
            p.joints[b] = (f0[0] + fl, f0[1] + ab * k, f0[2] + tw * k)
        return p

    up = boxing(run_upper({"l": (0.12, -0.36, 1.32), "r": (-0.12, -0.38, 1.36)}, {**RELAXED, **DIAMOND_WRIST}, {"l": (0.5, 0.15, 1.0), "r": (-0.55, 0.1, 1.0)}, (0, 0, 0)), 0.6)
    reach = boxing(run_upper({"l": (0.07, -0.54, 1.46), "r": (-0.07, -0.54, 1.46)}, {**SPREAD, **DIAMOND_WRIST}, {"l": (0.5, 0.0, 1.05), "r": (-0.5, 0.0, 1.05)}, (-2, -2, -1)), 1.0)
    snatch = boxing(run_upper({"l": (0.06, -0.50, 1.44), "r": (-0.06, -0.50, 1.44)}, {**GRIP, **DIAMOND_WRIST}, {"l": (0.42, 0.0, 1.05), "r": (-0.42, 0.0, 1.05)}, (-1, -1, 0)), 1.0)
    # Chinned: the ball under the face mask, both forearms over it, elbows pinned in.
    chin = boxing(run_upper({"l": (0.07, -0.24 - FWD, 1.42), "r": (-0.06, -0.23 - FWD, 1.44)}, {**GRIP, "hand_l": (25, 0, -30), "hand_r": (-5, 0, 30)}, {"l": (0.30, 0.15, 1.05), "r": (-0.30, 0.15, 1.05)}, (6, 5, 4)), 1.0)
    keys = [(0.0, carriage()), (ts - 0.15, m(up)), (ts - 0.05, m(reach)), (ts, m(reach)), (ts + 0.03, m(snatch)), (ts + 0.1, m(chin)), (tt - 0.08, m(chin)), (tt + 0.04, tuck()), (T, tuck())]
    return Clip(f"catch_contested_{side}", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


def body() -> Clip:
    """The body catch (SECURE, and the weak-handed man's way): elbows pinned to the ribs, forearms up and together, the ball let into the
    chest at the numbers and trapped there, the chest folding over it and both hands covering it; then the tuck (overlay).

    Re-keyed on the run's trunk for passing round 5 (the M6.5 cradle,
    authored on the idle body, trapped it at the belt over the run)."""
    T = 0.8
    ts, tt = 8 / FPS, 17 / FPS
    basket = run_upper({"l": (0.11, -0.36 - FWD + 0.07, 1.17), "r": (-0.11, -0.36 - FWD + 0.07, 1.17)}, {**SPREAD, "hand_l": (-30, 0, 60), "hand_r": (-30, 0, -60)}, {"l": (0.30, 0.12, 0.92), "r": (-0.30, 0.12, 0.92)}, (2, 2, 1))
    trap = run_upper({"l": (0.09, -0.32 - FWD + 0.07, 1.22), "r": (-0.09, -0.32 - FWD + 0.07, 1.22)}, {**SPREAD, "hand_l": (-15, 0, 55), "hand_r": (-15, 0, -55)}, {"l": (0.30, 0.15, 0.92), "r": (-0.30, 0.15, 0.92)}, (5, 6, 4))
    wrap = run_upper({"l": (0.07, -0.27 - FWD + 0.07, 1.30), "r": (-0.08, -0.26 - FWD + 0.07, 1.26)}, {**GRIP, "hand_l": (10, 0, 30), "hand_r": (0, 0, -20)}, {"l": (0.36, 0.2, 0.92), "r": (-0.36, 0.2, 0.92)}, (6, 10, 8))
    cover = run_upper({"r": (-0.05, -0.32, 1.21), "l": (0.02, -0.38, 1.25)}, {**GRIP, "hand_l": (30, 0, -10)}, {"r": (TUCK_ELBOW_R[0], TUCK_ELBOW_R[1] - FWD, TUCK_ELBOW_R[2]), "l": (0.45, 0.2 - FWD, 0.9)}, (6, 8, 6))
    keys = [(0.0, carriage()), (ts - 0.14, basket), (ts, trap), (ts + 0.08, wrap), (tt - 0.05, cover), (tt + 0.1, tuck()), (T, tuck())]
    return Clip("catch_body", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


def p5_clips() -> list[Clip]:
    return [body(), hands_high(), scoop(), reach_side("l"), reach_side("r"), contested("l"), contested("r")]

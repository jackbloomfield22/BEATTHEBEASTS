"""M5.5 clips (feedback items 4 and 6): the quarterback under center (his
drops, the handoff, the play-action fake, the tuck and his slide), the back
taking a handoff, and the pass rusher's get-off and redirect step. Keyed
here like every clip (CLAUDE.md rule 6): no downloaded, captured or
third-party motion. The drops and the slide are technique clips.

Timings and shapes, from coaching descriptions:
- Under center: the snap is a hand-to-hand exchange (~0.1 s), then a drop
  straight back: three steps (~0.95 s, ~3.4 m) or five (~1.3 s, ~5.3 m),
  the first step with the throwing-side foot, the last one setting.
- Handoff (a back on the QB's right): the ball comes off the chest with
  both hands, the near (right) hand places it in the back's belly at the
  waist, the QB's eyes on the pocket; the empty hands then carry out the
  fake to the hip.
- Play-action: the same reach, but the ball stays in the hands and comes
  back to the chest as the QB turns to set.
- The back's pocket: the inside arm up across the chest (elbow high), the
  outside arm low across the belly, palms facing; the arms close on the
  ball and tuck it.
- The tuck: the ball comes off the chest into the throwing-side arm, high
  and tight, as the QB takes off.
- QB slide: feet first, like a baseball slide: lean back, the lead leg
  extended with the toes up, the trail leg bent under, sliding on the
  hip and thigh, the ball tucked; he ends on his back.
- Pass rusher's get-off after a shed: pads low, a forward lean that the
  first strides lift out of (the legs are the run's).
- Redirect: a hard plant on the outside foot, hips sink, the push goes the
  other way (a juke's footwork without the ball).
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import HEAD, HOLD, HOLD_ELBOW, IDLE, SPINE_UP, Clip, arm_mask, carry_pose, hands_of, keyed, mirrored, mix, run_at, shift, with_upper
from .gait import FPS, GAITS, smoothstep
from .poses import GRIP, RELAXED, SPREAD, STANCES, Arm, Foot, Pose
from .transitions import Plant, Steps, _hermite

RUN = GAITS["run"]


# --- Quarterback under center ----------------------------------------------


def qb_drop_uc(steps_n: int) -> Clip:
    """Under center: take the snap hand to hand, drop straight back, set.
    The body travels backward (+y); the right foot opens first."""
    T, D = (0.95, 3.4) if steps_n == 3 else (1.3, 5.3)
    uc, qset = copy.deepcopy(STANCES["qb_center"]), copy.deepcopy(STANCES["qb_set"])

    def back(t):
        # A beat for the exchange, then the drop.
        return _hermite(0.0, D, 0.0, 0.0, T * 0.9, min(max(0.0, t - 0.06), T * 0.9))

    def travel(t):
        return (0.0, back(t))

    end = shift(qset, 0.0, D)

    def when(x):
        lo, hi = 0.0, T
        for _ in range(40):
            mid = (lo + hi) / 2
            if back(mid) < x:
                lo = mid
            else:
                hi = mid
        return lo

    n = steps_n
    P = [(i + 0.5) * D / n for i in range(n)]
    H = 0.22
    plants = [Plant("r", -1, 0.08, uc.feet["r"], roll=8.0), Plant("l", -1, when(min(H, P[0])), uc.feet["l"], roll=10.0)]
    for i in range(n):
        side = "r" if i % 2 == 0 else "l"
        base = uc.feet[side]
        if i == n - 1:
            plants.append(Plant(side, when(max(0.0, D - H)), math.inf, end.feet[side]))
            break
        plants.append(Plant(side, when(max(0.0, P[i] - H)), when(P[i] + H), replace(base, x=base.x * 1.1, y=base.y + P[i], heel=16, out=20 if side == "r" else 10), roll=12.0))
    last = "l" if n % 2 == 1 else "r"
    plants.append(Plant(last, min(T - 0.02, max(when(D - 0.02), when(max(0.0, D - H)) + 0.12)), math.inf, end.feet[last]))
    steps = Steps(plants, height=0.08)
    # The exchange: the ball's in the hands at ~0.08 s, up to the chest by 0.3 s.
    snap = with_upper(uc, {"l": (0.04, -0.28, 0.72), "r": (-0.03, -0.27, 0.74)}, {**GRIP}, {"l": (0.5, 0.2, 0.7), "r": (-0.5, 0.2, 0.7)})

    def pose(t):
        b = back(t)
        p = mix(shift(uc, 0.0, b), shift(qset, 0.0, b), smoothstep(0.06, 0.85 * T, t))
        up = shift(qset, 0.0, b)
        if t < 0.3:
            c = shift(snap, 0.0, b)
            p.hands = mix(shift(uc, 0.0, b), c, smoothstep(0.0, 0.08, t)).hands if t < 0.08 else mix(c, up, smoothstep(0.08, 0.3, t)).hands
            p.elbow = {s: (e[0], e[1] + b, e[2]) for s, e in HOLD_ELBOW.items()}
        else:
            p.hands = up.hands
            p.elbow = up.elbow
        p.joints.update(GRIP if t > 0.06 else {})
        # The first step turns the hips open to the throwing side; square up to set.
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) - 24.0 * math.sin(math.pi * smoothstep(0.08, 0.85 * T, t))
        p.gaze = (3.0, 18.0 * math.sin(math.pi * smoothstep(0.08, 0.85 * T, t)), 0.6)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip(f"qb_drop_uc{steps_n}", "transition", T, pose, travel, "stance_qb_center", "stance_qb_set", steps)


def handoff() -> Clip:
    """Overlay: the ball off the chest to the back's belly on the QB's right,
    placed with the right hand (frame 10, 0.33 s), then the empty hands carry
    out the fake to the hip."""
    T = 0.8
    hold = with_upper(IDLE, HOLD, {**GRIP, "hand_l": (-10, 0, -20), "hand_r": (-25, 0, 15)}, HOLD_ELBOW)
    reach = with_upper(IDLE, {"r": (-0.36, -0.22, 1.04), "l": (-0.22, -0.26, 1.06)}, {**GRIP, "spine_03": (4, 0, -10), "spine_04": (2, 0, -6)}, {"r": (-0.8, 0.2, 1.0), "l": (0.2, 0.3, 0.95)})
    place = with_upper(IDLE, {"r": (-0.46, -0.16, 1.00), "l": (0.10, -0.26, 1.10)}, {**hands_of(SPREAD, "r"), **hands_of(GRIP, "l"), "spine_03": (6, 0, -14), "spine_04": (2, 0, -8)}, {"r": (-0.9, 0.2, 0.95), "l": (0.5, 0.3, 0.95)})
    fake = with_upper(IDLE, {"r": (0.02, -0.18, 1.02), "l": (0.10, -0.20, 1.04)}, {**GRIP, "spine_03": (2, 0, 6)}, {"r": (-0.5, 0.3, 0.9), "l": (0.5, 0.3, 0.9)})
    keys = [(0.0, hold), (0.2, reach), (0.33, place), (0.55, fake), (T, fake)]
    return Clip("ovl_handoff_r", "overlay", T, lambda t: keyed(keys, t), mask=arm_mask("l") + arm_mask("r") + SPINE_UP, events={"place": 10})


def pa_fake() -> Clip:
    """Overlay: the play-action fake to the right: the same reach as the
    handoff, the ball kept, back to the chest as he turns to set."""
    T = 0.7
    hold = with_upper(IDLE, HOLD, {**GRIP, "hand_l": (-10, 0, -20), "hand_r": (-25, 0, 15)}, HOLD_ELBOW)
    reach = with_upper(IDLE, {"r": (-0.38, -0.22, 1.03), "l": (-0.24, -0.26, 1.05)}, {**GRIP, "spine_03": (5, 0, -12), "spine_04": (2, 0, -7)}, {"r": (-0.8, 0.2, 1.0), "l": (0.2, 0.3, 0.95)})
    keys = [(0.0, hold), (0.2, reach), (0.34, reach), (0.55, hold), (T, hold)]
    return Clip("ovl_pa_fake_r", "overlay", T, lambda t: keyed(keys, t), mask=arm_mask("l") + arm_mask("r") + SPINE_UP)


def take() -> Clip:
    """Overlay, the back taking a handoff from a QB on his left: the pocket
    (left arm up across the chest, right arm low), then it closes and the
    ball is tucked in the right arm."""
    T = 0.55
    pocket = with_upper(IDLE, {"l": (-0.08, -0.26, 1.36), "r": (0.08, -0.25, 0.98)}, {**SPREAD, "hand_l": (0, 0, 70), "hand_r": (0, 0, -70)}, {"l": (0.55, 0.0, 1.45), "r": (-0.5, 0.25, 0.9)})
    closed = with_upper(IDLE, {"l": (-0.04, -0.28, 1.24), "r": (0.02, -0.27, 1.08)}, {**GRIP}, {"l": (0.5, 0.1, 1.3), "r": (-0.5, 0.3, 0.95)})
    tuck = carry_pose()
    keys = [(0.0, pocket), (0.2, pocket), (0.32, closed), (0.5, tuck), (T, tuck)]
    return Clip("ovl_take_r", "overlay", T, lambda t: keyed(keys, t), mask=arm_mask("l") + arm_mask("r"), events={"secure": 9})


def tuck() -> Clip:
    """Overlay: the scramble's tuck: off the chest into the right arm, high and tight."""
    T = 0.3
    hold = with_upper(IDLE, HOLD, {**GRIP, "hand_l": (-10, 0, -20), "hand_r": (-25, 0, 15)}, HOLD_ELBOW)
    mid = with_upper(IDLE, {"r": (-0.07, -0.26, 1.22), "l": (0.02, -0.29, 1.22)}, {**GRIP}, {"r": (-0.4, 0.4, 0.9), "l": (0.45, 0.25, 0.95)})
    keys = [(0.0, hold), (0.12, mid), (0.26, carry_pose()), (T, carry_pose())]
    return Clip("ovl_tuck", "overlay", T, lambda t: keyed(keys, t), mask=arm_mask("l") + arm_mask("r"))


def qb_slide() -> Clip:
    """Feet first out of the run: lean back, the left leg out with the toes
    up, the right bent under, slide on the hip to a stop, onto the back."""
    T = 0.95
    v = RUN.speed
    D = 2.6

    def fwd(t):
        return _hermite(0.0, D, v, 0.0, 0.8, min(t, 0.8))

    def travel(t):
        return (0.0, -fwd(t))

    run0 = run_at(0)
    carry = carry_pose()
    lean = copy.deepcopy(run0)
    lean.pelvis.update({"up": -0.28, "flex": -8})
    lean.joints.update({"spine_02": (-8, 0, 0), "spine_03": (-6, 0, 0), "neck_01": (12, 0, 0)})
    sit = Pose(
        pelvis={"forward": 0.0, "up": -0.80, "flex": -30},
        joints={"spine_02": (-6, 0, 0), "spine_03": (-4, 0, 0), "neck_01": (22, 0, 0), "head": (6, 0, 0), **RELAXED},
        feet={"l": Foot(0.12, -0.82, heel=-65, out=8), "r": Foot(-0.14, -0.20, heel=70, out=30)},
        arms={"l": Arm(flex=-20, elbow=60, abd=35, inward=0.1)},
        knee=(0.0, 0.0, 0.9),
    )
    down = copy.deepcopy(STANCES["down_supine"])
    keys = [(0.0, run0), (0.14, lean), (0.34, sit), (0.66, sit), (0.84, down), (T, down)]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, -fwd(t))
        # The ball stays tucked in the right arm the whole way.
        tk = shift(carry, 0.0, -fwd(t))
        p.hands = {**{k: v for k, v in p.hands.items() if k != "r"}, "r": tk.hands["r"]}
        p.elbow = {**{k: v for k, v in p.elbow.items() if k != "r"}, "r": tk.elbow["r"]}
        p.joints.update(hands_of(GRIP, "r"))
        if t < 0.12:
            # Push off the left (down at the run's phase 0); the right swings through.
            p.feet = {"l": run0.feet["l"], "r": shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}
        p.knee = (0.0, -0.9 * (1 - smoothstep(0.12, 0.34, t)), 0.9 * smoothstep(0.12, 0.34, t))
        return p

    # Planted only while a foot is really still: the left at the push-off, both once he lies still.
    contacts = {"l": [[0, round(0.1 * FPS)], [round(0.86 * FPS), round(T * FPS)]], "r": [[round(0.86 * FPS), round(T * FPS)]]}
    return Clip("qb_slide", "transition", T, pose, travel, "loco_run", "stance_down_supine", contacts=contacts)


# --- Pass rusher -------------------------------------------------------------


def getoff() -> Clip:
    """Overlay: the chase get-off after a shed: the pads drop and the trunk
    leans into the first strides, then lifts out of it (the legs are the run's)."""
    T = 0.6
    up = copy.deepcopy(IDLE)
    low = copy.deepcopy(IDLE)
    low.joints.update({"spine_02": (16, 0, 0), "spine_03": (12, 0, 0), "spine_04": (6, 0, 0), "neck_01": (-18, 0, 0), "head": (-10, 0, 0)})
    keys = [(0.0, up), (0.1, low), (0.3, low), (T, up)]
    return Clip("ovl_getoff", "overlay", T, lambda t: keyed(keys, t), mask=[*SPINE_UP, *HEAD])


def redirect_left() -> Clip:
    """Out of the run (left touch-down): the right foot plants outside, the
    hips sink, the push goes left; the left lands across and the run goes on
    (phase 0.5). A juke's footwork with empty hands and a shorter push."""
    T = 13 / FPS
    v = RUN.speed
    L = 0.45

    def fwd(t):
        return v * t - 0.35 * math.sin(math.pi * t / T) ** 2

    def side(t):
        return L * smoothstep(0.10, 0.38, t)

    def travel(t):
        return (side(t), -fwd(t))

    def at(p: Pose, t: float) -> Pose:
        return shift(p, side(t), -fwd(t))

    run0 = run_at(0)
    end = at(run_at(10), T)
    r1 = Foot(x=side(0.17) - 0.24, y=-fwd(0.17) - 0.05, heel=10, out=-14)
    l1 = Foot(x=side(0.32) + 0.08, y=-fwd(0.32) - 0.07, heel=6, out=10)
    steps = Steps([
        Plant("l", -1, 0.07, run0.feet["l"], roll=20),
        Plant("l", 0.29, 0.37, l1, roll=25),
        Plant("l", T, math.inf, end.feet["l"], contact=False),
        Plant("r", 0.12, 0.225, r1, roll=25),
        Plant("r", T, math.inf, end.feet["r"]),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}, height=0.11)

    def pose(t):
        p = at(run_at(10 * t / T), t)
        b = math.sin(math.pi * smoothstep(0.08, 0.34, t))
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.11 * b
        p.pelvis["lateral"] = p.pelvis.get("lateral", 0.0) + 10.0 * b
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + 8.0 * b
        p.pelvis["flex"] = p.pelvis.get("flex", 0.0) + 6.0 * b
        p.gaze = (6.0, 14.0 * b)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("rush_redirect_l", "transition", T, pose, travel, "loco_run", "loco_run", steps, to_phase=0.5)


def m55_clips() -> list[Clip]:
    ho, pa, tk, rl = handoff(), pa_fake(), take(), redirect_left()
    return [
        qb_drop_uc(3), qb_drop_uc(5),
        ho, mirrored(ho, "ovl_handoff_l"), pa, mirrored(pa, "ovl_pa_fake_l"), tk, mirrored(tk, "ovl_take_l"),
        tuck(), qb_slide(), getoff(), rl, mirrored(rl, "rush_redirect_r", to_phase=0.0),
    ]

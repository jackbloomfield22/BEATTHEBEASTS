"""M6 special teams and officials. Keyed here (CLAUDE.md rule 6).

Clip events (frames) are what the game syncs the ball to: the snap's
release, the holder's catch and placement, the kick's contact, the punt's
catch, drop and contact, a signal's hold, the whistle.

Timings and shapes, from coaching descriptions and NFL operation times:
- Long snap: a wide, even base, hips a little above the knees, the ball
  out in front at arm's length, the right hand on the laces, the left a
  guide, eyes back between the legs. The arms whip straight back through
  the legs and the ball leaves at the crotch (~0.17 s into the motion);
  the follow-through carries the hands up behind him, then he comes up to
  block. Snap to holder ~0.7 s (7-8 yards), snap to punter ~0.75 s (15).
- Hold: on the right knee, the left knee up, the right hand a target at
  chest height, the left fingertip on the spot. Catch, spin the laces out
  as the ball comes down, place it on the spot with the left index finger
  on top, the right hand clear; the kick comes ~0.6 s after the catch
  (place-kick operation ~1.3 s snap to kick). Then he looks up at it.
- Place kick (right-footed, soccer style): set up back and to the left of
  the spot, facing it (~22 degrees off the target line); a short jab
  step with the left, a longer stride with the right, the left plants
  beside the ball (~0.2 m to the side, even with it, toes at the target),
  the right leg loads (heel to the seat) and whips through; contact on
  the instep ~0.67 s after the first move, ankle ~12 cm up; the hips
  rotate through, the leg follows through high and he lands forward.
- Punt: ~14 m deep, the right foot slightly ahead, the arms out as a
  target. Catch (frame 3), turn the laces up with the ball over the
  right thigh, a short jab with the right, a long step with the left,
  drop the ball from waist height (frame 34) and swing: contact with the
  top of the foot at ~0.4 m (frame 42), 1.3 s after the catch (NFL punters
  get it off in ~1.25-1.35 s; ~2.0-2.1 s snap to kick). The leg follows
  through above the head.
- Officials (NFL signal chart): touchdown: both arms straight up;
  first down: the arm extended at shoulder height pointing toward the
  defense's goal; incomplete pass: arms extended in the horizontal plane,
  swung across each other in front of the body, twice; dead ball: one arm
  straight up with the hand open, the whistle to the mouth.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import GRIP, RELAXED, SPREAD, STANCES, Clip, IDLE, keyed, mirrored, mix, shift, with_upper
from .actions_m6 import NO_BALANCE, bump, gait_clip, turn_about_hips, with_arms
from .actions_m6_back7 import foot_on_path
from .actions_m6_line import _spine, arm_track
from .gait import FPS, Gait, smoothstep
from .poses import Arm, Foot, Pose
from .transitions import Plant, Steps, _hermite

# --- Stances --------------------------------------------------------------------

# The long snapper: feet wide and even, knees deep, hips a touch above the
# knees, back flat, the ball out in front on the turf at arm's length,
# head down and back to see the target between the legs.
STANCES["ls"] = Pose(
    pelvis={"forward": -0.23, "up": -0.34, "flex": 70},
    joints={"spine_02": (6, 0, 0), "spine_03": (4, 0, 0), "neck_01": (30, 0, 0), "neck_02": (15, 0, 0), "head": (20, 0, 0), **GRIP},
    feet={"l": Foot(0.31, -0.06, heel=6, out=14), "r": Foot(-0.31, -0.06, heel=6, out=14)},
    hands={"r": (-0.05, -0.64, 0.16), "l": (0.07, -0.68, 0.20)},
    elbow={"l": (0.5, -0.3, 0.6), "r": (-0.5, -0.3, 0.6)},
)

# The holder, down on the right knee (the shin flat behind him, toes
# tucked), the left foot planted with the knee up, the right hand out as
# the target at chest height, the left fingertip resting on the spot.
SPOT = (0.34, -0.26)
_hold_feet = {"l": Foot(0.17, -0.34, heel=0, out=8), "r": Foot(-0.14, 0.44, heel=72, out=4)}
STANCES["holder"] = Pose(
    pelvis={"forward": -0.02, "up": -0.46, "flex": 16},
    joints={"spine_02": (4, 0, 0), "spine_03": (2, 0, 0), **SPREAD},
    feet=_hold_feet,
    hands={"r": (-0.06, -0.52, 1.02), "l": (SPOT[0], SPOT[1], 0.08)},
    elbow={"l": (0.6, 0.1, 0.5), "r": (-0.5, 0.1, 0.8)},
    gaze=(10.0, 0.0),
)
# After the kick: still down, the hands on the left thigh, eyes up on the ball.
STANCES["holder_watch"] = Pose(
    pelvis={"forward": -0.02, "up": -0.45, "flex": 8},
    joints={"spine_02": (2, 0, 0), **RELAXED},
    feet=_hold_feet,
    hands={"l": (0.20, -0.30, 0.66), "r": (0.06, -0.26, 0.64)},
    elbow={"l": (0.6, 0.2, 0.6), "r": (-0.3, 0.2, 0.6)},
    gaze=(-12.0, 0.0),
)
# The knee on the turf is part of the base the balance gate doesn't model.
NO_BALANCE.update({"holder", "holder_watch"})

# The kicker's set: back and left of the spot, turned toward it (22 deg
# right of the target line), the left foot a little ahead, arms loose.
KICK_HEADING = -22.0
_kick_base = Pose(
    pelvis={"up": -0.04, "flex": 8},
    joints={"spine_02": (3, 0, 0), **RELAXED},
    feet={"l": Foot(0.11, -0.16, heel=4, out=8), "r": Foot(-0.12, 0.06, heel=10, out=10)},
    arms={"l": Arm(flex=6, elbow=20, abd=14, inward=0.1), "r": Arm(flex=0, elbow=18, abd=14, inward=0.1)},
    gaze=(24.0, 0.0),  # eyes on the spot
)
STANCES["kicker"] = turn_about_hips(_kick_base, KICK_HEADING)

# The punter, ~14 m deep: the right foot a little ahead, knees soft, the
# arms out as the target, hands open at the waist, eyes on the snapper.
STANCES["punter"] = Pose(
    pelvis={"forward": -0.02, "up": -0.06, "flex": 12},
    joints={"spine_02": (3, 0, 0), **SPREAD, "hand_l": (-20, 0, 0), "hand_r": (-20, 0, 0)},
    feet={"l": Foot(0.15, -0.04, heel=6, out=8), "r": Foot(-0.15, -0.14, heel=6, out=8)},
    hands={"l": (0.15, -0.46, 0.98), "r": (-0.15, -0.46, 0.98)},
    elbow={"l": (0.5, 0.2, 0.9), "r": (-0.5, 0.2, 0.9)},
    gaze=(6.0, 0.0),
)

# The official at rest: square, feet a little wider than the hips, the
# weight even, the arms relaxed at the sides.
STANCES["ref"] = Pose(
    pelvis={"up": -0.015},
    joints={"spine_02": (1, 0, 0), "neck_01": (2, 0, 0), **RELAXED},
    feet={"l": Foot(0.15, -0.11, out=10), "r": Foot(-0.15, -0.11, out=10)},
    arms={"l": Arm(flex=3, elbow=14, abd=10, inward=0.1), "r": Arm(flex=3, elbow=14, abd=10, inward=0.1)},
)


# --- Long snapper ---------------------------------------------------------------------


def long_snap() -> Clip:
    """The snap: the arms whip back through the legs, the ball leaves at
    frame 5; the hands follow through up behind him, he rises and sets
    to block (the pass set)."""
    T = 1.0
    ls, ps = copy.deepcopy(STANCES["ls"]), copy.deepcopy(STANCES["ol_pass"])
    # Hands through the legs (world wrist targets): ball -> under the hips -> behind.
    path = [(0.0, (-0.05, -0.64, 0.16)), (0.1, (-0.03, -0.30, 0.24)), (0.167, (-0.02, 0.02, 0.36)), (0.24, (-0.02, 0.30, 0.56)), (0.3, (-0.02, 0.36, 0.66))]

    def hand_at(t):
        for (t0, a), (t1, b) in zip(path, path[1:]):
            if t <= t1:
                k = smoothstep(t0, t1, t) if t0 > 0 else ((t - t0) / (t1 - t0)) ** 1.6
                return tuple(a[i] + (b[i] - a[i]) * k for i in range(3))
        return path[-1][1]

    fin = copy.deepcopy(ls)
    fin.pelvis.update({"flex": 62, "up": -0.30})
    up = copy.deepcopy(ps)
    up.feet = {s: replace(ls.feet[s], heel=10) for s in "lr"}
    keys = [(0.0, ls), (0.3, fin), (0.62, up)]
    steps = Steps([
        Plant("l", -1, 0.55, ls.feet["l"], roll=6.0), Plant("l", 0.66, math.inf, ps.feet["l"]),
        Plant("r", -1, 0.7, ls.feet["r"], roll=6.0), Plant("r", 0.8, math.inf, ps.feet["r"]),
    ], height=0.03)

    def pose(t):
        p = keyed(keys, t) if t < 0.62 else mix(up, ps, smoothstep(0.62, T, t))
        if t < 0.3:
            h = hand_at(t)
            p.hands = {"r": h, "l": (h[0] + 0.1 - 0.06 * smoothstep(0.0, 0.2, t), h[1] - 0.04, h[2] + 0.04)}
            # The elbows stay straight: poles out to the sides.
            p.elbow = {"l": (0.6, h[1], 0.7), "r": (-0.6, h[1], 0.7)}
        elif t < 0.55:
            k = smoothstep(0.3, 0.55, t)
            h = path[-1][1]
            p.hands = {"r": (*h, 1 - k), "l": (h[0] + 0.04, h[1] - 0.04, h[2] + 0.04, 1 - k)}
            p.elbow = {"l": (0.6, 0.36, 0.7), "r": (-0.6, 0.36, 0.7)}
        p.joints.update(GRIP if t < 0.17 else SPREAD)
        if t > 0.3:
            # Head up: find the man to block.
            k = smoothstep(0.3, 0.6, t)
            for b in ("neck_01", "neck_02", "head"):
                f, a, tw = p.joints.get(b, (0, 0, 0))
                p.joints[b] = (f * (1 - k), a, tw)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("ks_long_snap", "transition", T, pose, None, "stance_ls", "stance_ol_pass", steps, events={"release": 5})


# --- Holder -----------------------------------------------------------------------------


def hold() -> Clip:
    """Catch the snap (frame 3), bring it down spinning the laces out and
    place it on the spot (frame 11), the left index finger on top, the
    right hand clear; the kick comes at frame 21 (0.6 s after the catch);
    the finger comes off and he looks up at the kick."""
    T = 1.2
    st, wt = copy.deepcopy(STANCES["holder"]), copy.deepcopy(STANCES["holder_watch"])
    catch = with_upper(st, {"r": (-0.02, -0.50, 1.00), "l": (0.10, -0.50, 1.02)}, {**GRIP}, {"l": (0.6, 0.1, 0.8), "r": (-0.5, 0.1, 0.8)})
    down = with_upper(st, {"r": (0.20, -0.34, 0.40), "l": (0.36, -0.36, 0.44)}, {**GRIP, "spine_02": (14, 0, 6)}, {"l": (0.7, 0.1, 0.6), "r": (-0.3, 0.1, 0.6)})
    down.pelvis.update({"flex": 26})
    place = with_upper(st, {"r": (SPOT[0] - 0.12, SPOT[1] - 0.02, 0.16), "l": (SPOT[0] + 0.02, SPOT[1] - 0.04, 0.30)}, {**GRIP, "spine_02": (18, 0, 8)}, {"l": (0.7, 0.1, 0.6), "r": (-0.2, 0.1, 0.5)})
    place.pelvis.update({"flex": 30})
    # Holding: only the left fingertip on the ball's top point, the right hand pulled clear.
    hold_ = with_upper(st, {"l": (SPOT[0] + 0.03, SPOT[1] - 0.03, 0.34), "r": (-0.10, -0.26, 0.62)}, {**hands_of_state(SPREAD, "l"), **hands_of_state(RELAXED, "r"), "index_01_l": (0, 0, 0), "spine_02": (16, 0, 8)}, {"l": (0.7, 0.2, 0.7), "r": (-0.4, 0.2, 0.6)})
    hold_.pelvis.update({"flex": 26})
    gone = copy.deepcopy(hold_)
    gone.hands = {"l": (SPOT[0] - 0.02, SPOT[1] + 0.02, 0.52), "r": hold_.hands["r"]}
    keys = [(0.0, st), (0.1, catch), (0.24, down), (0.37, place), (0.46, hold_), (0.7, hold_), (0.8, gone), (T, wt)]

    def pose(t):
        p = keyed(keys, t)
        p.feet = copy.deepcopy(st.feet)
        # Eyes: the ball in, the spot, then up after the kick.
        p.gaze = (10.0 if t < 0.12 else 38.0 if t < 0.72 else 38.0 - 50.0 * smoothstep(0.72, 1.0, t), 0.0, 0.7)
        return p

    return Clip("ks_hold", "transition", T, pose, None, "stance_holder", "stance_holder_watch", events={"catch": 3, "place": 11, "kick": 21})


def hands_of_state(state: dict, side: str) -> dict:
    return {k: v for k, v in state.items() if k.endswith(f"_{side}")}


# --- Place kick ---------------------------------------------------------------------------


def _fk_track(keys: list, t: float) -> tuple[float, float]:
    """(thigh flexion, knee flexion) from timed keys, smoothstep between."""
    if t <= keys[0][0]:
        return keys[0][1], keys[0][2]
    for (t0, a0, k0), (t1, a1, k1) in zip(keys, keys[1:]):
        if t <= t1:
            e = smoothstep(t0, t1, t)
            return a0 + (a1 - a0) * e, k0 + (k1 - k0) * e
    return keys[-1][1], keys[-1][2]


def _seg(t, keys):
    """Piecewise Hermite through (t, value, velocity) keys."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, p0, v0), (t1, p1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            return _hermite(p0, p1, v0, v1, t1 - t0, t - t0)
    return keys[-1][1]


def place_kick() -> Clip:
    """Jab (left), stride (right), plant (left) beside the ball, the right
    leg loads and whips through: contact at frame 20 (0.667 s), hips
    rotating through; follow-through high, land forward and stand."""
    T = 1.35
    TC = 20 / FPS
    B = (-0.72, -1.80)  # the ball on its spot, from where the kicker sets up
    C = (B[0] + 0.10, B[1] + 0.31)  # the hips at contact (right hip over the ball's line)
    E = (B[0] + 0.12, B[1] - 0.52)  # where he ends, standing

    def P(t):
        x = _seg(t, [(0.0, 0.0, 0.0), (TC, C[0], -0.15), (T, E[0], 0.0)])
        y = _seg(t, [(0.0, 0.0, 0.0), (TC, C[1], -2.5), (T, E[1], 0.0)])
        return x, y

    def travel(t):
        return P(t)

    def heading(t):
        if t < 0.45:
            return KICK_HEADING
        if t < TC:
            return KICK_HEADING * (1 - smoothstep(0.45, TC, t))
        if t < 0.86:
            return 14.0 * smoothstep(TC, 0.86, t)
        return 14.0 * (1 - smoothstep(0.86, T, t))

    st = STANCES["kicker"]
    base = _kick_base
    ux, uy = C[0] / math.hypot(*C), C[1] / math.hypot(*C)

    def along(d, lat, s):
        # A point d m along the approach line, lat m to the side (+ left).
        lx, ly = -uy, ux
        sg = 1.0 if s == "l" else -1.0
        return d * ux + lx * lat * sg * -1.0, d * uy + ly * lat * sg * -1.0

    jx, jy = along(0.30, 0.14, "l")
    rx, ry = along(0.98, 0.14, "r")
    plant = Foot(B[0] + 0.25, B[1] + 0.03, heel=0, out=6)
    r_land = Foot(E[0] - 0.12, E[1] - 0.02, heel=0, out=10)
    end = shift(IDLE, *E)
    steps = Steps([
        Plant("l", -1, 0.08, st.feet["l"], roll=8.0), Plant("l", 0.22, 0.3, Foot(jx, jy, heel=6, out=8 + KICK_HEADING), roll=20.0),
        # The plant, then the skip forward on it as the leg follows through.
        Plant("l", 0.58, 0.8, plant, roll=0.0), Plant("l", 0.96, 1.1, Foot(B[0] + 0.22, B[1] - 0.30, heel=6, out=8), roll=10.0),
        Plant("l", 1.22, math.inf, end.feet["l"]),
        Plant("r", -1, 0.2, st.feet["r"], roll=14.0), Plant("r", 0.42, 0.52, Foot(rx, ry, heel=8, out=10 - KICK_HEADING), roll=30.0),
        Plant("r", 1.0, math.inf, r_land),
    ], height=0.08)
    # The kicking leg (thigh from vertical, knee), keyed: toe-off, load
    # (heel to the seat as the plant lands), contact, follow-through high,
    # back down to land.
    swing = [(0.52, -18.0, 45.0), (0.6, -28.0, 108.0), (TC, 30.0, 25.0), (0.76, 80.0, 8.0), (0.85, 108.0, 12.0), (0.94, 60.0, 40.0), (1.0, 12.0, 14.0)]

    approach = copy.deepcopy(base)
    approach.pelvis.update({"up": -0.05, "flex": 12})
    approach.arms = {"l": Arm(flex=-20, elbow=40, abd=18), "r": Arm(flex=25, elbow=40, abd=14)}
    load = copy.deepcopy(base)
    load.pelvis.update({"up": -0.10, "flex": -4, "lateral": 6})
    load.arms = {"l": Arm(flex=40, elbow=20, abd=75, inward=0.0), "r": Arm(flex=-40, elbow=30, abd=24)}
    load.joints.update({"spine_02": (-4, 0, 0)})
    load.gaze = (40.0, 0.0)
    contact = copy.deepcopy(load)
    contact.pelvis.update({"up": -0.03, "flex": -6, "lateral": 4})
    contact.gaze = (42.0, 0.0)
    follow = copy.deepcopy(base)
    follow.pelvis.update({"up": 0.0, "flex": 6})
    land = copy.deepcopy(follow)
    land.pelvis.update({"up": -0.07, "flex": 12})
    follow.arms = {"l": Arm(flex=30, elbow=30, abd=50, inward=0.2), "r": Arm(flex=30, elbow=40, abd=30, inward=0.4)}
    follow.gaze = (5.0, 0.0)
    idle = copy.deepcopy(IDLE)
    keys = [(0.0, base), (0.25, approach), (0.58, load), (TC, contact), (0.86, follow), (1.02, land), (T, idle)]

    def pose(t):
        q = keyed(keys, t)
        p = turn_about_hips(q, heading(t))
        p = shift(p, *P(t))
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        # The plant foot rolls up onto the ball as the leg follows through.
        if 0.58 <= t < 0.8:
            p.feet["l"] = replace(p.feet["l"], heel=p.feet["l"].heel + 16.0 * smoothstep(TC - 0.06, 0.8, t))
        if 0.52 < t < 1.0:
            a, k = _fk_track(swing, t)
            w = smoothstep(0.52, 0.56, t) * (1 - smoothstep(0.95, 1.0, t))
            f = p.feet["r"]
            # Instep: toes pointed and turned out through contact.
            p.feet["r"] = replace(f, heel=f.heel + 45.0 * bump(t, 0.55, 0.9), out=f.out + 30.0 * bump(t, 0.55, 0.85), fk=(a, k, w))
        p.fk_dir = 0.0  # the leg swings through the ball at the target
        return p

    return Clip("ks_place_kick", "transition", T, pose, travel, "stance_kicker", "stance_idle", steps, events={"contact": 20})


# --- Punt ------------------------------------------------------------------------------------


def punt() -> Clip:
    """Catch (frame 3), laces up over the right thigh, jab with the right,
    long step with the left, drop (frame 34), contact (frame 42, 1.3 s
    after the catch), follow-through above the head, land and stand."""
    T = 2.1
    TD, TC = 34 / FPS, 42 / FPS

    def y(t):
        return _seg(t, [(0.0, 0.0, 0.0), (0.4, 0.0, 0.0), (TC, -1.35, -2.2), (2.05, -1.95, 0.0)])

    def travel(t):
        return (0.0, y(t))

    st = copy.deepcopy(STANCES["punter"])
    end = shift(IDLE, 0.0, y(T))
    plant = Foot(0.12, y(1.15) - 0.25, heel=0, out=6)
    steps = Steps([
        Plant("r", -1, 0.45, st.feet["r"], roll=10.0), Plant("r", 0.62, 0.8, Foot(-0.13, y(0.72) - 0.12, heel=4, out=8), roll=24.0),
        Plant("r", 1.85, math.inf, Foot(-0.14, y(1.9) - 0.10, heel=0, out=8)),
        Plant("l", -1, 0.72, st.feet["l"], roll=18.0), Plant("l", 1.15, 1.4, plant, roll=0.0),
        # The skip on the plant foot as the leg goes up.
        Plant("l", 1.62, 1.94, Foot(0.12, y(1.8) - 0.1, heel=6, out=6), roll=10.0),
        Plant("l", 2.04, math.inf, end.feet["l"]),
    ], height=0.08)
    swing = [(0.8, -12.0, 50.0), (1.12, -26.0, 96.0), (1.28, 8.0, 62.0), (TC, 55.0, 12.0), (1.55, 112.0, 4.0), (1.72, 70.0, 30.0), (1.85, 12.0, 16.0)]
    catch = with_upper(st, {"r": (-0.05, -0.44, 1.0), "l": (0.07, -0.46, 1.02)}, {**GRIP}, {"l": (0.5, 0.2, 0.9), "r": (-0.5, 0.2, 0.9)})
    # The ball out over the right thigh: the right hand under its back half, the left on the front.
    ready = with_upper(st, {"r": (-0.12, -0.46, 0.94), "l": (-0.02, -0.58, 0.98)}, {**GRIP, "hand_r": (-20, 0, 30)}, {"l": (0.5, 0.2, 0.9), "r": (-0.5, 0.2, 0.8)})
    drop = with_upper(st, {"r": (-0.14, -0.56, 0.86), "l": (0.02, -0.62, 0.94)}, {**SPREAD}, {"l": (0.5, 0.2, 0.9), "r": (-0.5, 0.2, 0.8)})
    drop.pelvis.update({"flex": 14, "up": -0.08})
    kick = Pose(pelvis={"up": -0.03, "flex": -6}, joints={"spine_02": (-2, 0, 0), **SPREAD}, feet=copy.deepcopy(st.feet), arms={"l": Arm(flex=60, elbow=15, abd=60, inward=0.0), "r": Arm(flex=-30, elbow=25, abd=30)}, gaze=(30.0, 0.0))
    follow = Pose(pelvis={"up": 0.0, "flex": 8}, joints={"spine_02": (6, 0, 0), **RELAXED}, feet=copy.deepcopy(st.feet), arms={"l": Arm(flex=50, elbow=20, abd=50, inward=0.2), "r": Arm(flex=20, elbow=30, abd=30, inward=0.3)}, gaze=(-10.0, 0.0))
    idle = copy.deepcopy(IDLE)
    keys = [(0.0, st), (0.1, catch), (0.45, ready), (TD - 0.02, ready), (TD + 0.04, drop), (TC, kick), (1.6, follow), (1.8, follow), (T, idle)]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, y(t))
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        if 1.15 <= t < 1.4:
            p.feet["l"] = replace(p.feet["l"], heel=p.feet["l"].heel + 16.0 * smoothstep(TC - 0.12, 1.4, t))
        if 0.8 < t < 1.85:
            a, k = _fk_track(swing, t)
            w = smoothstep(0.8, 0.86, t) * (1 - smoothstep(1.78, 1.85, t))
            f = p.feet["r"]
            # A locked ankle, toes pointed, through contact.
            p.feet["r"] = replace(f, heel=f.heel + 50.0 * bump(t, 1.0, 1.75), fk=(a, k, w))
        return p

    return Clip("ks_punt", "transition", T, pose, travel, "stance_punter", "stance_idle", steps, events={"catch": 3, "drop": 34, "contact": 42})


# --- Officials -------------------------------------------------------------------------------


def ref_idle() -> Clip:
    """The official between plays: a slow weight shift and a look along
    the line one way and the other. A 4 s loop."""
    T = 4.0
    st = STANCES["ref"]

    def pose(t):
        p = copy.deepcopy(st)
        w = math.sin(2 * math.pi * t / T)
        p.pelvis["side"] = 0.018 * w
        p.pelvis["lateral"] = -2.0 * w
        _spine(p, "spine_02", abd=1.2 * w)
        b = math.sin(2 * math.pi * (t / T + 0.1))
        _spine(p, "spine_03", flex=-0.8 * math.sin(4 * math.pi * t / T))
        p.gaze = (4.0, 32.0 * math.sin(2 * math.pi * t / T) ** 3, 0.55)
        _ = b
        return p

    return Clip("ref_idle", "stance", T, pose, loop=True)


# The official's run: upright (~7 degrees of lean), an easy cadence, the
# hands open and the arms relaxed; ~4.2 m/s keeps up with the play.
REF_RUN = Gait(
    "ref_run", frames=20, speed=4.2, duty=0.33, width=0.08, pelvis_up=-0.07, bob=0.03, sway=0.013, drop=6, turn=8, counter=9, lean=8,
    arm_c=-2, arm_a=24, elbow=84, elbow_d=8, arm_abd=12, inward=0.08, hand="relaxed",
    hip_max=50, hip_ext=-16, knee_max=100, retract=6, lift=0.22,
    strike=-4, flat_by=0.12, heel_mid=0, rise_at=0.5, toe_off=50, dorsi=10, gaze=4, ahead=0.36,
)


def ref_run() -> Clip:
    return gait_clip("ref_run", REF_RUN)


def _signal(name: str, T: float, keys: list, events: dict, gaze=None, mask_hands=None) -> Clip:
    st = STANCES["ref"]

    def pose(t):
        p = copy.deepcopy(st)
        p.arms = arm_track(keys, st.arms, t)
        if mask_hands:
            mask_hands(p, t)
        if gaze:
            p.gaze = gaze(t)
        return p

    return Clip(name, "transition", T, pose, None, "stance_ref", "stance_ref", events=events)


def touchdown() -> Clip:
    """Both arms straight up, crisp (up by frame 10), held, and down."""
    up = Arm(flex=178, elbow=3, abd=5, inward=0.0)
    keys = [(0.0, {}), (0.14, {"l": Arm(flex=100, elbow=40, abd=20), "r": Arm(flex=100, elbow=40, abd=20)}), (0.33, {"l": up, "r": up}), (1.5, {"l": up, "r": up}), (2.0, {})]

    def hands(p, t):
        p.joints.update(SPREAD if 0.2 < t < 1.6 else RELAXED)
        p.joints.update({"hand_l": (0, 0, 0), "hand_r": (0, 0, 0)})

    return _signal("ref_touchdown", 2.0, keys, {"signal": 10}, gaze=lambda t: (-8.0 * bump(t, 0.1, 1.8), 0.0, 0.5), mask_hands=hands)


def first_down_left() -> Clip:
    """The left arm points toward the defense's goal (the official's
    left) at shoulder height, fingers together; held, then down."""
    point = Arm(flex=4, elbow=2, abd=90, inward=0.0)
    keys = [(0.0, {}), (0.16, {"l": Arm(flex=70, elbow=60, abd=50, inward=0.1)}), (0.3, {"l": point}), (1.4, {"l": point}), (1.8, {})]

    def hands(p, t):
        p.joints.update({**hands_of_state(SPREAD, "l"), "fingers_01_l": (4, 0, 0), "index_01_l": (2, 0, 0)} if 0.2 < t < 1.5 else {})

    return _signal("ref_first_down_l", 1.8, keys, {"signal": 9}, gaze=lambda t: (2.0, 60.0 * bump(t, 0.1, 1.7) ** 0.5, 0.5), mask_hands=hands)


def incomplete() -> Clip:
    """Arms out to the sides, swung across each other in an X in front of
    the body (left over right, then right over left) and out,
    twice; down."""
    # Out a little below the shoulders; the X in front of the belt line.
    out = Arm(flex=10, elbow=4, abd=76, inward=0.0)
    cross_l_hi = {"l": Arm(flex=60, elbow=4, abd=-26, inward=0.0), "r": Arm(flex=52, elbow=4, abd=-26, inward=0.0)}
    cross_r_hi = {"l": Arm(flex=52, elbow=4, abd=-26, inward=0.0), "r": Arm(flex=60, elbow=4, abd=-26, inward=0.0)}
    keys = [(0.0, {}), (0.2, {"l": out, "r": out}), (0.42, cross_l_hi), (0.64, {"l": out, "r": out}), (0.86, cross_r_hi), (1.08, {"l": out, "r": out}), (1.5, {})]

    def hands(p, t):
        p.joints.update(SPREAD if 0.15 < t < 1.2 else RELAXED)

    return _signal("ref_incomplete", 1.5, keys, {"cross": 13, "cross2": 26}, mask_hands=hands)


def whistle() -> Clip:
    """Dead ball: the right arm straight up with the hand open, the left
    hand brings the whistle to the mouth and blows (frame 8); down."""
    T = 1.5
    up = Arm(flex=176, elbow=4, abd=8, inward=0.0)
    keys = [(0.0, {}), (0.12, {"r": Arm(flex=110, elbow=50, abd=24)}), (0.26, {"r": up}), (1.0, {"r": up}), (1.4, {})]

    def hands(p, t):
        # The left hand to the mouth (a hand whistle on its lanyard), by IK.
        k = smoothstep(0.02, 0.2, t) * (1 - smoothstep(0.95, 1.3, t))
        if k > 1e-3:
            p.hands = {"l": (0.03, -0.13, 1.62, k)}
            p.elbow = {"l": (0.45, -0.1, 1.2)}
            if "l" in p.arms:
                # The aimed (hanging) arm hands over to the IK reach and back.
                p.arms["l"] = replace(p.arms["l"], weight=p.arms["l"].weight * (1.0 - k))
        p.joints.update({**hands_of_state(SPREAD, "r"), **hands_of_state(GRIP, "l")} if 0.1 < t < 1.1 else {})

    return _signal("ref_whistle", T, keys, {"whistle": 8}, gaze=lambda t: (2.0, 0.0), mask_hands=hands)


def special_clips() -> list[Clip]:
    fd = first_down_left()
    return [
        long_snap(), hold(), place_kick(), punt(),
        ref_idle(), ref_run(), touchdown(), fd, mirrored(fd, "ref_first_down_r"), incomplete(), whistle(),
    ]


__all__ = ["special_clips", "SPOT", "KICK_HEADING", "keyed", "SPREAD"]

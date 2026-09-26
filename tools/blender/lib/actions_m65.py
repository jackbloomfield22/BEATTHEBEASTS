"""M6.5 catch clips (brief item 5): the catch call and the ball decide what
the catch looks like, so the call changes what you see, not only the odds.
Keyed here like every clip (CLAUDE.md rule 6): no downloaded, captured or
third-party motion.

Each clip carries a "secure" event (the frame the ball is in the hands:
the render starts the clip so that frame meets the ball's arrival) and a
"tuck" event (the frame the ball is put away high and tight; until then
the render holds the ball in the hands, after it along the forearm).

The run-speed catches are overlays (arms, and the upper spine where the
trunk has to lean or turn) over whatever the legs are doing, so the
stride never hitches; the catches that change what the legs do are
full-body clips out of the run.

Technique, from receiver coaching (the "diamond" and "pinkies" hand
rules, "look it in", "high and tight") and what a broadcast shows:
- catch_hands_run (RUN): hands late and out in front, away from the
  pads, thumbs together with the index fingers making the diamond (the
  ball above the waist); eyes on the nose of the ball into the hands (the
  runtime's look-at follows it); the hands give a few centimetres as it
  lands, then it goes high and tight into the outside arm, and the legs
  never break stride. catch_hands_run_low: below the waist the pinkies
  come together, palms up, and the ball is scooped up into the tuck.
- catch_high_point (GO UP): the penultimate step is long and low (the
  gather), a one-foot takeoff off the left with the right knee driven up
  like a layup, both arms swinging up and reaching full length so the
  hands meet the ball above the helmet at the top of the jump (~0.45 m of
  hip rise, ~0.3 s up and ~0.3 s down), the ball pulled down to the chest
  on the way down, a two-foot landing with the knees bending to absorb it,
  and two steps back into the run.
- catch_body (SECURE): elbows in, forearms together and turned up to make
  a cradle; the ball comes into the chest and the forearms and hands wrap
  it, the chest folds over it, then both hands cover it (the protect).
- catch_body_down (SECURE in traffic): the same cradle, then the near
  shoulder turns into the contact, the hips drop, the left knee goes to
  the turf and he folds forward over the ball onto the forearms and chest,
  the ball wrapped underneath (stance_down_prone_ball).
- catch_over_shoulder_l/_r (deep ball): at full stride running away from
  the quarterback; the head and the upper back turn to look back over the
  inside shoulder, the hands come up late in front of the face with the
  pinkies together and the palms to the sky (a basket), the ball drops in
  over the shoulder, the hands give and bring it into the tuck. The legs
  are the sprint's (an overlay).
- catch_dive_l/_r (low and away): the near foot plants and drives, the
  body turns toward the ball and lays out flat about 0.5 m off the turf,
  arms fully extended with the hands together low; the hands close on the
  ball at full extension, the arms pull it into the chest before the
  landing, and he lands on the forearms and chest with the ball protected,
  sliding to a stop (the landing heading is the clip's `turn`).
- catch_toe_tap_l/_r (sideline on his left/right): the upper body leans
  out over the white with the arms extended high and outside, the catch
  on the inside (in-bounds) foot, then the outside foot taps down on its
  toes and the inside foot drags its toe in bounds as the body falls out;
  he gathers himself out of bounds at a jog.
- catch_one_hand_l/_r (high and outside): the outside arm reaches to full
  length high and outside the frame, the trunk leaning with it, fingers
  spread; the ball is snatched in the one hand, pulled down to the body
  and covered, then tucked.
"""

from __future__ import annotations

# Lying stances this module adds (no balance gate). Set before the imports:
# actions.py reads it at the end of its own import, whichever module loads first.
NO_BALANCE = {"down_prone_ball"}

import copy  # noqa: E402
import math
from dataclasses import replace

from .actions import (
    GRIP,
    IDLE,
    RELAXED,
    SPINE_UP,
    SPREAD,
    STANCES,
    TUCK_ELBOW_R,
    TUCK_R,
    Clip,
    arm_mask,
    carry_pose,
    hands_of,
    keyed,
    mirror_pose,
    mirrored,
    mix,
    run_at,
    shift,
    with_upper,
)
from .actions_m6 import bump, hips_xy, turn_about_hips
from .gait import FPS, GAITS, gait_pose, smoothstep
from .poses import Arm, Foot, Pose
from .transitions import Plant, Steps, _blend_foot, _hermite

RUN = GAITS["run"]
JOG = GAITS["jog"]
ARMS = arm_mask("l") + arm_mask("r")

# --- Hands (idle body at the origin; x left, -y forward, z up; wrist targets) ---

# Wrists back, fingers up and spread, thumbs together: the diamond.
DIAMOND_WRIST = {"hand_l": (-40, 0, 0), "hand_r": (-40, 0, 0)}
# Palms to the sky, the little fingers together (below the waist, over the shoulder).
PINKIES_WRIST = {"hand_l": (-30, 0, 70), "hand_r": (-30, 0, -70)}


def upper(hands: dict, joints: dict, elbow: dict, base: Pose = IDLE) -> Pose:
    return with_upper(base, hands, joints, elbow)


def tuck_pose() -> Pose:
    """High and tight in the right arm, the left hand still over the nose (as the old catch)."""
    return upper(
        {"r": TUCK_R, "l": (0.02, -0.30, 1.30)},
        {**hands_of(GRIP, "r"), **hands_of(SPREAD, "l"), "hand_r": (-15, 0, 10), "hand_l": (20, 0, -10)},
        {"r": TUCK_ELBOW_R, "l": (0.45, 0.2, 0.9)},
        base=carry_pose(),
    )


# Both forearms over it at the chest (ovl_protect's shape, the trunk folded over the ball).
PROTECT_HANDS = {"r": (-0.05, -0.25, 1.17), "l": (0.02, -0.31, 1.21)}
PROTECT_ELBOW = {"r": TUCK_ELBOW_R, "l": (0.45, 0.2, 0.9)}


def protect_pose(fold: float = 1.0) -> Pose:
    return upper(PROTECT_HANDS, {**GRIP, "hand_l": (30, 0, -10), "spine_03": (8 * fold, 0, 0), "spine_04": (6 * fold, 0, 0)}, PROTECT_ELBOW)


def ready_pose() -> Pose:
    """Hands low and loose in front of the hips (where a runner's hands pass)."""
    return upper({"l": (0.20, -0.24, 1.02), "r": (-0.20, -0.24, 1.02)}, {**RELAXED}, {"l": (0.6, 0.4, 0.9), "r": (-0.6, 0.4, 0.9)})


def events(secure: float, tuck: float) -> dict:
    return {"secure": round(secure * FPS), "tuck": round(tuck * FPS)}


# --- RUN: the hands catch in stride ------------------------------------------------


def hands_run() -> Clip:
    """Diamond at the chest, late hands, give, high and tight (overlay: the legs keep running)."""
    T = 0.6
    ts, tt = 8 / FPS, 13 / FPS
    z = 1.30
    reach = upper({"l": (0.065, -0.50, z), "r": (-0.065, -0.50, z)}, {**SPREAD, **DIAMOND_WRIST}, {"l": (0.7, 0.0, z - 0.4), "r": (-0.7, 0.0, z - 0.4)})
    give = upper({"l": (0.05, -0.43, z - 0.02), "r": (-0.05, -0.43, z - 0.02)}, {**GRIP, **DIAMOND_WRIST}, {"l": (0.7, 0.1, z - 0.45), "r": (-0.7, 0.1, z - 0.45)})
    keys = [(0.0, ready_pose()), (ts - 0.09, reach), (ts, reach), (ts + 0.05, give), (tt, tuck_pose()), (T, tuck_pose())]
    return Clip("catch_hands_run", "overlay", T, lambda t: keyed(keys, t), mask=ARMS, events=events(ts, tt))


def hands_run_low() -> Clip:
    """Below the waist: pinkies together, palms up, scooped up into the tuck."""
    T = 0.6
    ts, tt = 8 / FPS, 14 / FPS
    z = 0.86
    reach = upper({"l": (0.07, -0.44, z), "r": (-0.07, -0.44, z)}, {**SPREAD, **PINKIES_WRIST}, {"l": (0.55, 0.1, z + 0.1), "r": (-0.55, 0.1, z + 0.1)})
    reach.joints.update({"spine_03": (8, 0, 0), "spine_04": (6, 0, 0)})
    give = upper({"l": (0.06, -0.40, z + 0.05), "r": (-0.06, -0.40, z + 0.05)}, {**GRIP, **PINKIES_WRIST}, {"l": (0.55, 0.1, z + 0.15), "r": (-0.55, 0.1, z + 0.15)})
    keys = [(0.0, ready_pose()), (ts - 0.09, reach), (ts, reach), (ts + 0.06, give), (tt, tuck_pose()), (T, tuck_pose())]
    return Clip("catch_hands_run_low", "overlay", T, lambda t: keyed(keys, t), mask=ARMS, events=events(ts, tt))


# --- SECURE: the body catch -------------------------------------------------------------


def cradle_poses() -> tuple[Pose, Pose]:
    """The basket (elbows in, forearms up and together) and the wrap (the ball in the chest)."""
    basket = upper({"l": (0.10, -0.44, 1.10), "r": (-0.10, -0.44, 1.10)}, {**SPREAD, "hand_l": (-20, 0, 60), "hand_r": (-20, 0, -60)}, {"l": (0.35, 0.25, 0.85), "r": (-0.35, 0.25, 0.85)})
    basket.joints.update({"spine_03": (4, 0, 0), "spine_04": (3, 0, 0)})
    wrap = upper({"l": (0.07, -0.27, 1.23), "r": (-0.09, -0.25, 1.17)}, {**GRIP, "hand_l": (10, 0, 30), "hand_r": (0, 0, -20)}, {"l": (0.40, 0.2, 0.85), "r": (-0.40, 0.2, 0.85)})
    wrap.joints.update({"spine_02": (4, 0, 0), "spine_03": (10, 0, 0), "spine_04": (8, 0, 0)})
    return basket, wrap


def body() -> Clip:
    """Cradle, wrap, cover (overlay: the arms and the upper spine fold over it)."""
    T = 0.75
    ts, tt = 8 / FPS, 16 / FPS
    basket, wrap = cradle_poses()
    keys = [(0.0, ready_pose()), (ts - 0.1, basket), (ts, basket), (ts + 0.08, wrap), (tt, protect_pose()), (T, protect_pose())]
    return Clip("catch_body", "overlay", T, lambda t: keyed(keys, t), mask=ARMS + SPINE_UP, events=events(ts, tt))


# Lying face down over the ball: the forearms under the chest wrapped round
# it, elbows out on the turf, the head turned to rest on the side.
STANCES["down_prone_ball"] = Pose(
    pelvis={"forward": 0.0, "up": -0.80, "flex": 90},
    joints={"spine_02": (-8, 0, 0), "spine_03": (-6, 0, 0), "neck_01": (-20, 0, 14), "head": (-10, 0, 12), **GRIP},
    feet={"l": Foot(0.15, 0.93, heel=88, out=10), "r": Foot(-0.12, 0.95, heel=88, out=4)},
    hands={"l": (0.07, -0.42, 0.14), "r": (-0.08, -0.40, 0.13)},
    elbow={"l": (0.55, -0.35, 0.0), "r": (-0.55, -0.35, 0.0)},
    knee=(0.0, 0.05, -0.9),
)


def foot_at(s: str, x: float, y: float, lateral: float = 0.09, ahead: float = 0.08, heel: float = 8.0, out: float = 4.0) -> Foot:
    """A foot planted beside a body standing at (x, y) facing -Y."""
    return Foot(x + lateral * (1 if s == "l" else -1), y - ahead, heel=heel, out=out)


def body_down() -> Clip:
    """Out of the run (left touch-down): the cradle and the catch (frame 8),
    the right shoulder turns into the contact over a braking step, the left
    knee goes down, and he folds forward over the ball onto the forearms and
    chest. Ends lying on it (stance_down_prone_ball)."""
    T = 1.3
    v = RUN.speed
    D = 1.55
    t_stop = 0.62

    def fwd(t):
        return _hermite(0.0, D, v, 0.0, t_stop, min(t, t_stop)) + 0.35 * smoothstep(0.62, 1.0, t)

    def travel(t):
        return (0.0, -fwd(t))

    ts, tt = 8 / FPS, 16 / FPS
    basket, wrap = cradle_poses()
    run0 = run_at(0)
    prone = copy.deepcopy(STANCES["down_prone_ball"])
    # The brace: the right shoulder turned in and dipped, the hips low over a wide base.
    # (Hand targets placed at the folded chest: the hips are low and the trunk well forward.)
    brace = with_upper(run_at(0), {"r": (-0.05, -0.50, 1.02), "l": (0.02, -0.55, 1.06)}, {**protect_pose().joints, "spine_02": (10, 0, -12), "spine_03": (12, 0, -10), "spine_04": (8, 0, -6)}, {"r": (-0.30, 0.1, 0.75), "l": (0.45, -0.1, 0.72)})
    brace.arms = {}
    brace.pelvis.update({"up": -0.20, "flex": 26, "twist": -14, "side": 0.0, "lateral": 0.0})
    # Down on the left knee, the trunk folded over the ball.
    kneel = with_upper(IDLE, {"r": (-0.05, -0.55, 0.68), "l": (0.02, -0.60, 0.71)}, {**protect_pose().joints, "spine_02": (18, 0, -6), "spine_03": (16, 0, -4), "spine_04": (10, 0, 0), "neck_01": (-10, 0, 0)}, {"r": (-0.30, -0.1, 0.45), "l": (0.45, -0.2, 0.45)})
    kneel.arms = {}
    kneel.pelvis.update({"up": -0.47, "flex": 40, "twist": -6, "side": 0.0, "lateral": 0.0})
    # Falling forward onto the forearms.
    fold = copy.deepcopy(prone)
    fold.pelvis.update({"up": -0.62, "flex": 70})
    fold.hands = {s: (h[0], h[1], h[2] + 0.12) for s, h in prone.hands.items()}
    runner_up = {k: run0.joints[k] for k in run0.joints if k.startswith(("spine", "neck", "head"))}

    def with_legs_of_run(p: Pose) -> Pose:
        q = copy.deepcopy(run0)
        q.joints.update({k: v for k, v in p.joints.items() if not k.startswith(("spine", "neck", "head"))})
        q.joints.update(runner_up)
        q.hands, q.elbow, q.arms = dict(p.hands), dict(p.elbow), {}
        q.joints.update({k: v for k, v in p.joints.items() if k.startswith(("spine_03", "spine_04"))})
        return q

    keys = [(0.0, with_legs_of_run(ready_pose())), (ts - 0.1, with_legs_of_run(basket)), (ts, with_legs_of_run(basket)), (ts + 0.08, with_legs_of_run(wrap)),
            (0.46, brace), (0.72, kneel), (0.92, fold), (1.08, prone), (T, prone)]
    # Footwork: the run's left touch-down, a braking right step (wide), the
    # left foot back as the knee goes down (toes dug in), the right knee
    # follows as he folds forward, both legs lying back.
    y = lambda t: -fwd(t)  # noqa: E731
    r1 = foot_at("r", 0.0, y(0.40), lateral=0.16, ahead=0.12, heel=14, out=10)
    l_kneel = Foot(0.12, y(0.72) + 0.46, heel=84, out=6)
    r_kneel = Foot(-0.14, y(0.86) + 0.30, heel=60, out=8)
    end = shift(prone, 0.0, y(T))
    steps = Steps([
        Plant("l", -1, 0.16, run0.feet["l"], roll=18.0),
        Plant("l", 0.58, 1.0, l_kneel),
        Plant("l", 1.06, math.inf, end.feet["l"]),
        Plant("r", 0.30, 0.74, r1, roll=20.0),
        Plant("r", 0.86, 1.0, r_kneel),
        Plant("r", 1.08, math.inf, end.feet["r"]),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}, height=0.09)

    def pose(t):
        p = shift(keyed(keys, t), 0.0, y(t))
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        # Knees forward while he's up, down to the turf as he goes over.
        k = smoothstep(0.6, 1.0, t)
        p.knee = (0.0, -0.9 * (1 - k), -0.9 * k)
        return p

    contacts = steps.contacts(round(T * FPS))
    return Clip("catch_body_down", "transition", T, pose, travel, "loco_run", "stance_down_prone_ball", contacts=contacts, events=events(ts, tt), from_phase=0.0)


# --- GO UP: the high point ------------------------------------------------------------------


def high_point() -> Clip:
    """Out of the run at the right foot's touch-down (the penultimate step,
    long and low), the left plants and drives him up with the right knee
    high; the hands meet the ball above the helmet at the top (frame 22),
    pull it down on the way down, a two-foot landing, and two steps back
    into the run (the left touch-down, phase 0)."""
    v0 = RUN.speed
    t_plant, t_off, t_land = 0.27, 0.42, 1.02
    t_apex = (t_off + t_land) / 2
    rise = 0.44  # hip rise from takeoff to the top (m)
    g = 8.0 * rise / (t_land - t_off) ** 2  # the parabola through takeoff and landing heights
    T = 49 / FPS  # a whole number of frames, so the travel reaches run speed on the last one

    # Forward speed (m/s) at the keys: off the run into a slower gather and
    # flight, a landing that gives up most of the rest (the knees absorb),
    # then two steps back up to run speed.
    pts = [(0.0, v0), (t_off, 4.0), (t_land, 3.3), (1.22, 2.9), (T, v0)]
    xs = [0.0]
    for (ta, va), (tb, vb) in zip(pts, pts[1:]):
        xs.append(xs[-1] + (va + vb) / 2 * (tb - ta))

    def fwd(t):
        for i, ((ta, va), (tb, vb)) in enumerate(zip(pts, pts[1:])):
            if t <= tb or i == len(pts) - 2:
                return _hermite(xs[i], xs[i + 1], va, vb, tb - ta, min(max(t - ta, 0.0), tb - ta))
        return xs[-1]

    def travel(t):
        return (0.0, -fwd(t))

    # Hip height (pelvis "up", m): the run's, the gather sinks, the takeoff
    # extends onto the toes, the flight's parabola, the landing absorbs.
    up_off = 0.02

    def hip(t):
        if t < t_plant:
            return -0.08 - 0.08 * smoothstep(0.0, t_plant, t)
        if t < t_off:
            return -0.16 + (up_off + 0.16) * smoothstep(t_plant + 0.04, t_off, t)
        if t < t_land:
            u = t - t_off
            vz = g * (t_land - t_off) / 2
            return up_off + vz * u - g * u * u / 2
        if t < 1.20:
            return up_off - 0.22 * math.sin(math.pi / 2 * smoothstep(t_land, 1.20, t))
        return up_off - 0.22 + (0.22 + up_off - 0.10) * smoothstep(1.20, T, t)

    run_half = run_at(RUN.frames / 2)
    y = lambda t: -fwd(t)  # noqa: E731
    # Arms: the run's carriage, swinging up through the takeoff to full
    # reach, the ball at the top, pulled down to the chest, then the tuck.
    ts = round(t_apex * FPS) / FPS
    tt = 0.98
    # Hand targets are keyed around a body standing at the origin and ride
    # up and down with the hips. At the top the wrists are ~0.25 m over the
    # helmet (arms at full length above the shoulders).
    top = 2.08
    reach = upper({"l": (0.07, -0.20, top), "r": (-0.07, -0.20, top)}, {**SPREAD, "hand_l": (-15, 0, 0), "hand_r": (-15, 0, 0)}, {"l": (0.6, 0.1, top - 0.35), "r": (-0.6, 0.1, top - 0.35)})
    swing = upper({"l": (0.20, -0.42, 1.62), "r": (-0.20, -0.42, 1.62)}, {**SPREAD}, {"l": (0.6, 0.0, 1.2), "r": (-0.6, 0.0, 1.2)})
    secure = upper({"l": (0.05, -0.18, top - 0.04), "r": (-0.05, -0.18, top - 0.04)}, {**GRIP, "hand_l": (-15, 0, 0), "hand_r": (-15, 0, 0)}, {"l": (0.6, 0.1, top - 0.4), "r": (-0.6, 0.1, top - 0.4)})
    down = upper({"l": (0.06, -0.30, 1.45), "r": (-0.07, -0.28, 1.40)}, {**GRIP}, {"l": (0.5, 0.2, 1.0), "r": (-0.5, 0.2, 1.0)})

    def arms(t):
        """Upper-body key at t, authored around a body standing at the origin with its hips at `hip(t)`."""
        if t < 0.2:
            return None
        if t < t_off:
            return mix(ready_pose(), swing, smoothstep(0.2, t_off, t))
        if t < ts - 0.08:
            return mix(swing, reach, smoothstep(t_off, ts - 0.08, t))
        if t < ts:
            return reach
        if t < ts + 0.06:
            return mix(reach, secure, smoothstep(ts, ts + 0.06, t))
        if t < tt:
            return mix(secure, down, smoothstep(ts + 0.06, tt - 0.04, t))
        return mix(down, tuck_pose(), smoothstep(tt - 0.04, 1.18, t))

    # Footfalls (world): the gather's right plant is the run's right
    # touch-down; the left plants long and a little across under the body to
    # take off; both land together, the left a half foot ahead; then the right
    # and the left step back into the run.
    f_end = shift(run_at(0), 0.0, y(T))
    lp = Foot(0.05, y((t_plant + t_off) / 2) - 0.10, heel=-6, out=4)
    l_land = Foot(0.13, y(t_land) - 0.24, heel=14, out=8)
    r_land = Foot(-0.13, y(t_land) - 0.04, heel=14, out=10)
    r_step = Foot(-0.08, y(1.37) - 0.10, heel=8, out=4)
    steps = Steps([
        Plant("r", -1, 0.17, run_half.feet["r"], roll=16.0),
        Plant("r", t_land, 1.14, r_land, roll=30.0),
        Plant("r", 1.30, 1.44, r_step, roll=30.0),
        Plant("r", T, math.inf, f_end.feet["r"], contact=False),
        Plant("l", t_plant, t_off, lp, roll=40.0),
        Plant("l", t_land, 1.22, l_land, roll=30.0),
        Plant("l", T, math.inf, f_end.feet["l"]),
    ], before={"l": lambda t: shift(run_at(RUN.frames / 2 + t * FPS), 0.0, -v0 * t).feet["l"]}, height=0.12)

    def flight_feet(t, p):
        """In the air the legs are shaped from the hips: the takeoff leg
        trails long, the right knee drives up, then both reach for the turf."""
        u = smoothstep(t_off, t_apex, t)
        w = smoothstep(t_off, t_off + 0.08, t) * (1 - smoothstep(t_land - 0.1, t_land, t))
        # (thigh flexion from vertical, knee flexion), deg.
        left = (-18 + 40 * smoothstep(t_apex - 0.1, t_land - 0.06, t), 35 + 20 * u - 35 * smoothstep(t_apex, t_land, t))
        right = (78 - 55 * smoothstep(t_apex - 0.05, t_land - 0.06, t), 105 - 70 * smoothstep(t_apex - 0.05, t_land - 0.06, t))
        out = {}
        for s, (a, k) in (("l", left), ("r", right)):
            base = steps.foot(s, t)
            base = replace(base, lift=base.lift + max(0.0, hip(t) - up_off) * 0.9, heel=base.heel + 40 * w)
            out[s] = replace(base, fk=(a, k, w)) if w > 1e-3 else base
        return out

    def pose(t):
        # The run (from its right touch-down) into the gather, and the run
        # that leads into its left touch-down at T out of the landing; in the
        # air the trunk's counter-rotation settles out.
        a = run_at(RUN.frames / 2 + t * FPS)
        b = run_at((t - T) * FPS)
        base = mix(a, b, smoothstep(t_off, t_land + 0.1, t))
        r = 1 - smoothstep(0.1, t_off, t) + smoothstep(t_land + 0.1, T, t)
        for k in ("spine_01", "spine_02", "spine_03", "spine_04"):
            f, ab, tw = base.joints.get(k, (0, 0, 0))
            base.joints[k] = (f, ab * r, tw * r)
        e0, e1 = smoothstep(0.0, 0.12, t), smoothstep(1.3, T, t)
        up = a.pelvis["up"] * (1 - e0) + hip(t) * e0
        up = up * (1 - e1) + b.pelvis["up"] * e1
        base.pelvis.update({"up": up, "side": base.pelvis.get("side", 0.0) * r, "lateral": base.pelvis.get("lateral", 0.0) * r, "twist": base.pelvis.get("twist", 0.0) * r})
        # Trunk: over the knee at the gather, tall and a touch arched at the
        # top, folded over the knees as the landing absorbs, back to the run.
        base.pelvis["flex"] = base.pelvis.get("flex", 0.0) + 6 * bump(t, 0.0, t_off) - 16 * bump(t, t_off - 0.1, t_land) + 22 * bump(t, t_land - 0.06, 1.42)
        up_arms = arms(t)
        if up_arms is not None:
            fingers = ("fingers", "index", "thumb", "hand_")
            base = with_upper(base, up_arms.hands, {**{k: v for k, v in base.joints.items() if not k.startswith(fingers)}, **{k: v for k, v in up_arms.joints.items() if k.startswith(fingers)}}, up_arms.elbow)
            # The hands were keyed around standing hips: carry them with the hips.
            dz = up - IDLE.pelvis.get("up", 0.0)
            base.hands = {s: (h[0], h[1], h[2] + dz) for s, h in base.hands.items()}
            base.elbow = {s: (e[0], e[1], e[2] + dz) for s, e in base.elbow.items()}
            k_in = smoothstep(0.2, 0.34, t)
            k_l = k_in * (1 - smoothstep(1.2, T, t))  # the left hand lets go of the ball, back into the swing
            base.hands = {s: (*h[:3], k_l if s == "l" else k_in) for s, h in base.hands.items()}
            src = a if t < t_off else b
            arms_ = {s: replace(am, weight=am.weight * (1 - (k_l if s == "l" else k_in))) for s, am in src.arms.items()}
            base.arms = {s: am for s, am in arms_.items() if am.weight > 1e-3}
        # Eyes: up to the ball, then back down the field on the way down.
        look = bump(t, 0.05, ts + 0.25)
        base.gaze = (6.0 - 44.0 * look, 0.0, 0.8)
        p = shift(base, 0.0, y(t))
        if t_off < t < t_land:
            p.feet = flight_feet(t, p)
        else:
            p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("catch_high_point", "transition", T, pose, travel, "loco_run", "loco_run", steps, to_phase=0.0, events=events(ts, tt), from_phase=0.5)


# --- Deep ball: over the shoulder ----------------------------------------------------------------


def mirror_upper(p: Pose) -> Pose:
    """The upper body mirrored left for right, over the same legs."""
    q = mirror_pose(p)
    r = copy.deepcopy(p)
    r.hands, r.elbow, r.arms = q.hands, q.elbow, q.arms
    upper_bones = ("clavicle", "upperarm", "forearm", "hand", "fingers", "index", "thumb", "spine_02", "spine_03", "spine_04", "neck", "head")
    r.joints = {k: v for k, v in p.joints.items() if not k.startswith(upper_bones)}
    r.joints.update({k: v for k, v in q.joints.items() if k.startswith(upper_bones)})
    r.gaze = q.gaze
    return r


def sided(side: str):
    """Author on the left; the right-hand version mirrors the catch but not
    the tuck (the game carries the ball in the right arm)."""
    return (lambda p: p) if side == "l" else mirror_upper


def over_shoulder(side: str) -> Clip:
    """Looking back over the inside shoulder at full stride; the basket in
    front of the face, pinkies together (overlay: the legs are the sprint's)."""
    T = 0.7
    ts, tt = 10 / FPS, 17 / FPS
    m = sided(side)
    turn = {"spine_02": (0, 0, 6), "spine_03": (0, 0, 12), "spine_04": (0, 0, 12)}
    reach = upper({"l": (0.16, -0.30, 1.66), "r": (0.02, -0.34, 1.64)}, {**SPREAD, **PINKIES_WRIST}, {"l": (0.6, 0.0, 1.25), "r": (-0.4, -0.1, 1.2)})
    reach.joints.update(turn)
    secure = upper({"l": (0.12, -0.30, 1.56), "r": (-0.01, -0.32, 1.54)}, {**GRIP, **PINKIES_WRIST}, {"l": (0.6, 0.0, 1.15), "r": (-0.4, -0.1, 1.1)})
    secure.joints.update(turn)
    tk = tuck_pose()
    keys = [(0.0, ready_pose()), (ts - 0.16, m(reach)), (ts, m(reach)), (ts + 0.06, m(secure)), (tt, tk), (T, tk)]
    return Clip(f"catch_over_shoulder_{side}", "overlay", T, lambda t: keyed(keys, t), mask=ARMS + SPINE_UP, events=events(ts, tt))


# --- High and outside: one hand ----------------------------------------------------------------


def one_hand(side: str) -> Clip:
    """The outside arm long, high and outside; snatched in the one hand,
    pulled down to the body and covered by the other, then tucked (overlay)."""
    T = 0.8
    ts, tt = 8 / FPS, 19 / FPS
    m = sided(side)
    lean = {"spine_02": (0, 6, 4), "spine_03": (0, 8, 6), "spine_04": (0, 6, 4)}
    reach = upper({"l": (0.58, -0.22, 1.96), "r": (-0.24, -0.20, 1.10)}, {**SPREAD, "hand_l": (-25, 0, 40), **hands_of(RELAXED, "r")}, {"l": (0.9, 0.2, 1.6), "r": (-0.6, 0.3, 0.95)})
    reach.joints.update(lean)
    snatch = upper({"l": (0.54, -0.20, 1.90), "r": (-0.24, -0.20, 1.10)}, {**hands_of(GRIP, "l"), **hands_of(RELAXED, "r"), "hand_l": (-5, 0, 40)}, {"l": (0.9, 0.2, 1.55), "r": (-0.6, 0.3, 0.95)})
    snatch.joints.update(lean)
    pull = upper({"l": (0.10, -0.30, 1.30), "r": (-0.03, -0.30, 1.22)}, {**hands_of(GRIP, "l"), **hands_of(SPREAD, "r"), "hand_l": (10, 0, 20), "hand_r": (20, 0, 10)}, {"l": (0.6, 0.2, 1.0), "r": (-0.5, 0.2, 0.95)})
    keys = [(0.0, ready_pose()), (ts - 0.12, m(reach)), (ts, m(reach)), (ts + 0.05, m(snatch)), (0.46, m(pull)), (tt, tuck_pose()), (T, tuck_pose())]
    return Clip(f"catch_one_hand_{side}", "overlay", T, lambda t: keyed(keys, t), mask=ARMS + SPINE_UP, events=events(ts, tt))


# --- Low and away: the dive ----------------------------------------------------------------------

DIVE_TURN = 35.0  # the layout heads this far off the run (deg, + left)


def dive_left() -> Clip:
    """Out of the run (left touch-down): the left foot drives, the body
    turns 35 degrees toward the ball and lays out low and flat, the hands
    close on the ball at full extension (frame 10), the arms pull it into
    the chest, and he lands on the forearms and chest and slides to a stop,
    lying on it (stance_down_prone_ball, turned)."""
    T = 1.0
    v = RUN.speed
    D = 2.7
    A = DIVE_TURN

    def dist(t):
        return _hermite(0.0, D, v, 0.0, 0.78, min(t, 0.78))

    def heading(t):
        return A * smoothstep(0.0, 0.26, t)

    # The path bends toward the ball: integrate the heading along the distance.
    N = 60
    path = [(0.0, 0.0)]
    for i in range(1, N + 1):
        t0, t1 = T * (i - 1) / N, T * i / N
        d = dist(t1) - dist(t0)
        h = math.radians(heading((t0 + t1) / 2))
        x, y0 = path[-1]
        path.append((x + math.sin(h) * d, y0 - math.cos(h) * d))

    def at(t):
        u = min(max(t / T, 0.0), 1.0) * N
        i = min(int(u), N - 1)
        f = u - i
        (xa, ya), (xb, yb) = path[i], path[i + 1]
        return xa + (xb - xa) * f, ya + (yb - ya) * f

    def travel(t):
        return at(t)

    ts, tt = 10 / FPS, 16 / FPS
    run0 = run_at(0)
    lying = copy.deepcopy(STANCES["down_prone_ball"])
    # Push: the pads drop toward the ball, the arms start forward.
    push = copy.deepcopy(run0)
    push.pelvis.update({"up": -0.06, "flex": 40})
    push.joints.update({"neck_01": (-24, 0, 0), "head": (-14, 0, 0), **SPREAD})
    push.arms = {"l": Arm(flex=110, elbow=30, abd=16, inward=0.3), "r": Arm(flex=105, elbow=34, abd=16, inward=0.3)}
    # Laid out: flat and low, the arms long and together, hands at the ball.
    fly = copy.deepcopy(lying)
    fly.pelvis.update({"up": -0.44, "flex": 84, "lateral": -10})
    fly.joints.update({"spine_02": (-6, 0, 0), "spine_03": (-4, 0, 0), "neck_01": (-34, 0, 0), "head": (-16, 0, 0), **SPREAD, **DIAMOND_WRIST})
    fly.hands = {}
    fly.elbow = {}
    fly.arms = {"l": Arm(flex=168, elbow=8, abd=6, inward=0.5), "r": Arm(flex=168, elbow=8, abd=6, inward=0.5)}
    secure = copy.deepcopy(fly)
    secure.joints.update({**GRIP})
    secure.arms = {"l": Arm(flex=162, elbow=16, abd=4, inward=0.6), "r": Arm(flex=162, elbow=16, abd=4, inward=0.6)}
    # Pulled in before the landing: the forearms under the chest.
    land = copy.deepcopy(lying)
    land.pelvis.update({"up": -0.72, "flex": 86})
    land.hands = {s: (h[0], h[1], h[2] + 0.06) for s, h in lying.hands.items()}
    keys = [(0.0, run0), (0.13, push), (0.27, fly), (ts, secure), (ts + 0.04, secure), (tt, land), (0.62, lying), (T, lying)]
    push_end = 0.14

    def trailing(p: Pose) -> dict:
        """Legs behind a body going flat (local frame, before the turn)."""
        flex = p.pelvis.get("flex", 0.0)
        k = min(1.0, max(0.0, (flex - 20) / 70))
        z_hip = 0.975 + p.pelvis.get("up", 0.0)
        back = 0.20 + 0.72 * k
        drop = max(0.0, z_hip - 0.10 - 0.72 * (1 - k))
        return {
            "l": Foot(0.13, 0.01 + back, heel=30 + 58 * k, out=8, lift=max(0.0, drop - 0.02)),
            "r": Foot(-0.12, 0.01 + back + 0.05, heel=30 + 58 * k, out=4, lift=max(0.0, drop + 0.02)),
        }

    def pose(t):
        local = keyed(keys, t)
        local.pelvis.update({"side": 0.0, "forward": 0.0})
        local.feet = trailing(local)
        k = smoothstep(0.1, 0.45, t)
        local.knee = (0.0, -0.9 * (1 - k), -0.9 * k)
        x, y = at(t)
        p = shift(turn_about_hips(local, heading(t)), x, y)
        # Push-off: the left foot stays where the run put it down; the right
        # swings through from the run.
        if t < push_end + 0.08:
            planted = replace(run0.feet["l"], heel=run0.feet["l"].heel + 34 * smoothstep(0.0, push_end, t))
            swing = shift(run_at(t * FPS), 0.0, -v * t).feet["r"]
            a = smoothstep(push_end, push_end + 0.08, t)
            p.feet = {"l": _blend_foot(planted, p.feet["l"], a), "r": _blend_foot(swing, p.feet["r"], a)}
        return p

    contacts = {"l": [[0, round(push_end * FPS)], [round(0.8 * FPS), round(T * FPS)]], "r": [[round(0.8 * FPS), round(T * FPS)]]}
    return Clip("catch_dive_l", "transition", T, pose, travel, "loco_run", "stance_down_prone_ball", contacts=contacts, events=events(ts, tt), turn=A, from_phase=0.0)


# --- The sideline: the toe-tap -----------------------------------------------------------------


def toe_tap_left() -> Clip:
    """Running up the sideline (the white on his left): the upper body leans
    out over it with the arms high and outside, the catch on the right
    (inside) foot (frame 12), then the left taps down on its toes and the
    right drags its toe in bounds as he falls out; he gathers himself at a
    jog out of bounds (the jog's right touch-down, phase 0.5)."""
    T = 1.0
    v0, v1 = RUN.speed, JOG.speed
    D = (v0 + v1) / 2 * T * 0.94

    def fwd(t):
        return _hermite(0.0, D, v0, v1, T, min(t, T))

    def side(t):
        return 0.18 * smoothstep(0.18, 0.5, t) + 0.42 * smoothstep(0.52, T, t)

    def travel(t):
        return (side(t), -fwd(t))

    ts, tt = 12 / FPS, 20 / FPS
    run0 = run_at(0)
    end = shift(gait_pose(JOG, JOG.frames / 2), side(T), -fwd(T))
    lean = {"spine_02": (-2, 13, 6), "spine_03": (-4, 16, 8), "spine_04": (-2, 12, 6)}
    reach = upper({"l": (0.74, -0.26, 1.60), "r": (0.52, -0.34, 1.70)}, {**SPREAD, "hand_l": (-30, 0, 10), "hand_r": (-30, 0, -10)}, {"l": (0.9, 0.2, 1.3), "r": (0.0, -0.1, 1.2)})
    reach.joints.update(lean)
    secure = upper({"l": (0.68, -0.24, 1.55), "r": (0.49, -0.31, 1.62)}, {**GRIP, "hand_l": (-20, 0, 10), "hand_r": (-20, 0, -10)}, {"l": (0.9, 0.2, 1.25), "r": (0.0, -0.1, 1.15)})
    secure.joints.update(lean)
    tk = tuck_pose()

    def upper_at(t):
        if t < 0.08:
            return None, 0.0
        if t < ts - 0.1:
            return reach, smoothstep(0.08, ts - 0.1, t)
        if t < ts:
            return reach, 1.0
        if t < ts + 0.06:
            return mix(reach, secure, smoothstep(ts, ts + 0.06, t)), 1.0
        return mix(secure, tk, smoothstep(ts + 0.06, tt, t)), 1.0

    # Feet: the run's left touch-down; the right (inside) plants for the
    # catch; the left taps down on its toes; the right's toe drags forward
    # along the turf (not planted: it slides) as he falls out; the left
    # lands out of bounds, and the right comes through to the jog.
    r_plant = Foot(side(0.36) - 0.15, -fwd(0.36) - 0.10, heel=10, out=0)
    l_tap = Foot(side(0.54) + 0.0, -fwd(0.54) - 0.14, heel=42, out=6)
    l_out = Foot(side(0.80) + 0.16, -fwd(0.80) - 0.10, heel=14, out=10)
    steps = Steps([
        Plant("l", -1, 0.16, run0.feet["l"], roll=20.0),
        Plant("l", 0.50, 0.58, l_tap, roll=10.0),
        Plant("l", 0.78, 0.90, l_out, roll=26.0),
        Plant("l", T, math.inf, end.feet["l"], contact=False),
        Plant("r", 0.27, 0.46, r_plant, roll=6.0),
        Plant("r", T, math.inf, end.feet["r"]),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v0 * t).feet["r"]}, height=0.10)
    drag0, drag1 = 0.46, 0.72

    def pose(t):
        # Legs and trunk from the run, easing to the jog; the lean out over the line.
        base = mix(run_at(t * FPS * 0.8), gait_pose(JOG, JOG.frames / 2), smoothstep(0.55, T, t))
        b = bump(t, 0.12, 0.85)
        base.pelvis.update({"side": 0.0, "lateral": base.pelvis.get("lateral", 0.0) - 15.0 * b, "up": base.pelvis.get("up", 0.0) - 0.05 * b})
        up, w = upper_at(t)
        if up is not None:
            base = with_upper(base, up.hands, {**{k: v for k, v in base.joints.items() if not k.startswith(("fingers", "index", "thumb", "hand_"))}, **{k: v for k, v in up.joints.items() if k.startswith(("fingers", "index", "thumb", "hand_"))}}, up.elbow)
            for k in ("spine_02", "spine_03", "spine_04"):
                a0 = base.joints.get(k, (0, 0, 0))
                a1 = up.joints.get(k, (0, 0, 0))
                base.joints[k] = tuple(x0 + (x1 - x0) * w * min(1.0, b * 1.4) for x0, x1 in zip(a0, a1))
            base.hands = {s: (*h[:3], w) for s, h in base.hands.items()}
            if w < 0.999:
                base.arms = {s: replace(a, weight=a.weight * (1 - w)) for s, a in run_at(t * FPS).arms.items()}
            else:
                base.arms = {}
            if t > 0.8:
                # Into the jog: the arms go back to swinging.
                k = smoothstep(0.8, T, t)
                base.hands = {s: (*h[:3], 1 - k) for s, h in base.hands.items() if s == "l"} | {"r": base.hands["r"]}
                base.arms = {"l": replace(gait_pose(JOG, JOG.frames / 2).arms["l"], weight=k)}
        base.gaze = (-18.0 * bump(t, 0.05, 0.6), 38.0 * bump(t, 0.0, 0.7), 0.8)
        p = shift(base, side(t), -fwd(t))
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        if drag0 <= t < drag1 + 0.1:
            # The drag: toes pointed, the ball of the foot scraping forward a
            # little slower than the body, then lifting away into the swing.
            u = smoothstep(drag0, drag1, t)
            dragged = replace(r_plant, y=r_plant.y - 0.45 * u, x=r_plant.x + 0.08 * u, heel=10 + 58 * smoothstep(drag0, drag0 + 0.08, t), lift=0.0)
            if t < drag1:
                p.feet["r"] = dragged
            else:
                p.feet["r"] = _blend_foot(dragged, p.feet["r"], smoothstep(drag1, drag1 + 0.1, t))
        return p

    contacts = steps.contacts(round(T * FPS))
    return Clip("catch_toe_tap_l", "transition", T, pose, travel, "loco_run", "loco_jog", contacts=contacts, events={**events(ts, tt), "tap": round(0.52 * FPS)}, to_phase=0.5, from_phase=0.0)


# --- Registry ---------------------------------------------------------------------------------------


def mirrored_right_tuck(c: Clip, name: str, t0: float, t1: float, to_phase: float) -> Clip:
    """The mirror image of a full-body catch, except that from t0 to t1 the
    arms go into the original's right-arm tuck (carried with the mirrored
    body): the game carries the ball in the right arm."""
    m = mirrored(c, name, to_phase=to_phase)
    fingers = ("fingers", "index", "thumb", "hand_")

    def pose(t):
        p = mirror_pose(c._pose(t))
        if t <= t0:
            return p
        src = c._pose(t)
        (ox, oy), (mx, my) = hips_xy(src), hips_xy(p)
        dx, dy = mx - ox, my - oy
        k = smoothstep(t0, t1, t)
        moved = {s: (h[0] + dx, h[1] + dy, *h[2:]) for s, h in src.hands.items()}
        hands = {}
        for s in set(p.hands) | set(moved):
            a, b = p.hands.get(s), moved.get(s)
            if a and b:
                wa, wb = (a[3] if len(a) > 3 else 1.0), (b[3] if len(b) > 3 else 1.0)
                hands[s] = (*(x + (y - x) * k for x, y in zip(a[:3], b[:3])), wa + (wb - wa) * k)
            elif b:
                hands[s] = (*b[:3], (b[3] if len(b) > 3 else 1.0) * k)
            elif a:
                hands[s] = (*a[:3], (a[3] if len(a) > 3 else 1.0) * (1 - k))
        p.hands = hands
        p.elbow = {s: (e[0] + dx, e[1] + dy, e[2]) for s, e in src.elbow.items()} if k > 0.5 else p.elbow
        if k > 0.5:
            p.joints.update({j: v for j, v in src.joints.items() if j.startswith(fingers)})
        p.arms = {s: replace(am, weight=am.weight * k) for s, am in src.arms.items()}
        return p

    m._pose = pose
    return m


def m65_clips() -> list[Clip]:
    dv, tp = dive_left(), toe_tap_left()
    return [
        hands_run(), hands_run_low(), high_point(), body(), body_down(),
        over_shoulder("l"), over_shoulder("r"),
        dv, mirrored(dv, "catch_dive_r"),
        tp, mirrored_right_tuck(tp, "catch_toe_tap_r", 12 / FPS, 20 / FPS, to_phase=0.0),
        one_hand("l"), one_hand("r"),
    ]

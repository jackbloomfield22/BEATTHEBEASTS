"""M6 linebackers and defensive backs. Keyed here (CLAUDE.md rule 6).
The hip flip and the break are technique clips (never cut).

Timings and shapes, from coaching descriptions:
- Read step: on the snap, a short (~15 cm) step with both feet, pads
  down, shoulders square, hands up, eyes through the guard to the backs.
- Shuffle: shoulders square to the line, the lead foot steps and the
  trail foot closes without crossing or clicking, hips low, ~2 m/s.
- Fill: downhill through the gap, three quick steps (~2 m in ~0.6 s),
  pads dropping, and a breakdown in the hole (chopped feet, a wide base).
- Scrape: flow over the top of the blocks with the shoulders square, a
  shuffle into a crossover run, then press downhill into the alley.
- Hook drop: open the hips at ~100 degrees to the drop side and run to the
  landmark (~4-5 m deep, ~1 m outside) with the eyes on the quarterback
  over the inside shoulder; plant, square up and settle, ~1.5 s.
- Take-on of a lead blocker: attack him, strike with both hands inside
  (heels of the hands, thumbs up) with the hips rolling under, lock out,
  keep the outside arm free.
- Press: square, feet even and shoulder width, on the balls, hands up,
  eyes on the receiver's belt. The jam: a patient kick-step with the foot
  on his release side, the opposite hand punches his near breastplate
  (~0.3 s), then re-mirror.
- Hip flip (turn and run): from the backpedal, open the hip on the break
  side (the foot steps back and out, the toes turned downfield), whip the
  shoulders round, crossover, and run: ~0.65 s to run speed facing
  downfield (a 180 degree turn).
- Break (plant and drive): the backpedal stops on one plant (the foot
  under the hips, the shin angled forward, pads over the knee, ~0.25 s),
  then drive steps downhill toward the ball.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import FIST, RELAXED, SPREAD, STANCES, Clip, keyed, mirrored, mix, run_at, shift
from .actions_m6 import LOCK, PUNCH, READY, STRIKE_WRISTS, bump, gait_clip, turn_about_hips, with_arms
from .actions_m6_line import _spine
from .gait import FPS, GAITS, Gait, gait_pose, smoothstep
from .poses import Arm, Foot, Pose
from .transitions import Plant, Steps, _hermite

RUN = GAITS["run"]
JOG = GAITS["jog"]
BP = GAITS["backpedal"]

# --- Helpers ------------------------------------------------------------------


def foot_on_path(s: str, x: float, y: float, heading: float, lateral: float = 0.09, ahead: float = 0.06, heel: float = 8.0, out: float = 4.0) -> Foot:
    """A foot planted beside a body standing at (x, y) and facing
    `heading` (deg, + left of -Y): out to its side by `lateral`, `ahead`
    along the facing, the toes turned with the body."""
    a = math.radians(heading)
    lx, ly = math.cos(a), math.sin(a)
    fx, fy = math.sin(a), -math.cos(a)
    sg = 1.0 if s == "l" else -1.0
    return Foot(x + lx * lateral * sg + fx * ahead, y + ly * lateral * sg + fy * ahead, heel=heel, out=out + (heading if s == "l" else -heading))


# --- Stances --------------------------------------------------------------------

# Press-man: square to the receiver at the line, feet even and a little
# narrower than the shoulders, on the balls of the feet, knees bent and
# the chest over them, hands up at the chest, eyes on his belt.
STANCES["db_press"] = Pose(
    pelvis={"forward": -0.06, "up": -0.19, "flex": 30},
    joints={"spine_02": (8, 0, 0), "spine_03": (4, 0, 0), **SPREAD, **STRIKE_WRISTS},
    feet={"l": Foot(0.21, -0.07, heel=20, out=6), "r": Foot(-0.21, -0.07, heel=20, out=6)},
    arms={"l": Arm(flex=50, elbow=95, abd=14, inward=0.4, clavicle=4), "r": Arm(flex=50, elbow=95, abd=14, inward=0.4, clavicle=4)},
    gaze=(14.0, 0.0),
)

# The linebacker's hands, up and ready to take on a block (thumbs up).
LB_HANDS = Arm(flex=46, elbow=92, abd=16, inward=0.4, clavicle=2)


# --- Linebackers ------------------------------------------------------------------


def read_step() -> Clip:
    """On the snap: a short read step with both feet (left, then right),
    the pads settle, the hands come up, the eyes read. ~0.5 s."""
    T = 0.5
    st = copy.deepcopy(STANCES["lb_ready"])
    D = 0.15

    def fwd(t):
        return D * smoothstep(0.03, 0.4, t)

    def travel(t):
        return (0.0, -fwd(t))

    end = shift(st, 0.0, -D)
    steps = Steps([
        Plant("l", -1, 0.04, st.feet["l"], roll=6.0), Plant("l", 0.16, math.inf, end.feet["l"]),
        Plant("r", -1, 0.16, st.feet["r"], roll=6.0), Plant("r", 0.3, math.inf, end.feet["r"]),
    ], height=0.04)
    ready = with_arms(st, Pose(arms={"l": LB_HANDS, "r": LB_HANDS}, joints={**SPREAD}))
    keys = [(0.0, st), (0.2, ready), (T, st)]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, -fwd(t))
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.035 * bump(t, 0.05, T)
        p.pelvis["flex"] = p.pelvis.get("flex", 0.0) + 5.0 * bump(t, 0.05, T)
        p.gaze = (4.0 + 3.0 * bump(t, 0.1, T), 0.0)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("lb_read_step", "transition", T, pose, travel, "stance_lb_ready", "stance_lb_ready", steps)


# Shuffle (to the left): the gait keyer run sideways, feet never crossing.
SHUFFLE = Gait(
    "shuffle", frames=12, speed=2.0, duty=0.56, width=0.27, pelvis_up=-0.21, bob=0.012, sway=0.0, drop=2, turn=0, counter=0, lean=26,
    arm_c=44, arm_a=4, elbow=92, elbow_d=4, arm_abd=16, inward=0.4, hand="spread",
    hip_max=30, hip_ext=-10, knee_max=60, retract=0, fk=0.0, lift=0.06,
    strike=16, flat_by=0.1, heel_mid=16, rise_at=0.5, toe_off=24, dorsi=0, gaze=4, dir=(1.0, 0.0), ahead=0.5,
)


def shuffle() -> Clip:
    return gait_clip("lb_shuffle_l", SHUFFLE)


def fill() -> Clip:
    """Downhill into the gap: three quick steps with the pads dropping
    (left, right, left), then the breakdown in the hole: the right foot
    lands wide, the feet chop, hands up to take on the ball carrier."""
    T = 0.95
    st = copy.deepcopy(STANCES["lb_ready"])
    D = 2.1

    def fwd(t):
        return _hermite(0.0, D, 0.0, 0.0, 0.8, min(t, 0.8))

    def travel(t):
        return (0.0, -fwd(t))

    end = shift(st, 0.0, -D)

    def at(s, t, dx=0.0):
        return foot_on_path(s, 0.0, -fwd(t), 0.0, lateral=0.12 + dx, ahead=0.08, heel=12.0)

    steps = Steps([
        Plant("l", -1, 0.05, st.feet["l"], roll=10.0), Plant("l", 0.18, 0.34, at("l", 0.28), roll=24.0), Plant("l", 0.52, 0.66, at("l", 0.62, 0.06), roll=10.0), Plant("l", 0.8, math.inf, end.feet["l"]),
        Plant("r", -1, 0.16, st.feet["r"], roll=14.0), Plant("r", 0.35, 0.5, at("r", 0.44), roll=24.0), Plant("r", 0.66, math.inf, end.feet["r"]),
    ], height=0.09)
    attack = copy.deepcopy(st)
    attack.pelvis.update({"up": -0.22, "flex": 36, "forward": 0.0})
    attack.arms = {"l": Arm(flex=-30, elbow=85, abd=12, inward=0.05), "r": Arm(flex=45, elbow=85, abd=12, inward=0.2)}
    attack.joints.update(FIST)
    attack2 = copy.deepcopy(attack)
    attack2.arms = {"r": Arm(flex=-30, elbow=85, abd=12, inward=0.05), "l": Arm(flex=45, elbow=85, abd=12, inward=0.2)}
    brk = with_arms(st, Pose(arms={"l": LB_HANDS, "r": LB_HANDS}, joints={**SPREAD}))
    brk.pelvis.update({"up": -0.25, "flex": 34})
    keys = [(0.0, st), (0.22, attack), (0.42, attack2), (0.66, brk), (T, st)]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, -fwd(t))
        p.gaze = (8.0, 0.0)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("lb_fill", "transition", T, pose, travel, "stance_lb_ready", "stance_lb_ready", steps)


def scrape(side: str) -> Clip:
    """Over the top toward `side`: shoulders square to the line, two
    shuffles into a crossover, then press downhill into the alley and
    break down."""
    T = 1.2
    d = 1.0 if side == "l" else -1.0
    lead, trail = ("l", "r") if side == "l" else ("r", "l")
    st = copy.deepcopy(STANCES["lb_ready"])
    X, Y = 1.75, 0.7

    def lat(t):
        return d * X * smoothstep(0.02, 0.95, t)

    def fwd(t):
        return Y * smoothstep(0.55, 1.05, t)

    def travel(t):
        return (lat(t), -fwd(t))

    def body(t):
        return lat(t), -fwd(t)

    def at(s, t, lateral=0.24, ahead=0.07):
        x, y = body(t)
        return foot_on_path(s, x, y, 0.0, lateral=lateral, ahead=ahead, heel=14.0)

    end = shift(st, d * X, -Y)

    def sta(s, x, t, ahead=0.07):
        # A foot at lateral station x (toward `side`), level with the body at t.
        return Foot(d * x, -fwd(t) - ahead, heel=14.0, out=6.0)

    steps = Steps([
        # Shuffle: the lead steps out ~0.55 m, the trail closes to ~0.3 m
        # behind it (never crossing: "don't cross over until you have to"),
        # three times, the last one pressing downhill.
        Plant(lead, -1, 0.04, st.feet[lead], roll=8.0), Plant(lead, 0.12, 0.28, sta(lead, 0.81, 0.2), roll=10.0),
        Plant(trail, -1, 0.2, st.feet[trail], roll=10.0), Plant(trail, 0.3, 0.46, sta(trail, 0.51, 0.38), roll=10.0),
        Plant(lead, 0.4, 0.54, sta(lead, 1.36, 0.47), roll=12.0),
        Plant(trail, 0.56, 0.72, sta(trail, 1.06, 0.64), roll=14.0),
        Plant(lead, 0.66, 0.82, sta(lead, 1.91, 0.74, ahead=0.12), roll=14.0),
        Plant(trail, 0.86, math.inf, end.feet[trail]),
        Plant(lead, 0.98, math.inf, end.feet[lead]),
    ], height=0.07)
    flow = with_arms(st, Pose(arms={"l": LB_HANDS, "r": LB_HANDS}, joints={**SPREAD}))
    flow.pelvis.update({"up": -0.23, "flex": 30})
    brk = copy.deepcopy(flow)
    brk.pelvis.update({"up": -0.25, "flex": 34})
    keys = [(0.0, st), (0.18, flow), (0.9, flow), (1.05, brk), (T, st)]

    def pose(t):
        x, y = body(t)
        p = shift(keyed(keys, t), x, y)
        # Square to the line; the hips open a little into the crossover.
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + 22.0 * d * bump(t, 0.45, 0.95)
        _spine(p, "spine_03", twist=-12.0 * d * bump(t, 0.45, 0.95))
        p.gaze = (6.0, 0.0)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip(f"lb_scrape_{side}", "transition", T, pose, travel, "stance_lb_ready", "stance_lb_ready", steps, main_dir=[d, 0.0])


def drop_hook_left() -> Clip:
    """Open the hips to the left (~100 degrees), run to the hook landmark
    (4.4 m deep, 1.2 m outside) with the eyes back on the quarterback,
    plant, square up and settle in the zone. Ends facing the line."""
    T = 1.55
    st = copy.deepcopy(STANCES["lb_ready"])
    X, Y = 1.2, 4.4

    def s_(t):
        return smoothstep(0.04, 1.2, t)

    def P(t):
        return X * s_(t), Y * s_(t)

    def travel(t):
        return P(t)

    def yaw(t):
        return 100.0 * smoothstep(0.02, 0.26, t) * (1.0 - smoothstep(0.98, 1.3, t))

    def at(s, t, lateral=0.09, ahead=0.05, heel=10.0):
        x, y = P(t)
        return foot_on_path(s, x, y, yaw(t), lateral=lateral, ahead=ahead, heel=heel)

    end = shift(st, X, Y)
    run_arms = {s: a for s, a in run_at(0).arms.items()}
    steps = Steps([
        Plant("l", -1, 0.05, st.feet["l"], roll=8.0),
        Plant("l", 0.18, 0.32, at("l", 0.24, lateral=0.14), roll=20.0),
        Plant("r", -1, 0.2, st.feet["r"], roll=16.0),
        Plant("r", 0.38, 0.5, at("r", 0.44), roll=24.0),
        Plant("l", 0.58, 0.7, at("l", 0.64), roll=24.0),
        Plant("r", 0.78, 0.9, at("r", 0.84), roll=24.0),
        # The plant: the left foot lands wide and the body gathers over it, then squares.
        Plant("l", 1.0, 1.16, at("l", 1.1, lateral=0.2, ahead=-0.02, heel=12.0), roll=10.0),
        Plant("r", 1.12, math.inf, end.feet["r"]),
        Plant("l", 1.3, math.inf, end.feet["l"]),
    ], height=0.1)
    ready = with_arms(st, Pose(arms={"l": LB_HANDS, "r": LB_HANDS}, joints={**SPREAD}))

    def pose(t):
        # Body frame: stance, into a run (its cycle keyed to the steps), back to the stance.
        ph = ((t - 0.18) / 0.4) % 1.0 if t > 0.18 else 0.0
        runp = run_at(ph * RUN.frames)
        runp.pelvis.update({"up": -0.1, "flex": runp.pelvis["flex"] - 2})
        w = smoothstep(0.02, 0.3, t) * (1 - smoothstep(0.95, 1.3, t))
        q = mix(st if t < 0.6 else ready, runp, w)
        if t > 1.2:
            q = mix(q, st, smoothstep(1.2, T, t))
        q.arms = {s: a for s, a in q.arms.items()} if w > 0.05 else q.arms
        p = turn_about_hips(q, yaw(t))
        x, y = P(t)
        p = shift(p, x, y)
        # Eyes back on the quarterback (world -Y), as far as the neck turns.
        p.gaze = (6.0, yaw(t) - min(yaw(t), 68.0), 0.8)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    _ = run_arms
    return Clip("lb_drop_hook_l", "transition", T, pose, travel, "stance_lb_ready", "stance_lb_ready", steps)


def take_on() -> Clip:
    """Attack the lead blocker: two steps downhill, strike both hands into
    his chest with the hips rolling under (frame 11), lock out and hold
    the point, feet chopping; settle back into the ready stance."""
    T = 1.0
    st = copy.deepcopy(STANCES["lb_ready"])
    D = 0.9

    def fwd(t):
        # In at ~1.2 m/s at contact; he holds the point (stops) within ~0.35 s.
        if t < 0.36:
            return _hermite(0.0, 0.7, 0.0, 1.2, 0.36, t)
        return _hermite(0.7, D, 1.2, 0.0, 0.36, min(t - 0.36, 0.36))

    def travel(t):
        return (0.0, -fwd(t))

    end = shift(st, 0.0, -D)

    def at(s, t, lat=0.13, ahead=0.08, heel=14.0):
        return foot_on_path(s, 0.0, -fwd(t), 0.0, lateral=lat, ahead=ahead, heel=heel)

    steps = Steps([
        Plant("l", -1, 0.05, st.feet["l"], roll=10.0), Plant("l", 0.18, 0.4, at("l", 0.3, ahead=0.14), roll=14.0), Plant("l", 0.56, math.inf, end.feet["l"]),
        Plant("r", -1, 0.2, st.feet["r"], roll=12.0), Plant("r", 0.34, 0.62, at("r", 0.5, lat=0.2, ahead=-0.02), roll=10.0), Plant("r", 0.74, math.inf, end.feet["r"]),
    ], height=0.07)
    load = with_arms(st, Pose(arms={"l": Arm(flex=-10, elbow=100, abd=14, inward=0.15), "r": Arm(flex=-10, elbow=100, abd=14, inward=0.15)}, joints={**SPREAD, **STRIKE_WRISTS}))
    load.pelvis.update({"up": -0.24, "flex": 36})
    strike = with_arms(st, Pose(arms={"l": replace(PUNCH, flex=104), "r": replace(PUNCH, flex=104)}, joints={**SPREAD, **STRIKE_WRISTS}))
    strike.pelvis.update({"up": -0.26, "flex": 22})
    lock = with_arms(st, Pose(arms={"l": replace(LOCK, flex=100), "r": replace(LOCK, flex=96)}, joints={**SPREAD, **STRIKE_WRISTS}))
    lock.pelvis.update({"up": -0.24, "flex": 26})
    keys = [(0.0, st), (0.26, load), (0.37, strike), (0.5, lock), (0.8, lock), (T, st)]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, -fwd(t))
        p.gaze = (4.0 - 5.0 * bump(t, 0.3, 0.55), 0.0, 0.5)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("lb_take_on", "transition", T, pose, travel, "stance_lb_ready", "stance_lb_ready", steps, events={"contact": 11})


# --- Defensive backs ---------------------------------------------------------------


def press_jam_left() -> Clip:
    """The receiver releases to the corner's left: a patient kick-step
    back and out with the left foot, the right hand punches his near
    breastplate (frame 9), then re-mirror square in front of him."""
    T = 0.8
    st = copy.deepcopy(STANCES["db_press"])
    X, Y = 0.34, 0.3

    def P(t):
        e = smoothstep(0.08, 0.6, t)
        return X * e, Y * e

    def travel(t):
        return P(t)

    end = shift(st, X, Y)
    steps = Steps([
        Plant("l", -1, 0.1, st.feet["l"], roll=6.0), Plant("l", 0.22, math.inf, replace(end.feet["l"], x=end.feet["l"].x + 0.04, y=end.feet["l"].y + 0.03, out=14)),
        Plant("r", -1, 0.3, st.feet["r"], roll=8.0), Plant("r", 0.44, math.inf, end.feet["r"]),
    ], height=0.04)
    punch = with_arms(st, Pose(arms={"r": replace(PUNCH, flex=92, abd=-2, inward=0.55), "l": Arm(flex=60, elbow=85, abd=18, inward=0.3)}, joints={**SPREAD, **STRIKE_WRISTS}))
    keys = [(0.0, st), (0.18, st), (0.3, punch), (0.42, punch), (T, st)]

    def pose(t):
        x, y = P(t)
        p = shift(keyed(keys, t), x, y)
        b = bump(t, 0.15, 0.6)
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + 14.0 * b
        _spine(p, "spine_03", twist=-8.0 * b)
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.02 * b
        p.gaze = (14.0, 8.0 * b)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("db_press_jam_l", "transition", T, pose, travel, "stance_db_press", "stance_db_press", steps, events={"contact": 9}, main_dir=[1.0, 0.0])


def hip_flip_left() -> Clip:
    """From the backpedal at the right foot's touch-down (the left in the
    air), open the left hip: the left foot lands back and out with the toes
    turned downfield, the shoulders whip round to the left, the right foot
    crosses over, and he runs downfield at run speed on the next left
    touch-down, turned 180 degrees."""
    T = 18 / FPS
    v0, v1 = BP.speed, RUN.speed
    D = (v0 + v1) / 2 * T
    f0 = BP.frames / 2  # the backpedal's right touch-down

    def back(t):
        return _hermite(0.0, D, v0, v1, T, min(t, T))

    def travel(t):
        return (0.0, back(t))

    def yaw(t):
        return 180.0 * smoothstep(0.02, 0.36, t)

    bp0 = gait_pose(BP, f0)
    end = shift(turn_about_hips(run_at(0), 180.0), 0.0, back(T))
    steps = Steps([
        Plant("r", -1, 0.1, bp0.feet["r"], roll=10.0),
        Plant("l", 0.12, 0.25, foot_on_path("l", 0.0, back(0.19), yaw(0.19), lateral=0.13, ahead=0.02, heel=10), roll=22.0),
        Plant("l", T, math.inf, end.feet["l"]),
        Plant("r", 0.29, 0.42, foot_on_path("r", 0.0, back(0.36), yaw(0.36), lateral=0.09, ahead=0.05, heel=10), roll=26.0),
        Plant("r", T, math.inf, end.feet["r"], contact=False),
    ], before={"l": lambda t: shift(gait_pose(BP, f0 + t * FPS), 0.0, v0 * t).feet["l"]}, height=0.12)

    def pose(t):
        bp = gait_pose(BP, f0 + t * FPS)
        q = mix(bp, run_at(0), smoothstep(0.0, 0.45, t) ** 0.8)
        p = shift(turn_about_hips(q, yaw(t)), 0.0, back(t))
        # The head leads the turn (eyes find the receiver, then downfield).
        p.gaze = (4.0, min(180.0, yaw(t) * 1.25), 0.7)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("db_hip_flip_l", "transition", T, pose, travel, "loco_backpedal", "loco_run", steps, turn=180.0, from_phase=0.5)


def db_break() -> Clip:
    """Plant and drive: the backpedal's left foot (touch-down) becomes the
    plant, the body sinks and stops over it (~0.25 s), then three drive
    steps downhill (right, left, right) into the jog at its left touch-down."""
    T = 0.9
    v0 = BP.speed
    stop_t, back_d = 0.2, 0.3
    D2 = 1.2

    def y(t):
        # + back (the backpedal's direction), then forward.
        if t < stop_t:
            return _hermite(0.0, back_d, v0, 0.0, stop_t, t)
        return _hermite(back_d, back_d - D2, 0.0, -JOG.speed, T - stop_t, min(t - stop_t, T - stop_t))

    def travel(t):
        return (0.0, y(t))

    bp0 = gait_pose(BP, 0)
    j0 = gait_pose(JOG, 0)
    end = shift(j0, 0.0, y(T))

    def at(s, t, lat=0.12, ahead=0.08, heel=18.0):
        return foot_on_path(s, 0.0, y(t), 0.0, lateral=lat, ahead=ahead, heel=heel)

    pl = bp0.feet["l"]
    steps = Steps([
        Plant("l", -1, 0.3, replace(pl, heel=pl.heel), roll=16.0),
        Plant("l", 0.52, 0.66, at("l", 0.6), roll=26.0),
        Plant("l", T, math.inf, end.feet["l"]),
        Plant("r", 0.32, 0.46, at("r", 0.4, lat=0.16, ahead=0.02), roll=26.0),
        Plant("r", 0.74, T - 0.1, at("r", 0.8, lat=0.09), roll=26.0),
        Plant("r", T, math.inf, end.feet["r"], contact=False),
    ], before={"r": lambda t: shift(gait_pose(BP, t * FPS), 0.0, v0 * t).feet["r"]}, height=0.08)
    plant = copy.deepcopy(bp0)
    plant.pelvis.update({"up": -0.25, "flex": 34, "twist": 0.0, "side": 0.0})
    plant.arms = {"l": Arm(flex=-35, elbow=90, abd=14, inward=0.05), "r": Arm(flex=40, elbow=85, abd=12, inward=0.15)}
    plant.joints.update({"spine_02": (8, 0, 0), **FIST})
    drive = copy.deepcopy(j0)
    drive.pelvis.update({"up": -0.14, "flex": 22})
    drive.arms = {"r": Arm(flex=-35, elbow=90, abd=14, inward=0.05), "l": Arm(flex=45, elbow=85, abd=12, inward=0.15)}
    keys = [(0.0, bp0), (0.2, plant), (0.4, drive), (T, j0)]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, y(t))
        p.gaze = (4.0, 0.0)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("db_break", "transition", T, pose, travel, "loco_backpedal", "loco_jog", steps, events={"plant": 5, "drive": 10}, from_phase=0.0)


def back7_clips() -> list[Clip]:
    sh, pj, hf = shuffle(), press_jam_left(), hip_flip_left()
    return [
        read_step(), sh, mirrored(sh, "lb_shuffle_r"), fill(), scrape("l"), scrape("r"),
        (dh := drop_hook_left()), mirrored(dh, "lb_drop_hook_r"), take_on(),
        pj, mirrored(pj, "db_press_jam_r"), hf, mirrored(hf, "db_hip_flip_r", to_phase=0.5), db_break(),
    ]

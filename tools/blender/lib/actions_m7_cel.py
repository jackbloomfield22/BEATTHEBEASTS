"""M7 touchdown celebrations (Playtest 1 #7): the scorer's pool of twelve,
and the team-mates' reactions. Keyed here like every clip (CLAUDE.md rule
6): no downloaded, captured or third-party motion, and none of them copies
a named real-world dance. They are the things football players do in an
end zone: spike it, flip it to the official, point at the stands, take a
knee, leap at the wall, flex, salute, bump chests, jump and pump a fist,
or drop it and shrug.

Every clip is a full-body transition from the standing idle back to it
(the runtime hands over to `stance_idle` when it ends), authored in world
space with planted feet that stay put (transitions.Steps) and the body's
travel taken back out (the leap, the walk and the chest bump move him; the
runtime moves the root by the `travel` curve). Clip events (anims.json)
time what the runtime does with the ball and the partner:
  release   the ball leaves the hand (spike, flip, drop);
  left      the ball changes to the left hand (the salute);
  contact   chest meets chest (the bump), hand meets hand (the five).

Timings and shapes come from watching how the body does each thing, not
from any recording: a spike is a throw downward (load overhead with the
back arched, the trunk and arm whip down together over ~0.12 s, the
knees absorb); a two-foot jump loads ~0.15 m in ~0.3 s and a 0.35-0.45 m
hip rise is ~0.55 s in the air (t = 2 sqrt(2h/g)); a salute is crisp (the
hand to the brow in ~0.2 s, held, cut down in ~0.15 s); a walk "with
swagger" is a slow cadence (~80 steps/min) with a long stance and the
hips rolling over the stance foot.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import FIST, GRIP, IDLE, RELAXED, SPREAD, TUCK_ELBOW_R, TUCK_R, Clip, hands_of, keyed, mix, shift
from .actions_m6 import bump, rotate_pose
from .gait import FPS, smoothstep
from .poses import Arm, Foot, Pose, _hand
from .transitions import Plant, Steps

G = 9.81

# Hand states the celebrations add (poses._hand makes both sides; take one with hands_of).
# The index finger out straight, the rest closed in a fist, the thumb over the middle finger.
POINT = _hand((88, 100, 60), index=(0, 4, 2), thumb=((30, -16, 30), (30, 0, 0), (24, 0, 0)))
# The flat hand of a salute: fingers long and together, the thumb along the index.
FLAT = _hand((2, 4, 2), thumb=((12, -6, 4), (6, 0, 0), (2, 0, 0)))

IDLE_ARMS = IDLE.arms
L0, R0 = IDLE.feet["l"], IDLE.feet["r"]


def hand(state: dict, side: str) -> dict:
    return hands_of(state, side)


def spine(flex: float = 0.0, bend: float = 0.0, twist: float = 0.0) -> dict:
    """The trunk's flexion (+ forward), side bend (+ left) and twist (+ left)
    spread up the lumbar and thoracic spine (more in the thorax, as the
    ribs rotate further than the lumbar segments)."""
    return {
        "spine_01": (flex * 0.15, bend * 0.2, twist * 0.1),
        "spine_02": (flex * 0.3, bend * 0.3, twist * 0.25),
        "spine_03": (flex * 0.3, bend * 0.3, twist * 0.35),
        "spine_04": (flex * 0.25, bend * 0.2, twist * 0.3),
    }


def neck(flex: float = 0.0, tilt: float = 0.0, turn: float = 0.0) -> dict:
    return {"neck_01": (flex * 0.5, tilt * 0.4, turn * 0.4), "neck_02": (flex * 0.25, tilt * 0.3, turn * 0.3), "head": (flex * 0.25, tilt * 0.3, turn * 0.3)}


def P(pel: dict | None = None, joints: dict | None = None, arms: dict | None = None, hands: dict | None = None, elbow: dict | None = None, gaze=None) -> Pose:
    """A key: the pelvis (forward, up, side, flex, lateral, twist), joints,
    aimed arms, hand IK targets (world, around a body standing at the
    origin) and the gaze. The feet come from the clip's step plan."""
    return Pose(pelvis=dict(pel or {}), joints=dict(joints or {}), feet={"l": L0, "r": R0}, arms=dict(arms or {}), hands=dict(hands or {}), elbow=dict(elbow or {}), gaze=gaze)


def idle_with(**kw) -> Pose:
    """The idle with some of its fields replaced."""
    p = copy.deepcopy(IDLE)
    for k, v in kw.items():
        setattr(p, k, v)
    return p


# The start: the idle with the ball tucked in the right arm (the runtime
# hands the carrier into the clip straight off his carry).
TUCKED = idle_with(hands={"r": TUCK_R}, elbow={"r": TUCK_ELBOW_R}, arms={"l": IDLE_ARMS["l"]}, joints={**IDLE.joints, **hand(GRIP, "r"), "hand_r": (-15, 0, 10)})
# The end: the idle, the ball (if he still has it) held loosely in the right hand at his side.
HOLDING = idle_with(joints={**IDLE.joints, **hand(GRIP, "r")})
EMPTY = copy.deepcopy(IDLE)


def raise_hands(p: Pose, dz: float, dy: float = 0.0) -> Pose:
    """Hand IK targets and elbow poles keyed around standing hips, carried with the hips (up dz, along y dy)."""
    q = copy.deepcopy(p)
    q.hands = {s: (h[0], h[1] + dy, h[2] + dz, *h[3:]) for s, h in q.hands.items()}
    q.elbow = {s: (e[0], e[1] + dy, e[2] + dz) for s, e in q.elbow.items()}
    return q


def at_hips(p: Pose, up: float, fwd: float) -> Pose:
    """A key's hand targets moved with its own pelvis offset (the keys author hands around standing hips)."""
    return raise_hands(p, up - IDLE.pelvis.get("up", 0.0), -fwd)


def with_feet(p: Pose, steps: Steps, t: float, heel: dict | None = None) -> Pose:
    p.feet = {s: steps.foot(s, t) for s in "lr"}
    if heel:
        for s, h in heel.items():
            if h:
                p.feet[s] = replace(p.feet[s], heel=p.feet[s].heel + h)
    return p


def still_steps(lf: Foot = L0, rf: Foot = R0) -> Steps:
    return Steps([Plant("l", -1, math.inf, lf), Plant("r", -1, math.inf, rf)])


def flight(p: Pose, t: float, t_off: float, t_land: float, lift: float, tuck: tuple[float, float] = (40.0, 70.0)) -> Pose:
    """In the air: both feet leave together and come down together; the legs
    shape from the hips (thighs up `tuck[0]`, knees bent `tuck[1]` at the
    top), the balls of the feet carried up with the body."""
    if not t_off < t < t_land:
        return p
    u = (t - t_off) / (t_land - t_off)
    w = math.sin(math.pi * u)
    k = smoothstep(0.0, 0.25, u) * (1 - smoothstep(0.75, 1.0, u))
    out = {}
    for s in "lr":
        f = p.feet[s]
        out[s] = replace(f, lift=f.lift + lift, heel=f.heel + 35 * k, fk=(tuck[0] * w, tuck[1] * w, k) if k > 1e-3 else None)
    p.feet = out
    return p


def jump_up(t: float, t_off: float, t_land: float, rise: float) -> float:
    """Hip rise (m) on the ballistic arc between takeoff and landing."""
    if not t_off < t < t_land:
        return 0.0
    u = t - t_off
    T = t_land - t_off
    g = 8.0 * rise / (T * T)
    return g * T / 2 * u - g * u * u / 2


def cel_clip(name: str, T: float, pose, steps: Steps, travel=None, events=None) -> Clip:
    return Clip(name, "transition", T, pose, travel, "stance_idle", "stance_idle", steps, events=events or {})


# --- Arm shapes --------------------------------------------------------------------------------

OVERHEAD = Arm(flex=172, elbow=6, abd=14, inward=0.1)
SKY_POINT = Arm(flex=160, elbow=4, abd=22, inward=0.0)
# The roar: chest out, arms bowed down and out from the sides, fists clenched.
ROAR = Arm(flex=8, elbow=74, abd=36, inward=0.55, clavicle=-4)
# Front double biceps: upper arms out level, forearms up, fists at the ears.
BICEPS = Arm(flex=88, elbow=122, abd=84, inward=0.0)
# The crunch: shoulders rolled forward, fists together in front of the belt.
CRUNCH = Arm(flex=34, elbow=104, abd=30, inward=0.65, clavicle=16)
# Arms swung back and out for a jump or a chest bump.
BACK = Arm(flex=-48, elbow=24, abd=30, inward=0.0)
LOAD = Arm(flex=-30, elbow=30, abd=16, inward=0.1)


# --- 1. Spike ----------------------------------------------------------------------------------


def spike_keys(t0: float) -> list:
    """The spike from the windup (ball overhead) at t0: the slam, the
    follow-through and the roar. The release is at t0 + 0.10."""
    wind = P(
        {"forward": 0.22, "up": -0.06, "flex": -6},
        {**spine(-12), **neck(10), **hand(GRIP, "r"), **hand(RELAXED, "l"), "hand_r": (-30, 0, 0)},
        {"r": Arm(flex=176, elbow=74, abd=22, inward=0.0, clavicle=8), "l": Arm(flex=92, elbow=22, abd=16, inward=0.1)},
        gaze=(32.0, 0.0, 0.6),
    )
    slam = P(
        {"forward": 0.30, "up": -0.22, "flex": 34},
        {**spine(16), **neck(14), **hand(SPREAD, "r"), **hand(FIST, "l"), "hand_r": (40, 0, 0)},
        {"r": Arm(flex=42, elbow=8, abd=8, inward=0.1), "l": Arm(flex=-34, elbow=46, abd=20, inward=0.1)},
        gaze=(48.0, 0.0, 0.6),
    )
    low = P(
        {"forward": 0.28, "up": -0.24, "flex": 30},
        {**spine(12), **neck(-6), **hand(FIST, "r"), **hand(FIST, "l")},
        {"r": Arm(flex=24, elbow=60, abd=18, inward=0.2), "l": Arm(flex=-10, elbow=60, abd=24, inward=0.1)},
        gaze=(20.0, 0.0, 0.6),
    )
    roar = P(
        {"forward": 0.20, "up": -0.12, "flex": -4},
        {**spine(-8), **neck(-14), **hand(FIST, "r"), **hand(FIST, "l")},
        {"r": ROAR, "l": ROAR},
        gaze=(-16.0, 0.0, 0.7),
    )
    roar2 = P(
        {"forward": 0.20, "up": -0.16, "flex": 2},
        {**spine(-4), **neck(-18), **hand(FIST, "r"), **hand(FIST, "l")},
        {"r": replace(ROAR, elbow=88, abd=40), "l": replace(ROAR, elbow=88, abd=40)},
        gaze=(-20.0, 0.0, 0.7),
    )
    return [(t0, wind), (t0 + 0.12, slam), (t0 + 0.42, low), (t0 + 0.78, roar), (t0 + 1.02, roar2), (t0 + 1.24, roar), (t0 + 1.46, roar2)]


def spike() -> Clip:
    """A step at it with the left foot, the ball up overhead and the back
    arched (eyes on the spot), then the whole body whips it down into the
    turf in front of him (release frame 21); he comes up roaring at the
    stands, chest out, arms bowed, and steps back to stand."""
    T = 2.9
    tw = 0.50  # the windup is reached
    l1 = Foot(0.12, -0.56, heel=0, out=6)
    steps = Steps([
        Plant("l", -1, 0.12, L0), Plant("l", 0.40, 2.22, l1), Plant("l", 2.52, math.inf, L0),
        Plant("r", -1, math.inf, R0),
    ], height=0.06)
    keys = [(0.0, TUCKED), (0.16, at_hips(TUCKED, -0.04, 0.06))]
    keys += spike_keys(tw)
    keys += [(2.18, P({"forward": 0.20, "up": -0.05}, {**IDLE.joints, **hand(RELAXED, "r")}, IDLE_ARMS, gaze=(0.0, 0.0))), (T, EMPTY)]

    def pose(t):
        p = keyed(keys, t)
        # The back heel comes up as the weight goes over the front foot.
        lean = smoothstep(0.2, 0.55, t) * (1 - smoothstep(2.0, 2.5, t))
        return with_feet(p, steps, t, {"r": 26 * lean})

    return cel_clip("cel_spike", T, pose, steps, events={"release": round((tw + 0.10) * FPS)})


# --- 2. Spin and spike ------------------------------------------------------------------------


def spin_spike() -> Clip:
    """The ball up in the right hand, he pivots a full turn to his left on
    the ball of the left foot (the right knee up, the free arm out), lands
    square and spikes it out of the turn (release frame 34), then both
    index fingers to the sky."""
    T = 3.1
    t_s, t_e = 0.18, 0.92  # the pivot
    tw = 0.98  # windup reached as the right foot lands

    def yaw(t):
        return 360.0 * smoothstep(t_s, t_e, t)

    # Over the left foot for the pivot.
    cx, cy = L0.x, L0.y
    up_ball = P(
        {"side": 0.10, "forward": 0.06, "up": -0.06, "flex": 6},
        {**spine(-4, 4), **hand(GRIP, "r"), **hand(SPREAD, "l"), "hand_r": (-30, 0, 0)},
        {"r": Arm(flex=168, elbow=44, abd=24, inward=0.0, clavicle=6), "l": Arm(flex=30, elbow=30, abd=70, inward=0.0)},
        gaze=(4.0, 0.0, 0.6),
    )
    land = P(
        {"forward": 0.08, "up": -0.08, "flex": 2},
        {**spine(-8), **hand(GRIP, "r"), **hand(RELAXED, "l"), "hand_r": (-30, 0, 0)},
        {"r": Arm(flex=176, elbow=70, abd=22, inward=0.0, clavicle=8), "l": Arm(flex=80, elbow=24, abd=20, inward=0.1)},
        gaze=(28.0, 0.0, 0.6),
    )
    # The spike's keys, moved back over the stance (he spikes from where he lands, no step).
    sk = [(t, shift_pel(p, -0.18)) for t, p in spike_keys(tw)]
    sky = P({"forward": 0.04, "up": -0.04, "flex": -4}, {**spine(-10), **neck(-20), **hand(POINT, "r"), **hand(POINT, "l")}, {"r": SKY_POINT, "l": SKY_POINT}, gaze=(-30.0, 0.0, 0.7))
    keys = [(0.0, TUCKED), (t_s, up_ball), (t_e - 0.12, up_ball), (tw, land), *sk[:3], (tw + 0.66, sky), (tw + 1.32, sky), (T - 0.35, P({}, {**IDLE.joints, **hand(RELAXED, "r")}, IDLE_ARMS, gaze=(0.0, 0.0))), (T, EMPTY)]
    # The right foot: up off the turf for the turn, round with the body, down where it started.
    steps = Steps([Plant("l", -1, math.inf, L0), Plant("r", -1, t_s - 0.04, R0), Plant("r", t_e + 0.02, math.inf, R0)], height=0.10)

    def pose(t):
        p = keyed(keys, t)
        a = yaw(t)
        p = with_feet(p, steps, t, {"r": 18 * smoothstep(tw, tw + 0.15, t) * (1 - smoothstep(tw + 0.5, tw + 0.8, t))})
        if t_s - 0.04 < t < t_e + 0.02:
            # The free leg: knee up, the foot under it, turning with the body.
            u = smoothstep(t_s - 0.04, t_s + 0.1, t) * (1 - smoothstep(t_e - 0.12, t_e + 0.02, t))
            rf = replace(R0, x=-0.06, y=-0.12, lift=0.28 * u, heel=20 * u, fk=(55 * u, 80 * u, u) if u > 1e-3 else None)
            body = copy.deepcopy(p)
            body.feet = {"l": p.feet["l"], "r": rf}
            body = rotate_pose(body, a, cx, cy)
            body.feet["l"] = replace(p.feet["l"], heel=p.feet["l"].heel + 16 * math.sin(math.pi * smoothstep(t_s - 0.04, t_e + 0.02, t)), out=p.feet["l"].out + a)
            # The head turns with the body through the middle of the turn
            # (the gaze lets go), spotting only going in and coming out.
            g = (*(body.gaze or (0.0, 0.0)), 0.6, 1.0)[:4]
            body.gaze = (g[0], g[1], g[2], g[3] * (1 - smoothstep(20, 60, a) + smoothstep(300, 345, a)))
            return body
        return p

    return cel_clip("cel_spin_spike", T, pose, steps, events={"release": round((tw + 0.10) * FPS)})


def shift_pel(p: Pose, dfwd: float) -> Pose:
    q = copy.deepcopy(p)
    q.pelvis["forward"] = q.pelvis.get("forward", 0.0) + dfwd
    return q


# --- 3. Flip it to the official ---------------------------------------------------------------


def flip_official() -> Clip:
    """Unhurried: a step toward the official, the ball out of the tuck to
    hang in the right hand, an underhand flip (release frame 20), then the
    index finger at him, the left hand on the hip, a nod; two claps and
    back to stand. The runtime turns him to face the official first."""
    T = 2.6
    l1 = Foot(0.13, -0.42, heel=0, out=8)
    steps = Steps([Plant("l", -1, 0.10, L0), Plant("l", 0.36, 2.0, l1), Plant("l", 2.25, math.inf, L0), Plant("r", -1, math.inf, R0)], height=0.05)
    hang = P({"forward": 0.10, "up": -0.05, "flex": 6, "twist": -8}, {**spine(4, 0, -6), **hand(GRIP, "r"), **hand(RELAXED, "l"), "hand_r": (-10, 0, 0)}, {"r": Arm(flex=-34, elbow=12, abd=10, inward=0.1), "l": Arm(flex=14, elbow=24, abd=12, inward=0.1)}, gaze=(8.0, 0.0))
    flip = P({"forward": 0.18, "up": -0.08, "flex": 10, "twist": 4}, {**spine(6, 0, 6), **hand(SPREAD, "r"), **hand(RELAXED, "l"), "hand_r": (-30, 0, 0)}, {"r": Arm(flex=78, elbow=14, abd=8, inward=0.2), "l": Arm(flex=-12, elbow=28, abd=14, inward=0.1)}, gaze=(2.0, 0.0))
    # The point, the left hand on the hip (wrist on the iliac crest, elbow out).
    hip_hand = {"l": (0.21, 0.02, 1.02)}
    hip_elbow = {"l": (0.62, 0.15, 1.15)}
    point = P({"forward": 0.16, "up": -0.04, "flex": 2, "lateral": 3}, {**spine(-2, 3), **neck(4), **hand(POINT, "r"), **hand(RELAXED, "l"), "hand_l": (20, 0, 0)}, {"r": Arm(flex=84, elbow=6, abd=12, inward=0.15)}, hip_hand, hip_elbow, gaze=(-2.0, 0.0, 0.6))
    nod = copy.deepcopy(point)
    nod.joints.update(neck(16))
    nod.gaze = (14.0, 0.0, 0.6)
    clap_open = P({"forward": 0.12, "up": -0.04}, {**spine(2), **hand(SPREAD, "r"), **hand(SPREAD, "l"), "hand_l": (-10, 0, -40), "hand_r": (-10, 0, -40)}, {}, {"l": (0.12, -0.36, 1.25), "r": (-0.12, -0.36, 1.25)}, {"l": (0.6, 0.1, 1.0), "r": (-0.6, 0.1, 1.0)}, gaze=(4.0, 0.0))
    clap_shut = copy.deepcopy(clap_open)
    clap_shut.hands = {"l": (0.025, -0.38, 1.27), "r": (-0.025, -0.38, 1.27)}
    keys = [(0.0, TUCKED), (0.40, hang), (0.66, flip), (0.98, point), (1.18, nod), (1.30, point), (1.48, clap_open), (1.60, clap_shut), (1.72, clap_open), (1.84, clap_shut), (2.0, clap_open), (2.35, EMPTY), (T, EMPTY)]

    def pose(t):
        return with_feet(keyed(keys, t), steps, t, {"r": 14 * smoothstep(0.3, 0.6, t) * (1 - smoothstep(1.9, 2.25, t))})

    return cel_clip("cel_flip_official", T, pose, steps, events={"release": round(0.64 * FPS)})


# --- 4. Point to the crowd ---------------------------------------------------------------------


def point_crowd() -> Clip:
    """The right foot out to a wide base, the ball held up in the right hand,
    the left index finger up at the stands, sweeping from his left to his
    right with two jabs at the sections he's playing to, eyes along it."""
    T = 3.2
    r1 = Foot(-0.27, -0.12, heel=0, out=16)
    steps = Steps([Plant("l", -1, math.inf, L0), Plant("r", -1, 0.12, R0), Plant("r", 0.36, 2.55, r1), Plant("r", 2.82, math.inf, R0)], height=0.05)

    def at(sweep: float, jab: float = 0.0) -> Pose:
        """Turned `sweep` degrees (+ his left), the pointing arm jabbing (0..1)."""
        return P(
            {"side": -0.04, "up": -0.07, "flex": -2, "twist": sweep * 0.4},
            {**spine(-8, 0, sweep * 0.75), **neck(-12, 0, sweep * 0.2), **hand(GRIP, "r"), **hand(POINT, "l"), "hand_r": (-20, 0, 0)},
            {"l": Arm(flex=96 - 8 * jab, elbow=4 + 30 * jab, abd=34, inward=0.0, clavicle=8), "r": Arm(flex=44, elbow=104, abd=58, inward=0.0)},
            gaze=(-18.0, sweep * 0.5, 0.6),
        )

    keys = [(0.0, TUCKED), (0.55, at(40)), (0.80, at(40, 1)), (0.95, at(38)), (1.75, at(-40)), (1.95, at(-40, 1)), (2.10, at(-40)), (2.40, at(-36)), (T - 0.15, HOLDING), (T, HOLDING)]

    def pose(t):
        return with_feet(keyed(keys, t), steps, t)

    return cel_clip("cel_point_crowd", T, pose, steps)


# --- 5. Leap at the stands ---------------------------------------------------------------------


def leap_wall() -> Clip:
    """Three steps at the wall behind the end line, a one-foot takeoff off
    the left (the right knee driving), the ball up overhead in the flight,
    a two-foot landing, then the lean into the front row: chest forward,
    arms spread out to them, a second reach, and back to stand. The
    runtime turns him toward the stands first. Travels 3.6 m."""
    T = 3.3
    t_off, t_land = 0.86, 1.38
    rise = 0.42
    D = 3.6
    # Forward travel (m): accelerate through the steps, carry through the
    # flight, stop on the landing.
    pts = [(0.0, 0.0, 0.0), (0.72, 2.25, 4.6), (t_land, 3.45, 2.6), (1.62, D, 0.0), (T, D, 0.0)]

    def fwd(t):
        for (ta, xa, va), (tb, xb, vb) in zip(pts, pts[1:]):
            if t <= tb:
                s = (t - ta) / (tb - ta)
                h = tb - ta
                return (2 * s**3 - 3 * s**2 + 1) * xa + (s**3 - 2 * s**2 + s) * va * h + (-2 * s**3 + 3 * s**2) * xb + (s**3 - s**2) * vb * h
        return D

    def travel(t):
        return (0.0, -fwd(t))

    y = lambda t: -fwd(t)  # noqa: E731
    lr = Foot(-0.11, y(0.30) - 0.12, heel=4, out=4)
    ll = Foot(0.11, y(0.52) - 0.14, heel=4, out=4)
    rr = Foot(-0.09, y(0.70) - 0.16, heel=0, out=4)
    lo = Foot(0.06, y(0.80) - 0.10, heel=-4, out=4)
    l_land = Foot(0.13, -D - 0.10, heel=0, out=9)
    r_land = Foot(-0.17, -D - 0.15, heel=5, out=15)
    steps = Steps([
        Plant("r", -1, 0.12, R0, roll=10), Plant("r", 0.30, 0.43, lr, roll=24), Plant("r", 0.66, 0.78, rr, roll=24), Plant("r", t_land + 0.02, math.inf, r_land),
        Plant("l", -1, 0.24, L0, roll=12), Plant("l", 0.50, 0.62, ll, roll=24), Plant("l", 0.76, t_off, lo, roll=34), Plant("l", t_land, math.inf, l_land),
    ], height=0.12)
    run = P({"up": -0.08, "flex": 12}, {**spine(6), **hand(GRIP, "r"), **hand(SPREAD, "l"), "hand_r": (-20, 0, 0)}, {"r": Arm(flex=20, elbow=80, abd=14, inward=0.2), "l": Arm(flex=10, elbow=85, abd=14, inward=0.2)}, gaze=(-6.0, 0.0))
    gather = P({"up": -0.17, "flex": 18}, {**spine(8), **hand(GRIP, "r"), **hand(SPREAD, "l"), "hand_r": (-20, 0, 0)}, {"r": BACK, "l": BACK}, gaze=(-10.0, 0.0))
    air = P({"up": 0.0, "flex": -8}, {**spine(-12), **neck(-10), **hand(GRIP, "r"), **hand(SPREAD, "l"), "hand_r": (-30, 0, 0)}, {"r": Arm(flex=160, elbow=12, abd=18, inward=0.1), "l": Arm(flex=140, elbow=14, abd=30, inward=0.0)}, gaze=(-24.0, 0.0, 0.7))
    absorb = P({"up": -0.20, "flex": 30}, {**spine(10), **hand(GRIP, "r"), **hand(SPREAD, "l"), "hand_r": (-20, 0, 0)}, {"r": Arm(flex=120, elbow=30, abd=34, inward=0.0), "l": Arm(flex=100, elbow=30, abd=40, inward=0.0)}, gaze=(-10.0, 0.0))
    lean = P({"up": -0.04, "flex": 30, "forward": 0.12}, {**spine(6), **neck(-26), **hand(GRIP, "r"), **hand(SPREAD, "l"), "hand_r": (-30, 0, 0)}, {"r": Arm(flex=104, elbow=16, abd=34, inward=0.0, clavicle=4), "l": Arm(flex=98, elbow=16, abd=40, inward=0.0, clavicle=4)}, gaze=(-24.0, 0.0, 0.8))
    back = P({"up": -0.10, "flex": 18, "forward": 0.04}, {**spine(2), **neck(-12), **hand(GRIP, "r"), **hand(SPREAD, "l")}, {"r": Arm(flex=70, elbow=30, abd=34, inward=0.0), "l": Arm(flex=64, elbow=30, abd=40, inward=0.0)}, gaze=(-10.0, 0.0))
    keys = [(0.0, TUCKED), (0.30, run), (0.66, run), (0.80, gather), (1.04, air), (1.20, air), (t_land + 0.08, absorb), (1.80, lean), (2.10, back), (2.40, lean), (2.70, back), (T, HOLDING)]

    def pose(t):
        p = keyed(keys, t)
        # The arms swing against the steps on the run-up (left forward as the right lands).
        sw = math.cos(math.pi * (t - 0.30) / 0.20) * smoothstep(0.08, 0.26, t) * (1 - smoothstep(0.62, 0.80, t))
        if abs(sw) > 1e-3 and "l" in p.arms and "r" in p.arms:
            p.arms["l"] = replace(p.arms["l"], flex=p.arms["l"].flex + 40 * sw)
            p.arms["r"] = replace(p.arms["r"], flex=p.arms["r"].flex - 30 * sw)
            p.pelvis["twist"] = p.pelvis.get("twist", 0.0) - 6 * sw
        p.pelvis["up"] = p.pelvis.get("up", 0.0) + jump_up(t, t_off, t_land, rise)
        p = shift(p, 0.0, y(t))
        p = with_feet(p, steps, t)
        if t_off < t < t_land:
            # One foot off: the takeoff leg trails, the right knee drives, both reach for the turf.
            u = (t - t_off) / (t_land - t_off)
            k = smoothstep(0.0, 0.2, u) * (1 - smoothstep(0.8, 1.0, u))
            lift = jump_up(t, t_off, t_land, rise)
            fl = (-15 + 45 * smoothstep(0.4, 0.9, u), 40 + 30 * math.sin(math.pi * u))
            fr = (75 - 50 * smoothstep(0.5, 0.9, u), 100 - 60 * smoothstep(0.5, 0.9, u))
            p.feet = {s: replace(p.feet[s], lift=p.feet[s].lift + lift, heel=p.feet[s].heel + 30 * k, fk=(a, b, k) if k > 1e-3 else None) for s, (a, b) in (("l", fl), ("r", fr))}
        return p

    return cel_clip("cel_leap_wall", T, pose, steps, travel)


# --- 6. Flex ------------------------------------------------------------------------------------


def flex() -> Clip:
    """He lets the ball fall at his feet (release frame 5), widens his
    base a foot at a time, hits a front double biceps with the chest up,
    pulses it, then crunches into the most-muscular with a shout, and
    steps back in to stand."""
    T = 3.0
    l1, r1 = Foot(0.25, -0.11, heel=0, out=12), Foot(-0.25, -0.11, heel=0, out=12)
    steps = Steps([
        Plant("r", -1, 0.22, R0), Plant("r", 0.46, 2.40, r1), Plant("r", 2.66, math.inf, R0),
        Plant("l", -1, 0.48, L0), Plant("l", 0.70, 2.18, l1), Plant("l", 2.42, math.inf, L0),
    ], height=0.05)
    drop = idle_with(hands={"r": (-0.16, -0.33, 1.10)}, elbow={"r": TUCK_ELBOW_R}, arms={"l": IDLE_ARMS["l"]}, joints={**IDLE.joints, **hand(SPREAD, "r"), "hand_r": (10, 0, 0)}, gaze=(30.0, 0.0))
    bi = P({"up": -0.06, "flex": -2}, {**spine(-10), **neck(-6), **hand(FIST, "r"), **hand(FIST, "l"), "hand_r": (30, 0, 0), "hand_l": (30, 0, 0)}, {"r": BICEPS, "l": BICEPS}, gaze=(-4.0, 0.0))
    bi2 = P({"up": -0.08, "flex": -4}, {**spine(-12), **neck(-8), **hand(FIST, "r"), **hand(FIST, "l"), "hand_r": (40, 0, 0), "hand_l": (40, 0, 0)}, {"r": replace(BICEPS, elbow=132, abd=88), "l": replace(BICEPS, elbow=132, abd=88)}, gaze=(-6.0, 0.0))
    crunch = P({"up": -0.14, "flex": 20}, {**spine(14), **neck(-26), **hand(FIST, "r"), **hand(FIST, "l"), "hand_r": (20, 0, 20), "hand_l": (20, 0, 20)}, {"r": CRUNCH, "l": CRUNCH}, gaze=(-8.0, 0.0, 0.8))
    crunch2 = P({"up": -0.16, "flex": 22}, {**spine(16), **neck(-28), **hand(FIST, "r"), **hand(FIST, "l"), "hand_r": (20, 0, 20), "hand_l": (20, 0, 20)}, {"r": replace(CRUNCH, elbow=96), "l": replace(CRUNCH, elbow=96)}, gaze=(-10.0, 0.0, 0.8))
    keys = [(0.0, TUCKED), (0.20, drop), (0.36, drop), (0.80, P({"up": -0.04}, {**spine(-4), **hand(RELAXED, "r"), **hand(RELAXED, "l")}, {"r": Arm(flex=10, elbow=40, abd=30), "l": Arm(flex=10, elbow=40, abd=30)}, gaze=(0.0, 0.0))),
            (1.02, bi), (1.22, bi2), (1.36, bi), (1.50, bi2), (1.72, crunch), (1.86, crunch2), (2.00, crunch), (2.14, crunch2), (2.40, P({"up": -0.04}, {**spine(), **hand(RELAXED, "r"), **hand(RELAXED, "l")}, IDLE_ARMS, gaze=(0.0, 0.0))), (T, EMPTY)]

    def pose(t):
        p = keyed(keys, t)
        # The hips follow the base: centred over the wide stance.
        w = smoothstep(0.3, 0.75, t) * (1 - smoothstep(2.2, 2.7, t))
        p.pelvis["side"] = p.pelvis.get("side", 0.0) * (1 - w)
        return with_feet(p, steps, t)

    return cel_clip("cel_flex", T, pose, steps, events={"release": 5})


# --- 7. Salute ---------------------------------------------------------------------------------


def salute() -> Clip:
    """The ball into the left hand (frame 12), the right heel in beside the
    left: at attention, chin up. The right hand comes up crisp to the brow,
    flat, the elbow out; held; cut down; and a nod as he relaxes."""
    T = 2.9
    lf = Foot(0.10, -0.13, heel=0, out=20)
    rf = Foot(-0.10, -0.13, heel=0, out=20)
    steps = Steps([Plant("l", -1, 0.30, L0), Plant("l", 0.52, 2.30, lf), Plant("l", 2.55, math.inf, L0), Plant("r", -1, 0.12, R0), Plant("r", 0.34, 2.36, rf), Plant("r", 2.62, math.inf, R0)], height=0.04)
    swap = P({"up": -0.02}, {**hand(GRIP, "r"), **hand(GRIP, "l"), "hand_r": (-20, 0, 10), "hand_l": (-20, 0, -10)}, {}, {"l": (0.07, -0.27, 1.22), "r": (-0.05, -0.25, 1.26)}, {"l": (0.55, 0.35, 0.95), "r": (-0.55, 0.35, 0.95)}, gaze=(14.0, 0.0))
    ball_l = {"l": (0.095, -0.235, 1.27)}
    ball_le = {"l": (0.30, 0.45, 0.85)}
    attn = P({"up": 0.0, "flex": -3}, {**spine(-6), **neck(-8), **hand(GRIP, "l"), **hand(FLAT, "r"), "hand_l": (-15, 0, -10)}, {"r": Arm(flex=0, elbow=6, abd=8, inward=0.0)}, ball_l, ball_le, gaze=(-6.0, 0.0))
    # The salute: the wrist in front of the right brow, the forearm angled up and in, the upper arm out and level.
    sal_h = {"r": (-0.13, -0.15, 1.74), **ball_l}
    sal_e = {"r": (-0.75, -0.25, 1.55), **ball_le}
    up = P({"up": 0.0, "flex": -3}, {**spine(-6), **neck(-8), **hand(GRIP, "l"), **hand(FLAT, "r"), "hand_l": (-15, 0, -10), "hand_r": (0, 0, -70)}, {}, sal_h, sal_e, gaze=(-6.0, 0.0))
    held = copy.deepcopy(up)
    held.pelvis["up"] = -0.005
    cut = copy.deepcopy(attn)
    nod = copy.deepcopy(attn)
    nod.joints.update(neck(14))
    nod.gaze = (14.0, 0.0)
    keys = [(0.0, TUCKED), (0.40, swap), (0.70, attn), (0.92, attn), (1.12, up), (1.20, held), (1.95, up), (2.10, cut), (2.30, nod), (2.55, attn), (T, idle_with(joints={**IDLE.joints, **hand(GRIP, "l")}))]

    def pose(t):
        return with_feet(keyed(keys, t), steps, t)

    return cel_clip("cel_salute", T, pose, steps, events={"left": 12})


# --- 8. Take a knee ----------------------------------------------------------------------------


def kneel() -> Clip:
    """He steps back with the right and goes down on the right knee, the
    ball on the left knee under his hand, the head bowed: a moment. Then
    the eyes come up and the left index finger goes to the sky; he rises
    and steps up to stand."""
    T = 3.8
    rk = Foot(-0.14, 0.62, heel=74, out=4)
    steps = Steps([Plant("l", -1, math.inf, L0), Plant("r", -1, 0.12, R0), Plant("r", 0.66, 2.90, rk), Plant("r", 3.28, math.inf, R0)], height=0.06)
    # Down (the holder's kneel, behind the front foot): hips 0.46 m lower, back over the right knee.
    down = P({"forward": -0.22, "up": -0.47, "flex": 18}, {**spine(14), **neck(30), **hand(GRIP, "r"), **hand(RELAXED, "l"), "hand_r": (-10, 0, 20)}, {"l": Arm(flex=30, elbow=60, abd=10, inward=0.3)}, {"r": (0.06, -0.20, 0.62)}, {"r": (-0.55, 0.2, 0.9)}, gaze=(48.0, 0.0, 0.8))
    bowed = copy.deepcopy(down)
    bowed.joints.update({**spine(18), **neck(36)})
    bowed.gaze = (56.0, 0.0, 0.8)
    look = copy.deepcopy(down)
    look.joints.update({**spine(2), **neck(-22), **hand(POINT, "l")})
    look.arms = {"l": SKY_POINT}
    look.gaze = (-36.0, 0.0, 0.8)
    look.pelvis["flex"] = 8
    keys = [(0.0, TUCKED), (0.48, at_hips(TUCKED, -0.28, -0.15)), (1.00, down), (1.25, bowed), (2.05, bowed), (2.45, look), (2.95, look), (3.30, at_hips(HOLDING, -0.10, -0.04)), (T, HOLDING)]

    def pose(t):
        p = keyed(keys, t)
        return with_feet(p, steps, t)

    return cel_clip("cel_kneel", T, pose, steps)


# --- 9. The slow walk, ball held high --------------------------------------------------------


def ball_high_walk() -> Clip:
    """Four slow steps (~80 a minute) with the ball held straight up in the
    right hand and the chin up, the hips rolling over each stance foot, the
    free arm loose; then the right foot closes and the ball comes down.
    Travels 1.2 m."""
    T = 4.0
    stride = 0.58
    # (foot, lift, land, forward distance from the start): right half a
    # stride, three full strides, the right closes beside the left.
    seq = [("r", 0.20, 0.64, stride * 0.5), ("l", 0.80, 1.36, stride), ("r", 1.52, 2.08, stride * 1.5), ("l", 2.24, 2.80, stride * 2), ("r", 2.96, 3.36, stride * 2)]
    D = stride * 2
    plants = []
    prev = {"l": (-1.0, L0), "r": (-1.0, R0)}
    for s, lift, land, d in seq:
        t_in, f_in = prev[s]
        plants.append(Plant(s, t_in, lift, f_in, roll=14))
        base = L0 if s == "l" else R0
        final = d >= D and s == "r" and land > 3.0
        foot = Foot(base.x, base.y - d, heel=base.heel, out=base.out) if (final or (s == "l" and d >= D)) else Foot(base.x * 0.75, base.y - d, heel=-6, out=base.out * 0.5)
        prev[s] = (land, foot)
    for s, (t_in, f_in) in prev.items():
        plants.append(Plant(s, t_in, math.inf, f_in))
    steps = Steps(plants, height=0.07)
    t_a, t_b = 0.14, 3.30

    def fwd(t):
        # The hips move on steadily through the steps, easing in and out.
        u = min(1.0, max(0.0, (t - t_a) / (t_b - t_a)))
        return D * (u - math.sin(2 * math.pi * u) / (2 * math.pi))

    def travel(t):
        return (0.0, -fwd(t))

    high = P({"up": -0.04, "flex": -4}, {**spine(-8), **neck(-14), **hand(GRIP, "r"), **hand(RELAXED, "l"), "hand_r": (-10, 0, 0)}, {"r": OVERHEAD, "l": Arm(flex=8, elbow=22, abd=22, inward=0.0)}, gaze=(-14.0, 0.0))
    keys = [(0.0, TUCKED), (0.55, high), (T - 0.75, high), (T, HOLDING)]

    def stance_side(t):
        """+1 over the left foot, -1 over the right, through the walk."""
        if t < 0.4 or t > 3.2:
            return 0.0
        # Over the left while the right swings (0.2-0.64), over the right while the left swings, ...
        u = (t - 0.42) / 0.72
        return math.cos(math.pi * u) * smoothstep(0.4, 0.6, t) * (1 - smoothstep(2.9, 3.2, t))

    def pose(t):
        p = keyed(keys, t)
        w = stance_side(t)
        p.pelvis.update({"side": p.pelvis.get("side", 0.0) * (1 - abs(w)) + 0.035 * w, "lateral": 4.0 * w, "twist": -7.0 * w})
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.02 * (1 - abs(w)) * smoothstep(0.3, 0.6, t) * (1 - smoothstep(3.0, 3.4, t))
        if "l" in p.arms and 0.4 < t < T - 0.6:
            p.arms["l"] = replace(p.arms["l"], flex=p.arms["l"].flex - 14 * w)
        p = shift(p, 0.0, -fwd(t))
        return with_feet(p, steps, t)

    return cel_clip("cel_ball_high", T, pose, steps, travel)


# --- 10. Chest bump (two men) ------------------------------------------------------------------


def chest_bump(name: str = "cel_chest_bump") -> Clip:
    """Two steps in, a two-foot gather and the jump with the chest thrown
    forward and the arms swung back: the chests meet at the top (contact,
    frame 21), a recoil, land, and a fist pulled down. Both men play it,
    ~1.4 m apart facing each other. Travels 0.40 m."""
    T = 2.0
    t_off, t_land = 0.50, 0.98
    rise = 0.34
    pts = [(0.0, 0.0), (0.44, 0.34), (0.70, 0.50), (0.84, 0.42), (t_land, 0.40), (T, 0.40)]

    def fwd(t):
        for (ta, xa), (tb, xb) in zip(pts, pts[1:]):
            if t <= tb:
                return xa + (xb - xa) * smoothstep(ta, tb, t)
        return pts[-1][1]

    def travel(t):
        return (0.0, -fwd(t))

    E = 0.40
    steps = Steps([
        Plant("r", -1, 0.06, R0, roll=10), Plant("r", 0.22, t_off, Foot(-0.15, -0.30, heel=4, out=10), roll=30), Plant("r", t_land + 0.02, math.inf, Foot(R0.x, R0.y - E, heel=R0.heel, out=R0.out)),
        Plant("l", -1, 0.18, L0, roll=10), Plant("l", 0.36, t_off, Foot(0.15, -0.40, heel=4, out=10), roll=30), Plant("l", t_land, math.inf, Foot(L0.x, L0.y - E, heel=L0.heel, out=L0.out)),
    ], height=0.07)
    gather = P({"up": -0.17, "flex": 22}, {**spine(8), **hand(FIST, "l"), "hand_r": (-10, 0, 0)}, {"r": LOAD, "l": LOAD}, gaze=(-4.0, 0.0))
    chest = P({"up": 0.0, "flex": -14}, {**spine(-22), **neck(-8), **hand(SPREAD, "l"), "hand_r": (-10, 0, 0)}, {"r": BACK, "l": BACK}, gaze=(-8.0, 0.0, 0.7))
    land = P({"up": -0.18, "flex": 24}, {**spine(10), **hand(FIST, "l")}, {"r": Arm(flex=30, elbow=60, abd=24), "l": Arm(flex=40, elbow=90, abd=24, inward=0.2)}, gaze=(0.0, 0.0))
    pump = P({"up": -0.10, "flex": 16}, {**spine(10), **neck(-16), **hand(FIST, "l")}, {"r": Arm(flex=20, elbow=50, abd=20), "l": Arm(flex=18, elbow=128, abd=26, inward=0.3)}, gaze=(-6.0, 0.0))
    keys = [(0.0, TUCKED), (0.40, gather), (0.70, chest), (0.80, chest), (t_land + 0.06, land), (1.30, P({"up": -0.04}, {**neck(-10), **hand(FIST, "l")}, {"r": Arm(flex=20, elbow=40, abd=18), "l": Arm(flex=150, elbow=30, abd=24)}, gaze=(-12.0, 0.0))), (1.50, pump), (T, HOLDING)]
    # The ball stays in the right hand, low, swinging back with the arm.
    keys = [(t, copy.deepcopy(k)) for t, k in keys]
    for _, k in keys:
        k.joints.update(hand(GRIP, "r"))

    def pose(t):
        p = keyed(keys, t)
        p.pelvis["up"] = p.pelvis.get("up", 0.0) + jump_up(t, t_off, t_land, rise)
        p = shift(p, 0.0, -fwd(t))
        p = with_feet(p, steps, t)
        return flight(p, t, t_off, t_land, jump_up(t, t_off, t_land, rise), (30.0, 60.0))

    return cel_clip(name, T, pose, steps, travel, events={"contact": round(0.70 * FPS)})


# --- 11. Jump and fist pump ---------------------------------------------------------------------


def jump_fist() -> Clip:
    """A dip, straight up off both feet with the left fist punched at the
    sky at the top and the knees tucked, the ball kept tucked in the right
    arm; land, and two pulls of the fist down to the hip ("yes")."""
    T = 2.3
    t_off, t_land = 0.40, 0.96
    rise = 0.40
    steps = Steps([Plant("l", -1, t_off, L0, roll=24), Plant("l", t_land, math.inf, L0), Plant("r", -1, t_off, R0, roll=24), Plant("r", t_land, math.inf, R0)], height=0.0)
    tuck_j = {**IDLE.joints, **hand(GRIP, "r"), "hand_r": (-15, 0, 10)}

    def tucked(pel: dict, arm_l: Arm, extra: dict | None = None, gaze=(0.0, 0.0)) -> Pose:
        p = P(pel, {**tuck_j, **(extra or {})}, {"l": arm_l}, {"r": TUCK_R}, {"r": TUCK_ELBOW_R}, gaze=gaze)
        return at_hips(p, pel.get("up", 0.0), pel.get("forward", 0.0))

    dip = tucked({"up": -0.16, "flex": 22}, LOAD, {**spine(8), **hand(FIST, "l")}, (6.0, 0.0))
    top = tucked({"up": -0.02, "flex": -6}, Arm(flex=168, elbow=4, abd=16, inward=0.0, clavicle=6), {**spine(-10), **neck(-16), **hand(FIST, "l")}, (-26.0, 0.0, 0.7))
    land = tucked({"up": -0.17, "flex": 24}, Arm(flex=110, elbow=40, abd=30), {**spine(8), **hand(FIST, "l")}, (4.0, 0.0))
    up1 = tucked({"up": -0.06, "flex": 6}, Arm(flex=120, elbow=60, abd=26, inward=0.1), {**neck(-8), **hand(FIST, "l")}, (-6.0, 0.0))
    pull = tucked({"up": -0.12, "flex": 18}, Arm(flex=6, elbow=118, abd=22, inward=0.2), {**spine(8), **neck(-14), **hand(FIST, "l")}, (-2.0, 0.0))
    keys = [(0.0, TUCKED), (0.34, dip), (0.62, top), (0.76, top), (t_land + 0.08, land), (1.20, up1), (1.38, pull), (1.52, up1), (1.70, pull), (T, HOLDING)]

    def pose(t):
        p = keyed(keys, t)
        dz = jump_up(t, t_off, t_land, rise)
        p.pelvis["up"] = p.pelvis.get("up", 0.0) + dz
        p.hands = {s: (h[0], h[1], h[2] + dz, *h[3:]) for s, h in p.hands.items()}
        p.elbow = {s: (e[0], e[1], e[2] + dz) for s, e in p.elbow.items()}
        p = with_feet(p, steps, t)
        return flight(p, t, t_off, t_land, dz, (58.0, 96.0))

    return cel_clip("cel_jump_fist", T, pose, steps)


# --- 12. The dropped-ball shrug --------------------------------------------------------------


def shrug() -> Clip:
    """The ball held out at arm's length, looked at, and let go (release
    frame 15), eyes following it down; then the big shrug, shoulders to the
    ears, palms up, head tilted, a hip out; a second, smaller one; and back
    to stand. Nonchalant: he meant to do that."""
    T = 2.6
    steps = Steps([Plant("l", -1, math.inf, L0), Plant("r", -1, 0.50, R0, roll=6), Plant("r", 0.72, 1.92, Foot(-0.20, -0.08, heel=0, out=20)), Plant("r", 2.16, math.inf, R0)], height=0.04)
    out = P({"up": -0.02, "flex": 2}, {**hand(GRIP, "r"), **hand(RELAXED, "l"), "hand_r": (-6, 0, -80)}, {"r": Arm(flex=80, elbow=8, abd=10, inward=0.1), "l": IDLE_ARMS["l"]}, gaze=(18.0, -8.0))
    let = copy.deepcopy(out)
    let.joints.update(hand(SPREAD, "r"))
    look = copy.deepcopy(let)
    look.gaze = (48.0, -6.0, 0.7)
    palms = {"hand_l": (-40, 0, 80), "hand_r": (-40, 0, 80)}
    big = P({"up": -0.025, "side": 0.03, "lateral": 4}, {**spine(-2, 3), **neck(0, 12), **hand(SPREAD, "r"), **hand(SPREAD, "l"), **palms, "clavicle_l": (0, 13, 0), "clavicle_r": (0, 13, 0)}, {"r": Arm(flex=14, elbow=96, abd=26, inward=-0.6), "l": Arm(flex=14, elbow=96, abd=26, inward=-0.6)}, gaze=(-4.0, 0.0, 0.5))
    small = P({"up": -0.01, "side": -0.02, "lateral": -3}, {**spine(0, -2), **neck(0, -8), **hand(SPREAD, "r"), **hand(SPREAD, "l"), **palms, "clavicle_l": (0, 8, 0), "clavicle_r": (0, 8, 0)}, {"r": Arm(flex=10, elbow=90, abd=24, inward=-0.5), "l": Arm(flex=10, elbow=90, abd=24, inward=-0.5)}, gaze=(0.0, 0.0, 0.5))
    mid = P({"up": -0.01}, {**hand(RELAXED, "r"), **hand(RELAXED, "l")}, {"r": Arm(flex=8, elbow=50, abd=20), "l": Arm(flex=8, elbow=50, abd=20)}, gaze=(0.0, 0.0))
    keys = [(0.0, TUCKED), (0.38, out), (0.48, let), (0.62, look), (0.78, look), (1.08, big), (1.36, big), (1.52, mid), (1.72, small), (1.92, small), (2.20, EMPTY), (T, EMPTY)]

    def pose(t):
        return with_feet(keyed(keys, t), steps, t)

    return cel_clip("cel_shrug", T, pose, steps, events={"release": round(0.48 * FPS)})


# --- Team-mates ---------------------------------------------------------------------------------


def mate_point() -> Clip:
    """A team-mate arrived beside the scorer: both index fingers at him, a
    bounce on the toes, two claps, and back to stand."""
    T = 2.2
    steps = still_steps()
    pt = P({"up": -0.06, "flex": 8}, {**spine(6), **neck(-6), **hand(POINT, "r"), **hand(POINT, "l")}, {"r": Arm(flex=92, elbow=8, abd=6, inward=0.25), "l": Arm(flex=92, elbow=8, abd=6, inward=0.25)}, gaze=(0.0, 0.0))
    pt2 = copy.deepcopy(pt)
    pt2.pelvis["up"] = -0.10
    pt2.arms = {s: replace(a, flex=84, elbow=20) for s, a in pt.arms.items()}
    clap_open = P({"up": -0.04, "flex": 4}, {**hand(SPREAD, "r"), **hand(SPREAD, "l"), "hand_l": (-10, 0, -40), "hand_r": (-10, 0, -40)}, {}, {"l": (0.13, -0.36, 1.28), "r": (-0.13, -0.36, 1.28)}, {"l": (0.6, 0.1, 1.0), "r": (-0.6, 0.1, 1.0)}, gaze=(-4.0, 0.0))
    clap_shut = copy.deepcopy(clap_open)
    clap_shut.hands = {"l": (0.025, -0.38, 1.30), "r": (-0.025, -0.38, 1.30)}
    keys = [(0.0, EMPTY), (0.30, pt), (0.48, pt2), (0.64, pt), (0.80, pt2), (0.96, pt), (1.14, clap_open), (1.26, clap_shut), (1.40, clap_open), (1.52, clap_shut), (1.70, clap_open), (T, EMPTY)]

    def pose(t):
        lift = 12 * (bump(t, 0.36, 0.56) + bump(t, 0.68, 0.88))
        return with_feet(keyed(keys, t), steps, t, {"l": lift, "r": lift})

    return cel_clip("cel_mate_point", T, pose, steps)


def high_five(name: str = "cel_five_r") -> Clip:
    """A step in on the left, the right hand swung up high and slapped on
    the centre line between two men ~1.15 m apart (contact, frame 17),
    the arm follows through down, and he steps back to stand."""
    T = 1.6
    lf = Foot(0.12, -0.36, heel=4, out=6)
    steps = Steps([Plant("l", -1, 0.08, L0), Plant("l", 0.30, 1.10, lf), Plant("l", 1.34, math.inf, L0), Plant("r", -1, math.inf, R0)], height=0.05)
    cock = P({"forward": 0.10, "up": -0.06, "flex": 4, "twist": -6}, {**spine(-4, 0, -8), **hand(SPREAD, "r"), **hand(RELAXED, "l")}, {"r": Arm(flex=140, elbow=60, abd=36, inward=0.0), "l": Arm(flex=10, elbow=40, abd=16)}, gaze=(-12.0, 0.0))
    slap = P({"forward": 0.16, "up": -0.04, "flex": 2, "twist": 6}, {**spine(-6, 0, 10), **hand(SPREAD, "r"), **hand(RELAXED, "l"), "hand_r": (-20, 0, 0)}, {}, {"r": (0.0, -0.58, 2.0)}, {"r": (-0.6, 0.0, 1.8)}, gaze=(-24.0, 0.0, 0.6))
    thru = P({"forward": 0.14, "up": -0.08, "flex": 10, "twist": 8}, {**spine(6, 0, 10), **hand(FIST, "r"), **hand(RELAXED, "l")}, {"r": Arm(flex=40, elbow=70, abd=20, inward=0.3), "l": Arm(flex=0, elbow=40, abd=16)}, gaze=(0.0, 0.0))
    keys = [(0.0, EMPTY), (0.40, cock), (0.56, slap), (0.66, slap), (0.92, thru), (1.40, EMPTY), (T, EMPTY)]

    def pose(t):
        return with_feet(keyed(keys, t), steps, t, {"r": 12 * smoothstep(0.2, 0.5, t) * (1 - smoothstep(1.0, 1.3, t))})

    return cel_clip(name, T, pose, steps, events={"contact": round(0.58 * FPS)})


def cel_clips() -> list[Clip]:
    from .actions import mirrored

    five = high_five()
    return [
        spike(), spin_spike(), flip_official(), point_crowd(), leap_wall(), flex(), salute(), kneel(), ball_high_walk(), chest_bump(), jump_fist(), shrug(),
        mate_point(), five, mirrored(five, "cel_five_l"),
    ]


__all__ = ["cel_clips"]

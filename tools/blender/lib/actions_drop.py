"""The quarterback's drops and the hitch (passing round 2,
docs/passing/PASSING2.md). Keyed here like every clip (CLAUDE.md rule 6): no
downloaded, captured or third-party motion. Drops are technique clips (never
cut).

The M4/M5.5 drops (actions.py qb_drop, actions_m55.py qb_drop_uc) were one
backward walk per formation, the hips twisted 20-24 degrees at most, played at
their own pace while the sim backpedalled the QB at 55% of his top speed,
so the feet and the body rarely agreed, and there was no 7-step and no
hitch. These are keyed on the sim's own drop (src/sim/pocket.ts): the same
trapezoid of speed (DROP_A of the time building it, DROP_B braking into the
plant), the same depths and the same step counts, so the render plays each
at the rate that lands its plant on the sim's set and the feet stay where
they land.

Technique, from quarterback coaching (the 3-, 5- and 7-step drops of the
West Coast and Air Coryell schools; "eyes downfield, ball at the numbers"):

- Turned ("open", qb_drop_<kind>): the first step is the reach step with the
  right foot, the hips open to the throwing side (~35-50 degrees: the
  "45-degree drop") and he runs back, the
  shoulders a little less open than the hips; the head turned back over the
  left shoulder to the middle of the field, the ball held high in both hands
  at the numbers. (Coached as crossover steps; the left foot passes the right
  a stride's width apart here, the clearance gate's 7 cm and a believable
  run, since a true cross in front would put the ankles together.) The last step plants the right
  foot and brakes, the hips come back square to the line, the left foot
  settles. A 3-step is quick and short (the hips half open), a 5-step and a
  7-step are run (the hips all the way open).
- Pedalling ("pedal", qb_drop_<kind>_pedal): the shoulders square to the
  line, short quick steps straight back on the balls of the feet, the feet
  shoulder width and never crossing; slower to depth but the eyes have the
  whole field. The sim pedals a drop whose top speed is within his
  backpedal (pocket.ts dropPlan).
- From the gun the snap comes first (the hands to it, the ball to the
  chest), then the steps: a catch, a step back with the right foot and the
  left gathering under him (gun3: the quick game), three (gun5), five (gun7).
- The hitch (qb_hitch): off the plant, a step up with the front foot and the
  back foot gathering under him, ~0.64 m (the sim's 0.7 yd, pocket.ts
  HITCH_D) in 0.3 s, the ball still at the numbers, ready to throw.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import GRIP, HOLD_ELBOW, STANCES, Clip, mix, shift, with_upper
from .actions_m6 import rotate_pose
from .gait import FPS, smoothstep
from .poses import Foot
from .transitions import Plant, Steps

YD = 0.9144

# src/sim/pocket.ts DROP_A, DROP_B: the share of the drop building speed and braking into the plant.
DROP_A = 0.3
DROP_B = 0.2


def profile(u: float) -> float:
    """Share of the depth covered at u (0..1 of the drop's time): pocket.ts dropProfile."""
    t = min(1.0, max(0.0, u))
    a, b = DROP_A, DROP_B
    area = 1 - a / 2 - b / 2
    if t < a:
        p = t * t / (2 * a)
    elif t <= 1 - b:
        p = a / 2 + (t - a)
    else:
        r = 1 - t
        p = area - r * r / (2 * b)
    return p / area


# kind: start stance, when the steps start (s: under center the exchange,
# pocket.ts UC_EXCHANGE; from the gun the snap's flight, GUN_CATCH), the
# drop's time to the plant (s: the book's typical set less that), its depth
# (yd: the play's depth less where he lines up, plays.ts), steps, and how far
# the hips open on the turned drop (deg, + left).
DROPS = {
    "uc3": ("qb_center", 0.06, 0.89, 3.75, 3, -35.0),
    "uc5": ("qb_center", 0.06, 1.24, 5.75, 5, -45.0),
    "uc7": ("qb_center", 0.06, 1.59, 7.75, 7, -52.0),
    "gun3": ("qb_gun", 0.28, 0.32, 1.5, 2, -18.0),
    "gun5": ("qb_gun", 0.28, 0.77, 3.0, 3, -35.0),
    "gun7": ("qb_gun", 0.28, 1.02, 4.0, 5, -42.0),
}
# How long each foot is down per step (share of the step's time): a quick
# cadence with a flight between, so a planted foot never trails out of reach
# of the hip at the 5- and 7-step's pace (the hips pass ~0.35 m either side).
CONTACT = 0.5
CONTACT_LONG = 0.42
# Each foot this far (m) either side of the line of the drop, across the hips' own width as they turn (a running stride's track).
HALF_STANCE = 0.16
PEDAL_TURN = -8.0


def qb_drop(kind: str, style: str = "open") -> Clip:
    stance, ts, td, depth_yd, n, turn = DROPS[kind]
    if style == "pedal":
        turn = PEDAL_TURN
    D = depth_yd * YD
    # A whole frame past the plant: the clip ends standing (it hands over to the set stance at rest).
    T = math.ceil((ts + td) * FPS + 1e-6) / FPS + 1 / FPS
    start, qset = copy.deepcopy(STANCES[stance]), copy.deepcopy(STANCES["qb_set"])
    gun = stance == "qb_gun"

    def back(t: float) -> float:
        return D * profile((t - ts) / td) if t > ts else 0.0

    def travel(t):
        return (0.0, back(t))

    def theta(t: float) -> float:
        """The body's turn (deg): open over the first steps, square again into the plant."""
        u = (t - ts) / td
        return turn * smoothstep(-0.05, 0.28, u) * (1.0 - smoothstep(0.72, 1.0, u))

    # The footsteps, in the field. Equal cadence (the step's time), each
    # foot down for CONTACT of a step with the hips passing over it (a run's
    # flight between: a drop at this pace is a run backward); the last step
    # is the plant at the set spot and the other foot settles beside it.
    step = (td - 0.03) / n
    end = shift(qset, 0.0, D)
    plants = []
    plants.append(Plant("r", -1, ts + 0.01, start.feet["r"], roll=8.0))
    plants.append(Plant("l", -1, ts + 0.5 * step, start.feet["l"], roll=10.0))
    last = "r" if n % 2 == 1 else "l"
    for k in range(1, n + 1):
        side = "r" if k % 2 == 1 else "l"
        land = ts + step * k
        if k == n:
            plants.append(Plant(side, land, math.inf, replace(end.feet[side], heel=6.0)))
            break
        # (A long step at the pace, the 3-step's ~1.1 m, comes off the ground sooner so the hips don't leave the foot behind.)
        lift = land + step * (CONTACT_LONG if D / n > 1.0 else CONTACT)
        # Under the hips mid-contact: half the body's travel over the contact ahead of where they are at the landing.
        y = back(land) + 0.5 * (back(min(lift, ts + td)) - back(land)) + 0.04
        u = (land - ts) / td
        if style == "pedal":
            foot = Foot(0.19 if side == "l" else -0.19, y + (-0.05 if side == "l" else 0.03), heel=22, out=6)
        else:
            # Turned: each foot on its own side of the line of the drop (a stride's width, the hips over them), the toes turned with the hips.
            o = turn * smoothstep(-0.05, 0.28, u) * (1.0 - smoothstep(0.72, 1.0, u))
            sgn = 1.0 if side == "l" else -1.0
            a = math.radians(o)
            foot = Foot(sgn * HALF_STANCE * math.cos(a) - 0.02, y + sgn * HALF_STANCE * math.sin(a), heel=16, out=(6 + o * 0.8) if side == "l" else (14 - o * 0.8))
        plants.append(Plant(side, land, lift, foot, roll=10.0))
    # The other foot settles into the set.
    other = "l" if last == "r" else "r"
    plants.append(Plant(other, min(T - 0.01, ts + td + 0.04), math.inf, end.feet[other]))
    steps = Steps(plants, height=0.07)

    # The hands: to the snap (from the gun) or the exchange (under center), then the ball to the numbers.
    if gun:
        caught = with_upper(start, {s: (h[0] * 0.6, -0.30, 1.12) for s, h in start.hands.items()}, {**GRIP}, HOLD_ELBOW)
        t_catch, t_up = 0.24, 0.40
    else:
        caught = with_upper(start, {"l": (0.04, -0.28, 0.72), "r": (-0.03, -0.27, 0.74)}, {**GRIP}, {"l": (0.5, 0.2, 0.7), "r": (-0.5, 0.2, 0.7)})
        t_catch, t_up = 0.06, 0.30

    def pose(t):
        b = back(t)
        th = theta(t)
        base = mix(shift(start, 0.0, b), shift(qset, 0.0, b), smoothstep(0.05, max(0.3, ts + 0.35 * td), t))
        up = shift(qset, 0.0, b)
        if t < t_up:
            c = shift(caught, 0.0, b)
            src = mix(shift(start, 0.0, b), c, smoothstep(0.0, t_catch, t)) if t < t_catch else mix(c, up, smoothstep(t_catch, t_up, t))
            base.hands = src.hands
            base.elbow = {s: (e[0], e[1] + b, e[2]) for s, e in HOLD_ELBOW.items()}
            base.joints.update(GRIP if t > t_catch * 0.8 else {})
        else:
            base.hands = up.hands
            base.elbow = up.elbow
            base.joints.update(GRIP)
        # The body turned about its hips; the feet are the plan's.
        p = rotate_pose(base, th, base.pelvis.get("side", 0.0), 0.01 - base.pelvis.get("forward", 0.0))
        # The shoulders come back a third of the way (the chest less open than the hips), the head to the middle of the field.
        sh = -th * 0.32
        for bone in ("spine_03", "spine_04"):
            fl, ab, tw = p.joints.get(bone, (0.0, 0.0, 0.0))
            p.joints[bone] = (fl + (2.0 if style == "pedal" else 0.0), ab, tw + sh / 2)
        p.gaze = (3.0, -0.35 * (th + sh) - (th + sh) * 0.62, 0.6)
        # Pedalling: on the balls of the feet, the chest a little over the toes.
        if style == "pedal":
            p.pelvis["flex"] = p.pelvis.get("flex", 0.0) + 4.0 * smoothstep(ts, ts + 0.2, t)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    name = f"qb_drop_{kind}" + ("_pedal" if style == "pedal" else "")
    return Clip(name, "transition", T, pose, travel, f"stance_{stance}", "stance_qb_set", steps)


def qb_hitch() -> Clip:
    """Off the plant: the front foot steps up, the back foot gathers under him; ball at the numbers."""
    TH = 0.3  # the sim's hitch (play.ts HITCH)
    T = TH + 1 / FPS  # and a frame standing on it
    S = 0.7 * YD
    qset = copy.deepcopy(STANCES["qb_set"])

    def fwd(t):
        return S * profile(t / TH)

    def travel(t):
        return (0.0, -fwd(t))

    end = shift(qset, 0.0, -S)
    steps = Steps([
        Plant("l", -1, 0.02, qset.feet["l"], roll=8.0),
        Plant("l", 0.15, math.inf, end.feet["l"]),
        Plant("r", -1, 0.11, qset.feet["r"], roll=14.0),
        Plant("r", 0.27, math.inf, end.feet["r"]),
    ], height=0.05)

    def pose(t):
        p = shift(qset, 0.0, -fwd(t))
        # A little rise and settle through the step (the weight forward onto the front foot, then back to balance).
        p.pelvis["up"] = p.pelvis.get("up", 0.0) + 0.015 * math.sin(math.pi * min(1.0, t / TH))
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("qb_hitch", "transition", T, pose, travel, "stance_qb_set", "stance_qb_set", steps)


def drop_clips() -> list[Clip]:
    out = [qb_drop(k, "open") for k in DROPS]
    out += [qb_drop(k, "pedal") for k in ("uc3", "gun5", "gun7")]
    out.append(qb_hitch())
    return out

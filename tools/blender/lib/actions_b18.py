"""Animation round 18 (docs/anim/BREAK18.md): the defense breaking on the
ball. Keyed here with our own keyer (gait.py, transitions.py Steps,
CLAUDE.md rule 6); no captured or third-party motion. The breaks are
technique clips (CLAUDE.md rule 6: never cut).

Round 17 handed the pedal over to the run on the planted foot
(animator.ts breakOut) and tried the same procedurally out of the shuffle;
the shuffle version added linebacker steps on every play it was measured
on, and its conclusion was that the break needs keyed clips. Round 16's
shuffle into the run was one long blended stride.

The breaks, from coaching descriptions (defensive back and linebacker
drills: "plant and drive", the W-step break, "trigger", the "plant and go"
out of the shuffle):
- W-step (plant and drive out of the backpedal, on a ball thrown in front
  of him: the curl, the comeback, the hitch, a check-down): the last pedal
  step reaches back and plants, the other foot comes down wide beside it
  (the feet a little wider than the shoulders, a "W": both knees bent, the
  shins angled forward), the hips sink and the chest comes over the knees,
  the hands rip back to the hips, then he drives off both feet, the first
  step short and quick, the arms pumping, low out of the plant, into the run.
  The stop takes ~0.2 s from a quick pedal; the drive reaches a jog's
  speed in ~0.45 s (the sim's cut deceleration, 9-15 yd/s^2, and its burst).
- Plant and go out of the shuffle (a linebacker's trigger downhill on the
  run or the check-down, a corner's break from off coverage): the lead
  foot plants a little wider and turned out toward the break, the hips
  open toward it, the trail leg crosses over in front, and he drives
  downhill, the shoulders kept square to the ball as long as he can.

Both start from the loop he is in at the plant foot's touch-down (the
pedal's, the shuffle's: from_phase) and end in the jog at its left
touch-down, so the game hands over to the run without a pop
(src/anim/animator.ts, the break: breakClip). The game paces them by the
sim: each frame the clip's time is the one at which its travel matches
the ground the sim has covered since the plant (its rate is the sim's
speed over the keyed one, so a man who stops and drives quicker breaks
quicker).
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import FIST, Clip, keyed, mirrored, mix, shift
from .actions_m6 import rotate_pose
from .actions_m6_back7 import BP, JOG, SHUFFLE, foot_on_path
from .gait import FPS, gait_pose, smoothstep
from .poses import Arm
from .transitions import Plant, Steps, _hermite

# --- The W-step: plant and drive out of the backpedal --------------------------------

# The pedal's speed at the plant foot's touch-down (m/s): between the slow pedal (1.5,
# actions_a16.py) and the pedal (3.2, gait.py), where the sim's breaks start their stop
# (tools/sim/b18_breaks.ts: 0.9-4.7 m/s, most 1-3).
W_V0 = 2.0
# The stop (s): from W_V0 to rest at a constant 10 m/s^2 (the sim's cut deceleration
# for a 76-agility back, sim/effects.ts cutAccel 9 + 16/39*6 = 11.5 yd/s^2).
W_STOP = 6 / FPS
W_BACK = W_V0 * W_STOP / 2
# The drive (s, m): from rest to the jog's 3.5 m/s at a near-constant 7.6 m/s^2, the
# distance a constant acceleration covers (the sim's burst: (vmax - v)/tau from ~15
# at rest to ~9 m/s^2 at 3.5 m/s for a back, sim/movement.ts).
W_DRIVE_T = 14 / FPS
W_DRIVE = 0.8
W_T = W_STOP + W_DRIVE_T
W_END = JOG.speed


def w_y(t: float) -> float:
    """The body along the field (+ back): the stop over the plant, then the drive."""
    if t < W_STOP:
        return W_V0 * t - 0.5 * (W_V0 / W_STOP) * t * t
    return _hermite(W_BACK, W_BACK - W_DRIVE, 0.0, -W_END, W_DRIVE_T, min(t - W_STOP, W_DRIVE_T))


# The arms: ripped back to the hips at the plant (loaded), then pumping into the drive.
RIP = Arm(flex=-30, elbow=96, abd=16, inward=0.08)
PUMP_FWD = Arm(flex=52, elbow=84, abd=12, inward=0.16)
PUMP_BACK = Arm(flex=-38, elbow=92, abd=14, inward=0.05)


def db_break_w_left() -> Clip:
    """The W-step out of the backpedal, the left foot the plant: from the pedal's
    left touch-down (the left reaching back, the right lifting), the right comes
    down wide beside it (0.12 s), the hips sink over the W and stop (0.2 s), the
    right takes the short first drive step (0.26-0.40), the left drives through
    (0.36-0.66) and lands as the jog's left touch-down."""
    T = W_T
    bp0 = gait_pose(BP, 0)
    end = shift(gait_pose(JOG, 0), 0.0, w_y(T))

    def travel(t):
        return (0.0, w_y(t))

    def at(s, t, lateral, ahead, heel):
        return foot_on_path(s, 0.0, w_y(t), 0.0, lateral=lateral, ahead=ahead, heel=heel, out=6.0)

    steps = Steps([
        # The plant: reached back 0.30 m behind the hips (the pedal's touch-down is 0.32), on the ball, the heel
        # coming down as he sinks over it and up again as he pushes off it.
        Plant("l", -1, 0.36, at("l", 0.0, 0.17, -0.30, 14.0), roll=22.0),
        Plant("l", T, math.inf, end.feet["l"]),
        # The W: the right comes down wide and a little ahead of the hips, then the short first drive step.
        Plant("r", 0.12, 0.26, at("r", 0.12, 0.27, 0.06, 12.0), roll=20.0),
        Plant("r", 0.40, 0.54, at("r", 0.40, 0.12, 0.22, 10.0), roll=30.0),
        Plant("r", T, math.inf, end.feet["r"], contact=False),
    ], before={"r": lambda t: shift(gait_pose(BP, t * FPS), 0.0, w_y(t)).feet["r"]}, height=0.08)

    plant = copy.deepcopy(bp0)
    # Sunk over the W: the hips 9 cm under the pedal's, the chest over the knees (the pedal's 28 deg lean, the keyer's
    # pelvis share 0.65 of it, plus 14), the pelvis square.
    plant.pelvis.update({"up": -0.26, "flex": 32, "twist": 0.0, "side": 0.0, "lateral": 0.0})
    plant.arms = {"l": RIP, "r": RIP}
    plant.joints.update({"spine_02": (9, 0, 0), "spine_03": (5, 0, 0), **FIST})
    drive = copy.deepcopy(gait_pose(JOG, 0))
    # Low out of the plant: the jog's trunk pitched further (the drive phase's lean), the hips still sunk.
    drive.pelvis.update({"up": -0.17, "flex": 22})
    # The right leg forward (the first drive step): the left arm forward.
    drive.arms = {"l": PUMP_FWD, "r": PUMP_BACK}
    keys = [(0.0, bp0), (0.14, plant), (0.24, plant), (0.42, drive), (T, gait_pose(JOG, 0))]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, w_y(t))
        # Eyes level on the ball (the game's look-at turns the head to it).
        p.gaze = (4.0, 0.0)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("db_break_w_l", "transition", T, pose, travel, "loco_backpedal", "loco_jog", steps, events={"plant": round(W_STOP * FPS)}, from_phase=0.0)


# --- Plant and go out of the shuffle --------------------------------------------------

# The break's line (deg, + toward the lead side, off his facing): downhill and a little to
# the side he was going (the sim's breaks out of a shuffle come out 0-50 deg off the facing,
# b18_breaks.ts; most toward the lead side).
G_ANGLE = 25.0
# The hips open to it by the break's own angle (the chest kept square to the ball: the
# gait's hip turn, animator.ts warpHips, takes over at the hand-over).
G_V0 = SHUFFLE.speed
G_T = 17 / FPS
G_END = JOG.speed


def g_path(t: float) -> tuple[float, float]:
    """The body (x left, y back): the shuffle's sideways speed easing to the drive's share of
    it, the forward speed from rest to the drive's, both as Hermites ending on the jog at the
    break's line."""
    a = math.radians(G_ANGLE)
    vx1 = G_END * math.sin(a)
    vy1 = -G_END * math.cos(a)
    tt = min(t, G_T)
    # Sideways: from the shuffle's 2.0 m/s to the drive's 1.48 (the lead foot's plant takes a little off it).
    x = _hermite(0.0, (G_V0 + vx1) / 2 * G_T, G_V0, vx1, G_T, tt)
    # Forward: from rest, near-constant acceleration (as the W-step's drive).
    y = _hermite(0.0, vy1 * G_T / 2, 0.0, vy1, G_T, tt)
    return x, y


def lb_break_left() -> Clip:
    """Out of the shuffle to his left, the lead (left) foot the plant: it lands wide and
    turned out toward the break, the hips open to it, the trail (right) leg crosses over in
    front (0.03-0.24 s), the left drives through and lands as the jog's left touch-down,
    the legs on the break's line and the chest square to the ball."""
    T = G_T
    sh0 = gait_pose(SHUFFLE, 0)

    def travel(t):
        return g_path(t)

    def hips(t):
        return G_ANGLE * smoothstep(0.02, 0.3, t)

    def at(s, t, lateral, ahead, heel, out=6.0):
        x, y = g_path(t)
        return foot_on_path(s, x, y, hips(t), lateral=lateral, ahead=ahead, heel=heel, out=out)

    x1, y1 = g_path(T)
    jog = rotate_pose(gait_pose(JOG, 0), G_ANGLE)
    end = shift(jog, x1, y1)
    lead = sh0.feet["l"]
    steps = Steps([
        # The lead foot's plant: the shuffle's touch-down (0.49 m out), turned out to the break.
        Plant("l", -1, 0.30, replace(lead, out=lead.out + 18.0, heel=12.0), roll=26.0),
        Plant("l", T, math.inf, end.feet["l"]),
        # The trail foot: the shuffle's, lifting as the lead lands; then the crossover in front onto the break's line.
        Plant("r", -1, 0.03, sh0.feet["r"], roll=16.0),
        Plant("r", 0.24, 0.46, at("r", 0.24, -0.02, 0.24, 10.0), roll=30.0),
        Plant("r", T, math.inf, end.feet["r"], contact=False),
    ], height=0.09)

    load = copy.deepcopy(sh0)
    # The hips sink a little more into the plant and open to the break; the hands come off the shuffle's ready to rip.
    load.pelvis.update({"up": -0.24, "flex": 24})
    load.arms = {"l": RIP, "r": Arm(flex=30, elbow=88, abd=14, inward=0.25)}
    load.joints.update(FIST)
    cross = copy.deepcopy(gait_pose(JOG, 0))
    cross.pelvis.update({"up": -0.17, "flex": 20})
    # The right leg crossing over in front: the left arm drives forward.
    cross.arms = {"l": PUMP_FWD, "r": PUMP_BACK}
    keys = [(0.0, sh0), (0.12, load), (0.3, cross), (T, gait_pose(JOG, 0))]

    def pose(t):
        x, y = g_path(t)
        base = keyed(keys, t)
        h = hips(t)
        p = shift(rotate_pose(base, h), x, y)
        # The chest kept square to the ball: the spine turns back what the hips opened (WARP_TWIST's shares, most in the
        # thorax), the head level downfield (the game's look-at puts it on the ball).
        for b, k in (("spine_01", 0.2), ("spine_02", 0.3), ("spine_03", 0.3), ("spine_04", 0.2)):
            fl, ab, tw = p.joints.get(b, (0.0, 0.0, 0.0))
            p.joints[b] = (fl, ab, tw - h * k * TWIST_SIGN)
        p.gaze = (4.0, 0.0)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("lb_break_l", "transition", T, pose, travel, "lb_shuffle_l", "loco_jog", steps, events={"plant": 0}, main_dir=[0.0, -1.0], from_phase=0.0)


# The spine's twist that turns the chest left (+1) or right (-1) for a positive joint twist
# (poses.set_joint): checked against the rig in tools/blender (BREAK18.md).
TWIST_SIGN = 1.0


def b18_clips() -> list[Clip]:
    w = db_break_w_left()
    g = lb_break_left()
    # The right-foot twins: the plant on the right (the pedal's right touch-down, its phase 0.5), the shuffle to the right
    # (its lead foot the right, landing half a cycle on in the game's side phase); both hand over at the jog's right
    # touch-down (phase 0.5).
    gr = mirrored(g, "lb_break_r", to_phase=0.5)
    gr.frm = "lb_shuffle_r"
    return [w, mirrored(w, "db_break_w_r", to_phase=0.5), g, gr]


__all__ = ["b18_clips", "W_V0", "W_STOP", "W_T", "G_ANGLE", "G_T"]

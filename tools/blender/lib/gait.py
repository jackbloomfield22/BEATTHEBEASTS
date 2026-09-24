"""Locomotion keyed from gait parameters (our own keyer; no captured or
third-party motion). Each frame of a cycle becomes a Pose (poses.py).

The keyer moves the whole body, not just the feet. Numbers come from the
running and sprinting literature for a ~1.9 m athlete: Novacheck (1998),
"The biomechanics of running"; Schache et al. (2002), "Three-dimensional
kinematics of the lumbar spine and pelvis during running"; Mann's sprint
mechanics (arm action "cheek to back pocket", knee drive near horizontal
at top speed); walking norms from Perry & Burnfield, "Gait Analysis".

- Feet: while planted, the contact point rides backward at exactly the
  clip's speed, so a player moved at that speed plants without sliding.
  The foot rolls: walkers strike heel-first with the toes up and roll to the
  ball; joggers land on the midfoot; sprinters stay on the forefoot. It
  pivots on the heel while the toes are up and on the ball after.
- Swing leg: shaped by the hip and knee (poses.Foot.fk): the heel comes up
  behind (heel recovery), the knee drives forward and up, higher the faster
  the gait, then the leg reaches and pulls back into the next contact. The
  shape blends into a Hermite path near lift-off and touch-down that matches
  the stance's position and velocity, so the foot never jerks.
- Pelvis: drops a little on the swing side (the stance hip holds it), shifts
  over the stance foot, turns with the swing leg, and rides a spring: runners
  are lowest at mid-stance, walkers highest (they vault over the leg).
- Trunk: the thorax counter-rotates against the pelvis, spread up the spine;
  the lean grows with speed; the head holds a level world gaze.
- Arms: swing from the shoulder in the thorax frame, elbows held near 90
  degrees (a little tighter in front, more open behind), opposite the legs.

Contact share, how far ahead of the hip the foot lands and pelvis height were
searched against the rig's leg reach so every planted frame is reachable (the
foot-slide gate). Frame counts make each cycle a whole number of frames at
30 fps, so the loop is exact.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .poses import ARMS_DOWN, HAND_STATES, Arm, Foot, Pose

FPS = 30


@dataclass
class Gait:
    name: str
    frames: int  # frames per cycle (two steps)
    speed: float  # m/s along `dir`
    duty: float  # fraction of the cycle each foot is on the ground
    width: float  # half the distance between the feet (m)
    pelvis_up: float  # mean pelvis offset (m, negative = knees bent)
    # Pelvis and trunk.
    bob: float  # pelvis vertical half-amplitude (m)
    sway: float  # pelvis shift over the stance foot (m)
    drop: float  # pelvic obliquity: swing-side hip drop (deg)
    turn: float  # pelvis yaw amplitude (deg), swing hip forward
    counter: float  # thorax yaw amplitude opposite the pelvis (deg, world)
    lean: float  # trunk forward lean (deg)
    # Arms (thorax frame).
    arm_c: float  # mean shoulder flexion (deg)
    arm_a: float  # shoulder swing amplitude (deg)
    elbow: float  # mean elbow flexion (deg)
    elbow_d: float  # elbow closes by this in front, opens by it behind (deg)
    arm_abd: float = 10.0
    inward: float = 0.22
    clavicle: float = 0.0  # shoulder protraction at the front of the swing (deg)
    hand: str = "fist"
    # Swing leg.
    hip_max: float = 45.0  # peak thigh flexion from vertical (knee drive, deg)
    hip_ext: float = -15.0  # thigh extension at toe-off (deg)
    knee_max: float = 95.0  # peak knee flexion in swing (heel recovery, deg)
    retract: float = 6.0  # thigh pulled back before contact (deg)
    fk: float = 1.0  # how much the hip/knee shape drives the swing
    lift: float = 0.2  # Hermite base path peak lift (m)
    # Foot roll.
    strike: float = 0.0  # foot angle at touch-down (deg; negative = toes up, heel strike)
    flat_by: float = 0.12  # share of stance by which the foot is flat (or on its forefoot)
    heel_mid: float = 0.0  # heel raise through mid-stance (forefoot runners)
    rise_at: float = 0.5  # share of stance when the heel starts to rise
    toe_off: float = 50.0  # heel raise at lift-off (deg)
    dorsi: float = 10.0  # toes pulled up in late swing (deg)
    gaze: float = 5.0  # eyes below level (deg)
    dir: tuple = (0.0, -1.0)  # direction of travel in the field plane (Blender x, y); -y is forward
    ahead: float = 0.4  # share of the ground contact ahead of the hip at touch-down
    extra: dict = field(default_factory=dict)  # joints held through the cycle

    @property
    def period(self) -> float:
        return self.frames / FPS


def _hermite(p0, p1, m0, m1, s):
    s2, s3 = s * s, s * s * s
    return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1


def smoothstep(a: float, b: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def stance_heel(g: Gait, s: float) -> float:
    """Foot angle through stance: strike, roll flat (or onto the forefoot), heel rise, toe-off."""
    if s < g.flat_by:
        return g.strike + (g.heel_mid - g.strike) * smoothstep(0, g.flat_by, s)
    if s < g.rise_at:
        return g.heel_mid
    return g.heel_mid + (g.toe_off - g.heel_mid) * ((s - g.rise_at) / (1 - g.rise_at)) ** 1.6


def swing_heel(g: Gait, s: float) -> float:
    """Foot angle through swing: plantarflexed off the ground, toes pulled up, set for contact."""
    a = g.toe_off + (-g.dorsi - g.toe_off) * smoothstep(0.0, 0.55, s)
    return a + (g.strike - (-g.dorsi)) * smoothstep(0.7, 1.0, s)


def swing_leg(g: Gait, s: float) -> tuple[float, float]:
    """(thigh flexion, knee flexion) through swing: heel recovery, knee drive, reach, pull-back."""
    alpha = g.hip_ext + (g.hip_max - g.hip_ext) * smoothstep(0.0, 0.72, s) - g.retract * smoothstep(0.72, 1.0, s)
    k0, k_end = 30.0, 14.0
    kappa = k0 + (g.knee_max - k0) * smoothstep(0.0, 0.38, s)
    kappa += (k_end - g.knee_max) * smoothstep(0.38, 0.9, s)
    return alpha, kappa


def foot_track(g: Gait, phase: float):
    """(along, lift, heel, fk) for one foot at phase 0..1 (0 = touch-down)."""
    T = g.period
    contact = g.speed * g.duty * T  # ground covered while planted
    if phase < g.duty:
        s = phase / g.duty
        return contact * (g.ahead - s), 0.0, stance_heel(g, s), None
    s = (phase - g.duty) / (1 - g.duty)
    m = -g.speed * (1 - g.duty) * T  # d(along)/ds at both ends = stance velocity
    along = _hermite(-contact * (1 - g.ahead), contact * g.ahead, m, m, s)
    lift = g.lift * math.sin(math.pi * min(1.0, s ** 0.8)) ** 1.3
    w = g.fk * smoothstep(0.0, 0.2, s) * (1 - smoothstep(0.8, 1.0, s))
    alpha, kappa = swing_leg(g, s)
    return along, lift, swing_heel(g, s), (alpha, kappa, w) if w > 0 else None


def gait_pose(g: Gait, frame: int) -> Pose:
    t = frame / g.frames
    dx, dy = g.dir
    feet = {}
    for s, ph in (("l", t % 1.0), ("r", (t + 0.5) % 1.0)):
        along, lift, heel, fk = foot_track(g, ph)
        # Each foot tracks under its own hip (left is +x whatever the travel
        # direction); the ball sits ~11 cm ahead of the ankle's rest line.
        feet[s] = Foot(x=g.width * (1 if s == "l" else -1) + along * dx, y=-0.11 + along * dy, heel=heel, out=4.0, lift=lift, fk=fk)

    runner = g.duty < 0.5
    tm = t - g.duty / 2  # 0 at the left foot's mid-stance
    step = math.cos(2 * math.pi * 2 * tm)  # +1 at each mid-stance
    stride = math.cos(2 * math.pi * tm)  # +1 at left mid-stance, -1 at right
    legs = math.cos(2 * math.pi * t)  # +1 when the left leg is forward (left touch-down)
    pelvis = {
        # Runners compress through mid-stance (the leg as a spring); walkers vault over it.
        "up": g.pelvis_up + (-g.bob if runner else g.bob) * step,
        "side": g.sway * stride,  # over the stance foot (left is +x)
        "lateral": g.drop * stride,  # stance-side hip up, swing side drops
        "twist": -g.turn * legs,  # negative turns the left hip forward
        "flex": g.lean * 0.65 + 1.5 * step,
    }
    # The thorax turns the other way: spine twist = thorax - pelvis, spread up the spine.
    rel = (g.counter + g.turn) * legs
    joints = {
        **ARMS_DOWN,
        "spine_01": (g.lean * 0.05, -g.drop * 0.35 * stride, rel * 0.15),
        "spine_02": (g.lean * 0.15 + 0.8 * step, -g.drop * 0.35 * stride, rel * 0.25),
        "spine_03": (g.lean * 0.15, -g.drop * 0.2 * stride, rel * 0.30),
        "spine_04": (0.0, 0.0, rel * 0.30),
        **HAND_STATES[g.hand],
        **g.extra,
    }
    arms = {}
    lag = 0.03  # the arm swing trails the legs a touch
    for s, sg in (("l", -1.0), ("r", 1.0)):
        u = sg * math.cos(2 * math.pi * (t - lag))  # +1 at the front of this arm's swing
        arms[s] = Arm(
            flex=g.arm_c + g.arm_a * u,
            elbow=g.elbow + g.elbow_d * u,
            abd=g.arm_abd,
            inward=g.inward * (0.5 + 0.5 * max(0.0, u)),
            clavicle=g.clavicle * u,
        )
    return Pose(pelvis=pelvis, joints=joints, feet=feet, arms=arms, gaze=(g.gaze + g.lean * 0.2, 0.0))


def contacts(g: Gait) -> dict:
    """Frames each foot is planted, as [start, end) ranges within the cycle."""
    out = {}
    for s, off in (("l", 0.0), ("r", 0.5)):
        frames = [f for f in range(g.frames) if ((f / g.frames + off) % 1.0) < g.duty]
        # Group into contiguous (wrapping) runs.
        runs, cur = [], []
        for f in frames:
            if cur and f != cur[-1] + 1:
                runs.append(cur)
                cur = []
            cur.append(f)
        if cur:
            runs.append(cur)
        if len(runs) > 1 and runs[0][0] == 0 and runs[-1][-1] == g.frames - 1:
            runs[0] = runs[-1] + runs[0]
            runs.pop()
        out[s] = [[r[0], r[-1] + 1] for r in runs]
    return out


GAITS = {
    # Walking (Perry & Burnfield): heel strike toes-up ~15-20 deg, pelvis
    # rises over the stance leg (~4 cm), rotates ~±5 deg, drops ~±4 deg;
    # arms hang and swing ~30 deg in all.
    "walk": Gait(
        "walk", frames=32, speed=1.3, duty=0.62, width=0.10, pelvis_up=-0.06, bob=0.016, sway=0.022, drop=4, turn=5, counter=5, lean=4,
        arm_c=-2, arm_a=15, elbow=24, elbow_d=8, arm_abd=6, inward=0.05, hand="relaxed",
        hip_max=26, hip_ext=-12, knee_max=62, retract=4, lift=0.09, fk=0.8,
        strike=-16, flat_by=0.16, heel_mid=0, rise_at=0.6, toe_off=45, dorsi=10, gaze=4, ahead=0.4,
    ),
    # Jogging ~3.5 m/s (Novacheck): midfoot/heel contact, ~8 cm of vertical
    # oscillation, knee ~95 deg in swing, hip ~45 deg, trunk lean ~6-8 deg,
    # elbows ~90 with the hands at the waist to the chest.
    "jog": Gait(
        "jog", frames=22, speed=3.5, duty=0.36, width=0.085, pelvis_up=-0.068, bob=0.034, sway=0.014, drop=6, turn=8, counter=9, lean=9,
        arm_c=4, arm_a=30, elbow=88, elbow_d=10, arm_abd=12, inward=0.08, hand="fist",
        hip_max=48, hip_ext=-15, knee_max=98, retract=6, lift=0.20,
        strike=-6, flat_by=0.12, heel_mid=0, rise_at=0.5, toe_off=50, dorsi=10, gaze=5, ahead=0.34,
    ),
    # Running ~5.8 m/s: forefoot/midfoot contact, knee drive ~65 deg, heel
    # recovery ~115 deg, lean ~10 deg, pelvis ±10 deg, thorax ±10 counter.
    "run": Gait(
        "run", frames=20, speed=5.8, duty=0.24, width=0.075, pelvis_up=-0.08, bob=0.033, sway=0.012, drop=7, turn=10, counter=11, lean=13,
        arm_c=5, arm_a=46, elbow=88, elbow_d=14, arm_abd=12, inward=0.08, clavicle=4, hand="fist",
        hip_max=66, hip_ext=-18, knee_max=116, retract=8, lift=0.32,
        strike=3, flat_by=0.1, heel_mid=2, rise_at=0.45, toe_off=58, dorsi=12, gaze=6, ahead=0.4,
    ),
    # Sprinting ~8.5 m/s (Mann): on the forefoot throughout, thigh near
    # horizontal (~80 deg), heel to the buttock (~128 deg), lean ~14 deg,
    # hands from cheek height to the back pocket, elbows near 90.
    "sprint": Gait(
        "sprint", frames=14, speed=8.5, duty=0.22, width=0.065, pelvis_up=-0.07, bob=0.026, sway=0.01, drop=7, turn=12, counter=13, lean=17.5,
        arm_c=4, arm_a=62, elbow=90, elbow_d=16, arm_abd=10, inward=0.06, clavicle=6, hand="fist",
        hip_max=80, hip_ext=-20, knee_max=128, retract=10, lift=0.42,
        strike=12, flat_by=0.1, heel_mid=12, rise_at=0.4, toe_off=60, dorsi=14, gaze=6, ahead=0.35,
    ),
    # Defensive back backpedal (technique clip, never cut): hips low, chest
    # over the toes, short quick steps on the balls of the feet, arms pumping
    # close to the body, eyes on the quarterback. The feet reach back, so the
    # forward-swing shaping is off.
    "backpedal": Gait(
        "backpedal", frames=16, speed=3.2, duty=0.5, width=0.14, pelvis_up=-0.17, bob=0.012, sway=0.01, drop=3, turn=3, counter=3, lean=28,
        arm_c=14, arm_a=16, elbow=92, elbow_d=6, arm_abd=12, inward=0.15, hand="relaxed",
        hip_max=40, hip_ext=-10, knee_max=70, retract=0, fk=0.0, lift=0.07,
        strike=22, flat_by=0.1, heel_mid=22, rise_at=0.5, toe_off=26, dorsi=0, gaze=-6, dir=(0.0, 1.0), ahead=0.5,
    ),
}

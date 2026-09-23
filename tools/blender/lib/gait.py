"""Locomotion keyed from gait parameters (our own keyer; no captured or
third-party motion). Each frame of a cycle becomes a Pose (poses.py).

In-place cycles: the root stays put and the runtime moves the player. During
each foot's stance its ball moves backward at exactly the clip's speed, so a
player moved at that speed plants without sliding; the swing follows a cubic
Hermite curve whose end velocities match the stance, so the foot never
jerks at lift-off or touch-down.

Gait numbers start from sports-biomechanics norms for a ~1.9 m athlete
(walking ~1.3-1.5 m/s at ~1.9 steps/s with ~60% ground contact; jogging
~3.5 m/s at ~2.7 steps/s; running ~6 m/s at ~3 steps/s; top-speed
sprinting ~8.5 m/s at ~4.3 steps/s with ~0.1 s contacts; football players
top out around 9-10 m/s). Contact share, how far ahead of the hip the foot
lands, pelvis height and toe-off were then searched against the rig's leg
reach so every planted frame is reachable (the foot-slide gate): a planted
foot can only cover what the leg spans. Frame counts make each cycle a
whole number of frames at 30 fps (so the loop is exact).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .poses import ARMS_DOWN, LOOSE_FIST, OPEN, Foot, Pose

FPS = 30


@dataclass
class Gait:
    name: str
    frames: int  # frames per cycle (two steps)
    speed: float  # m/s along `dir`
    duty: float  # fraction of the cycle each foot is on the ground
    lift: float  # peak ball height in swing (m)
    width: float  # half the distance between the feet (m)
    pelvis_up: float  # mean pelvis offset (m, negative = knees bent)
    bob: float  # pelvis vertical amplitude (m)
    lean: float  # trunk forward lean (deg)
    pelvis_turn: float  # pelvis yaw amplitude (deg)
    arm_swing: float  # shoulder flex amplitude (deg)
    elbow: float  # mean elbow flex (deg)
    heel_run: float = 0.0  # heel raise through stance for forefoot runners (deg)
    toe_off: float = 30.0  # heel raise at lift-off (deg)
    dir: tuple = (0.0, -1.0)  # direction of travel in the field plane (Blender x, y); -y is forward
    ahead: float = 0.5  # share of the ground contact ahead of the hip at touch-down (runners land under the hip, push off behind)
    crossover: bool = True  # feet pass each other (walk/run) vs. never cross (shuffle)
    extra: dict = field(default_factory=dict)  # joints held through the cycle

    @property
    def period(self) -> float:
        return self.frames / FPS


def _hermite(p0, p1, m0, m1, s):
    s2, s3 = s * s, s * s * s
    return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1


def foot_track(g: Gait, phase: float):
    """(along, lift, heel) for one foot at phase 0..1 (0 = touch-down)."""
    T = g.period
    contact = g.speed * g.duty * T  # ground covered while planted
    if phase < g.duty:
        s = phase / g.duty
        along = contact * (g.ahead - s)  # rides backward at exactly -speed
        # Heel: walkers land flat and roll up at the end; runners stay on the
        # forefoot and toe off hard.
        heel = g.heel_run + (g.toe_off - g.heel_run) * max(0.0, (s - 0.55) / 0.45) ** 2
        return along, 0.0, heel
    s = (phase - g.duty) / (1 - g.duty)
    m = -g.speed * (1 - g.duty) * T  # d(along)/ds at both ends = stance velocity
    along = _hermite(-contact * (1 - g.ahead), contact * g.ahead, m, m, s)
    # Lift peaks early (the heel comes up behind), then the leg reaches forward.
    lift = g.lift * math.sin(math.pi * min(1.0, s ** 0.8)) ** 1.3
    heel = g.toe_off * (1 - s) ** 1.5 + g.heel_run * s
    return along, lift, heel


def gait_pose(g: Gait, frame: int) -> Pose:
    t = frame / g.frames
    dx, dy = g.dir
    feet = {}
    phases = {"l": t % 1.0, "r": (t + 0.5) % 1.0}
    for s, ph in phases.items():
        along, lift, heel = foot_track(g, ph)
        # Each foot tracks under its own hip (left is +x whatever the travel
        # direction); the ball sits ~11 cm ahead of the ankle's rest line.
        feet[s] = Foot(
            x=g.width * (1 if s == "l" else -1) + along * dx,
            y=-0.11 + along * dy,
            heel=heel,
            out=4.0,
            lift=lift,
        )
    # Pelvis: walkers are highest over the stance leg (vaulting); runners are
    # lowest at mid-stance (the leg as a spring).
    w = 2 * math.pi * 2 * t  # twice per cycle, once per step
    mid_stance = math.cos(w - 2 * math.pi * g.duty)
    up = g.pelvis_up + (g.bob if g.duty > 0.5 else -g.bob) * 0.5 * (1 + mid_stance)
    swing = math.sin(2 * math.pi * t)  # +1 when the left leg is forward
    pelvis = {"up": up, "flex": g.lean * 0.6, "twist": -g.pelvis_turn * swing, "lateral": 2.0 * math.cos(w)}
    arm = g.arm_swing * swing
    joints = {
        **ARMS_DOWN,
        "spine_02": (g.lean * 0.2, 0, 0),
        "spine_03": (g.lean * 0.2, 0, g.pelvis_turn * swing * 1.3),  # shoulders counter the hips
        "neck_01": (-g.lean * 0.6, 0, -g.pelvis_turn * swing * 0.6),  # eyes stay level and forward
        # Arms swing opposite the legs: right arm forward with the left leg.
        "upperarm_l": (6 - arm, -38, 0),
        "upperarm_r": (6 + arm, -38, 0),
        "forearm_l": (g.elbow + 0.25 * g.arm_swing * max(0.0, -swing), 0, 0),
        "forearm_r": (g.elbow + 0.25 * g.arm_swing * max(0.0, swing), 0, 0),
        # Relaxed open hands walking; a loose fist once running (open, flat
        # hands swinging at speed read as palms held up).
        **(LOOSE_FIST if g.speed > 2 else OPEN),
        **g.extra,
    }
    return Pose(pelvis=pelvis, joints=joints, feet=feet)


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
    "walk": Gait("walk", frames=32, speed=1.3, duty=0.62, lift=0.09, width=0.10, pelvis_up=-0.06, bob=0.018, lean=3, pelvis_turn=5, arm_swing=18, elbow=18, heel_run=0, toe_off=45, ahead=0.4),
    "jog": Gait("jog", frames=22, speed=3.5, duty=0.36, lift=0.20, width=0.085, pelvis_up=-0.05, bob=0.035, lean=7, pelvis_turn=7, arm_swing=30, elbow=75, heel_run=6, toe_off=50, ahead=0.4),
    "run": Gait("run", frames=20, speed=5.8, duty=0.24, lift=0.32, width=0.075, pelvis_up=-0.08, bob=0.04, lean=11, pelvis_turn=8, arm_swing=38, elbow=85, heel_run=10, toe_off=58, ahead=0.4),
    "sprint": Gait("sprint", frames=14, speed=8.5, duty=0.22, lift=0.42, width=0.065, pelvis_up=-0.07, bob=0.04, lean=15, pelvis_turn=9, arm_swing=46, elbow=88, heel_run=16, toe_off=60, ahead=0.35),
    # Defensive back backpedal (technique clip, never cut): hips low, chest
    # over the toes, short quick steps on the balls of the feet.
    "backpedal": Gait(
        "backpedal", frames=16, speed=3.2, duty=0.5, lift=0.07, width=0.14, pelvis_up=-0.17, bob=0.012, lean=28, pelvis_turn=3,
        arm_swing=14, elbow=75, heel_run=22, toe_off=26, dir=(0.0, 1.0),
        extra={"spine_02": (8, 0, 0), "neck_01": (-24, 0, 0), "head": (-8, 0, 0)},
    ),
}

"""M6 line play: the offensive line's pass sets, blocks and pulls, and the
defensive line's pass-rush moves, hand fighting and shed. Keyed here
(CLAUDE.md rule 6). The kick-slide and the pass-rush moves are technique
clips (never cut).

Stances are the existing right-hand-down three-points (poses.py); a clip
named _l or _r moves to the player's left or right.

Timings and shapes, from coaching descriptions:
- Pass set (kick-slide): the hand comes off the turf first; the outside
  foot kicks back and out (the "kick", ~0.4 m), the inside foot slides the
  same distance to keep the base (never cross, never click the heels),
  three times in ~0.9 s for ~1.2 m of depth. Knees bent, butt down,
  chest up, hands up and in, eyes on the rusher's near number.
- Anchor (a bull rush): sink the hips, lock the arms out into the chest,
  short choppy steps back to regain the base, then drop anchor.
- Punch and mirror: both hands shoot inside to the chest plate (~0.1 s),
  then slide with the rusher, the hands staying on him, the base wide.
- Run block (drive): fire out off the snap, first step ~0.2-0.25 s, the
  hands strike inside (thumbs up) as the second step lands, then short
  powerful steps with the pads low (a ~45 degree back), the head up.
- Pull: an open step with the playside foot (the toes turned down the
  line, a little depth), the playside elbow ripped back to turn the
  shoulders, a crossover, then run flat down the line (~5-6 m/s by the
  third step for a guard).
- Settle: the lineman's two-point (hands on the thighs) until the
  cadence, then the hand goes down, the hips come up level with the
  shoulders, a small rock onto the hand and back, and he is still.
- Pass-rush moves (from the run, at the blocker): the swim (the near hand
  clubs the blocker's hands down, the far arm comes over the top of his
  shoulder), the rip (the near shoulder dips and the near arm uppercuts
  through the blocker's armpit), the club (a forearm swat to the
  blocker's shoulder), the spin (plant, spin on the ball of the inside
  foot, the back arm clubbing round). Each at the blocker slows the
  rusher to ~3 m/s and he comes out of it back at speed, ~0.5 s.
- Bull rush: gather low, both hands strike the chest plate, lock out and
  drive with short steps, the pads under the blocker's.
- Hand fighting (engaged): hands inside on the chest, stripping the
  blocker's hands off and re-fitting, the feet active.
- Shed: press the blocker off (arms lock out), yank him to one side, step
  past and pursue.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import FIST, GRIP, RELAXED, SPREAD, STANCES, Clip, hands_of, keyed, mirror_pose, mirrored, mix, run_at, shift
from .actions_m6 import LOADED, LOCK, PUNCH, READY, STRIKE_WRISTS, bump, gait_clip, power_travel, rotate_pose, turn_about_hips, with_arms
from .gait import FPS, GAITS, Gait, gait_pose, smoothstep
from .poses import Arm, Foot, Pose
from .transitions import Plant, Steps, _hermite, blend

RUN = GAITS["run"]
RUN_T = RUN.frames / FPS

# --- Stances ------------------------------------------------------------------

# The pass set (the top of the set, square to the rusher): feet a little
# wider than the shoulders and even (an interior set; a tackle squares up
# like this when the rusher commits), knees bent and the butt down (hips
# ~0.79 m), chest up over the knees, hands up and in, eyes on the rusher.
STANCES["ol_pass"] = Pose(
    pelvis={"forward": -0.03, "up": -0.19, "flex": 22},
    joints={"spine_02": (4, 0, 0), "spine_03": (2, 0, 0), **SPREAD, **STRIKE_WRISTS},
    feet={"l": Foot(0.27, -0.05, heel=10, out=12), "r": Foot(-0.27, -0.05, heel=10, out=12)},
    arms={"l": READY, "r": READY},
    gaze=(4.0, 0.0),
)

# The lineman's two-point before the cadence: the stance's feet, bent at
# the waist, hands resting on the thighs above the knees, eyes up.
STANCES["ol_ready"] = Pose(
    pelvis={"forward": -0.10, "up": -0.15, "flex": 48},
    joints={"spine_02": (8, 0, 0), "spine_03": (6, 0, 0), **RELAXED},
    feet={"l": Foot(0.25, -0.06, heel=6, out=6), "r": Foot(-0.24, 0.08, heel=10, out=4)},
    hands={"l": (0.18, -0.21, 0.64), "r": (-0.18, -0.15, 0.62)},
    gaze=(8.0, 0.0),
)

# Engaged with a blocker (the defensive lineman's hand fight, frame 0):
# a staggered base, the left foot up, the pads low and the hands inside on
# the chest plate.
ENGAGE = Pose(
    pelvis={"forward": 0.0, "up": -0.24, "flex": 34},
    joints={"spine_02": (6, 0, 0), "spine_03": (4, 0, 0), "neck_01": (-12, 0, 0), **SPREAD, **STRIKE_WRISTS},
    feet={"l": Foot(0.22, -0.20, heel=16, out=6), "r": Foot(-0.24, 0.16, heel=24, out=8)},
    arms={"l": replace(PUNCH, flex=110, elbow=34), "r": replace(PUNCH, flex=110, elbow=34)},
    gaze=(2.0, 0.0),
)


# --- Offensive line ------------------------------------------------------------


def kick_slide(side: str) -> Clip:
    """From the three-point, the pass set: three kick-slides back and to
    the outside (`side`), then square at the top of the set."""
    T = 1.0
    d = -1.0 if side == "r" else 1.0  # +x is the player's left
    DX, DY = 0.55 * d, 1.05
    st, ps = copy.deepcopy(STANCES["ol_3pt"]), copy.deepcopy(STANCES["ol_pass"])

    def B(t):
        e = smoothstep(0.03, 0.92, t)
        return DX * e, DY * e

    def travel(t):
        return B(t)

    kick, slide = ("r", "l") if side == "r" else ("l", "r")
    end = shift(ps, DX, DY)

    def at(s, t, dx=0.0, dy=0.0, heel=12.0):
        bx, by = B(t)
        f = ps.feet[s]
        return replace(f, x=f.x + bx + dx, y=f.y + by + dy, heel=heel, out=f.out + (6 if s == kick else 0))

    # Kick, slide, kick, slide, kick, slide (the kick leads a few cm wide and deep).
    kicks = [(0.05, 0.18), (0.34, 0.44), (0.60, 0.70)]
    slides = [(0.22, 0.32), (0.48, 0.58), (0.74, 0.84)]
    plants = [Plant(kick, -1, kicks[0][0], st.feet[kick], roll=8.0), Plant(slide, -1, slides[0][0], st.feet[slide], roll=6.0)]
    for i, (lift, land) in enumerate(kicks):
        nxt = kicks[i + 1][0] if i + 1 < len(kicks) else math.inf
        foot = end.feet[kick] if i == 2 else at(kick, land + 0.12, 0.03 * d, 0.04)
        plants.append(Plant(kick, land, nxt, foot, roll=6.0 if nxt < math.inf else 0.0))
    for i, (lift, land) in enumerate(slides):
        nxt = slides[i + 1][0] if i + 1 < len(slides) else math.inf
        foot = end.feet[slide] if i == 2 else at(slide, land + 0.08)
        plants.append(Plant(slide, land, nxt, foot, roll=5.0 if nxt < math.inf else 0.0))
    steps = Steps(plants, height=0.035)

    def pose(t):
        bx, by = B(t)
        p = mix(shift(st, bx, by), shift(ps, bx, by), smoothstep(0.0, 0.36, t))
        # The down hand pushes off the turf and comes up first.
        h = st.hands["r"]
        p.hands = {"r": (h[0], h[1], h[2], 1.0 - smoothstep(0.0, 0.1, t))} if t < 0.1 else {}
        # The hips open a little to the rusher's side, square at the top.
        o = math.sin(math.pi * smoothstep(0.04, 0.95, t))
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + 12.0 * d * o
        p.joints["spine_03"] = (p.joints.get("spine_03", (0, 0, 0))[0], 0.0, -4.0 * d * o)
        p.gaze = (4.0, 14.0 * d * o, 0.6)
        # Each kick sits: a small dip as the kick foot lands.
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.012 * sum(bump(t, a, a + 0.16) for _, a in kicks)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip(f"ol_kick_slide_{side}", "transition", T, pose, travel, "stance_ol_3pt", "stance_ol_pass", steps)


def anchor() -> Clip:
    """A bull rush arrives (frame 3): lock out, sink, choppy steps back, drop anchor."""
    T = 0.9
    ps = copy.deepcopy(STANCES["ol_pass"])
    D = 0.45

    def back(t):
        return 0.0 if t < 0.08 else _hermite(0.0, D, 1.6, 0.0, 0.7, min(t - 0.08, 0.7))

    def travel(t):
        return (0.0, back(t))

    end = shift(ps, 0.0, D)

    def at(s, t):
        f = ps.feet[s]
        return replace(f, y=f.y + back(t), heel=14.0)

    plants = [
        Plant("r", -1, 0.12, ps.feet["r"], roll=4.0), Plant("r", 0.21, 0.34, at("r", 0.3), roll=4.0), Plant("r", 0.43, 0.56, at("r", 0.55), roll=4.0), Plant("r", 0.64, math.inf, end.feet["r"]),
        Plant("l", -1, 0.23, ps.feet["l"], roll=4.0), Plant("l", 0.32, 0.45, at("l", 0.42), roll=4.0), Plant("l", 0.54, 0.66, at("l", 0.66), roll=4.0), Plant("l", 0.75, math.inf, end.feet["l"]),
    ]
    steps = Steps(plants, height=0.03)
    punch = with_arms(ps, Pose(arms={"l": PUNCH, "r": PUNCH}, joints={**SPREAD, **STRIKE_WRISTS}))
    lock = with_arms(ps, Pose(arms={"l": LOCK, "r": LOCK}, joints={**SPREAD, **STRIKE_WRISTS}))
    give = with_arms(ps, Pose(arms={"l": replace(LOCK, elbow=30, flex=94), "r": replace(LOCK, elbow=30, flex=94)}, joints={**SPREAD, **STRIKE_WRISTS}))
    keys = [(0.0, ps), (0.1, punch), (0.2, lock), (0.34, give), (0.52, lock), (0.7, lock), (T, ps)]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, back(t))
        # The hit rocks the chest up, then he sinks and leans back into it.
        sink = smoothstep(0.08, 0.26, t) * (1 - smoothstep(0.62, 0.9, t))
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.08 * sink
        p.pelvis["flex"] = p.pelvis.get("flex", 0.0) - 9.0 * bump(t, 0.06, 0.24) + 8.0 * sink
        p.gaze = (4.0 - 6.0 * bump(t, 0.06, 0.24), 0.0, 0.5)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("ol_anchor", "transition", T, pose, travel, "stance_ol_pass", "stance_ol_pass", steps, events={"contact": 3})


def punch_mirror_left() -> Clip:
    """The punch (frame 4), then two slides left with the rusher, hands on him, and re-fit."""
    T = 0.9
    ps = copy.deepcopy(STANCES["ol_pass"])
    L = 0.62

    def side(t):
        return L * smoothstep(0.18, 0.78, t)

    def travel(t):
        return (side(t), 0.0)

    end = shift(ps, L, 0.0)

    def at(s, t):
        f = ps.feet[s]
        return replace(f, x=f.x + side(t), heel=14.0)

    plants = [
        Plant("l", -1, 0.20, ps.feet["l"], roll=5.0), Plant("l", 0.31, 0.45, at("l", 0.44), roll=5.0), Plant("l", 0.56, math.inf, end.feet["l"]),
        Plant("r", -1, 0.32, ps.feet["r"], roll=5.0), Plant("r", 0.43, 0.58, at("r", 0.56), roll=5.0), Plant("r", 0.68, math.inf, end.feet["r"]),
    ]
    steps = Steps(plants, height=0.035)
    punch = with_arms(ps, Pose(arms={"l": PUNCH, "r": PUNCH}, joints={**SPREAD, **STRIKE_WRISTS}))
    on = with_arms(ps, Pose(arms={"l": replace(PUNCH, elbow=38, flex=96), "r": replace(PUNCH, elbow=34, flex=98)}, joints={**SPREAD, **STRIKE_WRISTS}))
    keys = [(0.0, ps), (0.12, punch), (0.26, on), (0.7, on), (T, ps)]

    def pose(t):
        p = shift(keyed(keys, t), side(t), 0.0)
        o = math.sin(math.pi * smoothstep(0.1, 0.9, t))
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + 8.0 * o
        p.pelvis["lateral"] = p.pelvis.get("lateral", 0.0) + 3.0 * bump(t, 0.2, 0.7)
        p.gaze = (4.0, 10.0 * o, 0.5)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("ol_punch_mirror_l", "transition", T, pose, travel, "stance_ol_pass", "stance_ol_pass", steps, events={"contact": 4}, main_dir=[1.0, 0.0])


# The drive block's legs (the gait keyer): short powerful steps (~0.4 m at
# 1.3 m/s, 1.5 steps a second each foot), on the balls of the feet, a wide
# base, the pads low (trunk ~40 degrees forward), the hands inside on the
# chest plate with the elbows in and the wrists cocked, eyes up.
DRIVE = Gait(
    "drive", frames=20, speed=1.3, duty=0.62, width=0.15, pelvis_up=-0.23, bob=0.012, sway=0.014, drop=3, turn=4, counter=2, lean=40,
    arm_c=110, arm_a=3, elbow=36, elbow_d=4, arm_abd=11, inward=0.42, hand="spread",
    hip_max=36, hip_ext=-22, knee_max=70, retract=4, lift=0.07, fk=0.6,
    strike=14, flat_by=0.1, heel_mid=16, rise_at=0.45, toe_off=40, dorsi=4, gaze=-6, ahead=0.35,
    extra={**STRIKE_WRISTS, "clavicle_l": (8, 0, 0), "clavicle_r": (8, 0, 0), "neck_01": (-10, 0, 0)},
)


def drive_loop() -> Clip:
    return gait_clip("ol_drive", DRIVE)


def fire_drive() -> Clip:
    """Off the snap into the drive block: the back (right) foot's power
    step lands at 0.24 s, the hands strike as the left lands (frame 9),
    hand over to the drive loop at its left touch-down."""
    T = 0.6
    st = copy.deepcopy(STANCES["ol_3pt"])
    d0 = gait_pose(DRIVE, 0)
    D = 0.72
    fwd = lambda t: _hermite(0.0, D, 0.0, DRIVE.speed, T, min(t, T))  # noqa: E731

    def travel(t):
        return (0.0, -fwd(t))

    target = shift(d0, 0.0, -D)
    steps = Steps([
        Plant("r", -1, 0.05, st.feet["r"], roll=10.0), Plant("r", 0.24, math.inf, target.feet["r"]),
        Plant("l", -1, 0.26, st.feet["l"], roll=14.0), Plant("l", T, math.inf, target.feet["l"]),
    ], height=0.06)
    # Keys in the body's own frame (the pelvis's travel is set below).
    first = blend(st, d0, 0.4)
    first.hands = {}
    first.pelvis["flex"] = 44.0
    first.pelvis["up"] = st.pelvis["up"] + 0.02
    first.arms = {"l": LOADED, "r": LOADED}
    first.joints.update({**SPREAD, **STRIKE_WRISTS})
    strike = copy.deepcopy(d0)
    strike.arms = {"l": PUNCH, "r": PUNCH}
    keys = [(0.0, st), (0.22, first), (0.3, strike), (T, d0)]
    x0 = st.pelvis["forward"]

    def pose(t):
        p = keyed(keys, t)
        # The hips come forward out of the stance on top of the root's travel.
        p.pelvis["forward"] = x0 - x0 * smoothstep(0.0, T, t) + fwd(t)
        h = st.hands["r"]
        p.hands = {"r": (*h[:3], 1.0 - smoothstep(0.0, 0.1, t))} if t < 0.1 else {}
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("ol_fire_drive", "transition", T, pose, travel, "stance_ol_3pt", "ol_drive", steps, events={"contact": 9})


def pull(side: str) -> Clip:
    """Off the snap, pull down the line toward `side`: open step with the
    playside foot (toes down the line, a little depth), the playside elbow
    ripped back to turn the shoulders, crossover, run flat. Ends running
    at run speed turned 90 degrees (`turn`), on the playside foot's touch-down."""
    T = 0.8
    d = 1.0 if side == "l" else -1.0
    play, back_ = ("l", "r") if side == "l" else ("r", "l")
    st = copy.deepcopy(STANCES["ol_3pt"])
    D, DEPTH = 2.0, 0.12
    xt = power_travel(D, T, RUN.speed)

    def P(t):
        return d * xt(t), DEPTH * smoothstep(0.0, 0.35, t)

    def travel(t):
        return P(t)

    def yaw(t):
        return 90.0 * d * smoothstep(0.02, 0.38, t)

    # The run takes over on the playside foot's touch-down: phase 0 (left) or 0.5 (right).
    ph = 0.0 if play == "l" else 0.5
    run_end = run_at(ph * RUN.frames)
    px, py = P(T)
    end = shift(turn_about_hips(run_end, 90.0 * d), px, py)
    # Open step: the playside foot out and back, toes down the line.
    o1 = st.feet[play]
    open_foot = Foot(x=d * 0.36, y=0.24, heel=8.0, out=70.0)
    cross = Foot(x=P(0.43)[0] + d * 0.06, y=0.02, heel=10.0, out=-80.0)
    steps = Steps([
        Plant(play, -1, 0.03, o1, roll=6.0), Plant(play, 0.16, 0.34, open_foot, roll=18.0), Plant(play, T, math.inf, end.feet[play]),
        Plant(back_, -1, 0.14, st.feet[back_], roll=14.0), Plant(back_, 0.36, 0.60, cross, roll=24.0), Plant(back_, T, math.inf, end.feet[back_], contact=False),
    ], height=0.10)
    first = blend(st, run_end, 0.4)
    first.hands = {}
    first.pelvis.update({"flex": 50.0, "up": -0.18, "forward": -0.10})
    # The playside elbow rips back, the other arm drives across.
    rip, drive = Arm(flex=-50, elbow=95, abd=16, inward=0.05), Arm(flex=58, elbow=85, abd=10, inward=0.2)
    first.arms = {play: rip, back_: drive}
    first.joints.update(FIST)

    def pose(t):
        q = mix(st, first, smoothstep(0.0, 0.3, t)) if t < 0.3 else mix(first, run_end, smoothstep(0.3, T, t) ** 1.4)
        h = st.hands["r"]
        q.hands = {"r": (*h[:3], 1.0 - smoothstep(0.0, 0.08, t))} if t < 0.08 else {}
        p = turn_about_hips(q, yaw(t))
        x, y = P(t)
        p = shift(p, x, y)
        p.gaze = (5.0, yaw(t), 0.7)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip(f"ol_pull_{side}", "transition", T, pose, travel, "stance_ol_3pt", "loco_run", steps, to_phase=ph, main_dir=[d, 0.0], turn=90.0 * d)


def settle() -> Clip:
    """From the two-point (hands on the thighs) into the three-point: the
    hand goes down, the hips come up level, a small rock onto the hand and
    back, still. Both feet stay down (they only roll)."""
    T = 0.9
    rd, st = copy.deepcopy(STANCES["ol_ready"]), copy.deepcopy(STANCES["ol_3pt"])
    load = copy.deepcopy(rd)
    load.pelvis.update({"up": rd.pelvis["up"] - 0.025, "flex": rd.pelvis["flex"] + 4})
    over = copy.deepcopy(st)
    over.pelvis.update({"forward": st.pelvis["forward"] + 0.025, "up": st.pelvis["up"] - 0.01})
    back_ = copy.deepcopy(st)
    back_.pelvis.update({"forward": st.pelvis["forward"] - 0.012})
    keys = [(0.0, rd), (0.14, load), (0.52, over), (0.7, back_), (T, st)]

    def pose(t):
        p = keyed(keys, t)
        # The down hand: off the thigh, reaching for the turf (IK weight hands over).
        if 0.14 < t < 0.52:
            k = smoothstep(0.14, 0.52, t)
            a, b = rd.hands["r"], st.hands["r"]
            p.hands["r"] = (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k + 0.08 * math.sin(math.pi * k), 1.0)
        p.feet = {s: replace(st.feet[s], heel=rd.feet[s].heel + (st.feet[s].heel - rd.feet[s].heel) * smoothstep(0.1, 0.6, t)) for s in "lr"}
        return p

    return Clip("ol_settle", "transition", T, pose, None, "stance_ol_ready", "stance_ol_3pt")


def ol_clips() -> list[Clip]:
    pm = punch_mirror_left()
    return [
        kick_slide("r"), kick_slide("l"), anchor(), pm, mirrored(pm, "ol_punch_mirror_r"),
        drive_loop(), fire_drive(), pull("l"), pull("r"), settle(),
    ]


# --- Defensive line ------------------------------------------------------------


def arm_track(keys: list, base: dict, t: float) -> dict:
    """Arms over time from timed keys {side: Arm or None}; None (and a side
    a key leaves out) means the base motion's own arm."""
    from .transitions import _blend_arm

    def val(k, s):
        a = k.get(s)
        return a if a is not None else base.get(s)

    out = {}
    for s in "lr":
        if t <= keys[0][0] or t >= keys[-1][0]:
            k = keys[0][1] if t <= keys[0][0] else keys[-1][1]
            out[s] = val(k, s)
            continue
        for (t0, a), (t1, b) in zip(keys, keys[1:]):
            if t <= t1:
                out[s] = _blend_arm(val(a, s), val(b, s), smoothstep(t0, t1, t))
                break
    return {s: a for s, a in out.items() if a is not None}


def run_move(name: str, frames: int, L: float, dip: float, arms: list, fx=None, events=None, hands=None, r_at=(0.12, 0.25), l_at=(0.31, 0.40)) -> Clip:
    """A pass-rush move out of the run (left touch-down), at the blocker:
    the rusher slows (`dip` m lost against the run) and shifts `L` m to his
    left over two steps (the right foot plants, the left lands past the
    blocker), and the run hands back at the right touch-down (phase 0.5).
    The legs are a juke's footwork (actions.juke_left); `arms` keys the
    hands' work over the run's arm swing, `fx` edits the body."""
    T = frames / FPS
    v = RUN.speed

    def fwd(t):
        return v * t - dip * math.sin(math.pi * t / T) ** 2

    def side(t):
        return L * smoothstep(0.08, 0.40, t)

    def travel(t):
        return (side(t), -fwd(t))

    def at(p, t):
        return shift(p, side(t), -fwd(t))

    run0 = run_at(0)
    end = at(run_at(10), T)
    rm, lm = sum(r_at) / 2, sum(l_at) / 2
    r1 = Foot(x=side(rm) - 0.14, y=-fwd(rm) - 0.06, heel=10, out=-6)
    l1 = Foot(x=side(lm) + 0.12, y=-fwd(lm) - 0.07, heel=8, out=8)
    steps = Steps([
        Plant("l", -1, 0.07, run0.feet["l"], roll=20),
        Plant("l", l_at[0], l_at[1], l1, roll=25),
        Plant("l", T, math.inf, end.feet["l"], contact=False),
        Plant("r", r_at[0], r_at[1], r1, roll=25),
        Plant("r", T, math.inf, end.feet["r"]),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}, height=0.11)

    def pose(t):
        p = at(run_at(10 * t / T), t)
        b = bump(t, 0.04, 0.42)
        # At the blocker: the pads drop and the chest leans into the move.
        # (a rusher wins with the lower pads: ~30 degrees of trunk lean at the move)
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.13 * b
        p.pelvis["flex"] = p.pelvis.get("flex", 0.0) + 14.0 * b
        _spine(p, "spine_02", flex=4.0 * b)
        p.joints["neck_01"] = (p.joints.get("neck_01", (0, 0, 0))[0] - 12.0 * b, 0.0, 0.0)
        p.arms = arm_track(arms, p.arms, t)
        p.joints.update(hands or {})
        p.gaze = (6.0, 0.0)
        if fx:
            fx(p, t)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip(name, "transition", T, pose, travel, "loco_run", "loco_run", steps, to_phase=0.5, events=events or {}, from_phase=0.0)


def _spine(p: Pose, bone: str, flex: float = 0.0, abd: float = 0.0, twist: float = 0.0) -> None:
    f, a, tw = p.joints.get(bone, (0.0, 0.0, 0.0))
    p.joints[bone] = (f + flex, a + abd, tw + twist)


def swim_left() -> Clip:
    """The near (left) hand chops the blocker's hands down (frame 5), the
    far (right) arm comes up and over his shoulder (frames 5-11) and
    down past his hip, and the rusher runs on."""
    keys = [
        (0.0, {}),
        (0.07, {"l": Arm(flex=125, elbow=45, abd=22, inward=0.2)}),
        (0.16, {"l": Arm(flex=45, elbow=35, abd=10, inward=0.6), "r": Arm(flex=70, elbow=95, abd=35, inward=0.1)}),
        (0.25, {"l": Arm(flex=-25, elbow=90, abd=14, inward=0.1), "r": Arm(flex=168, elbow=35, abd=18, inward=0.3)}),
        (0.34, {"l": None, "r": Arm(flex=115, elbow=45, abd=-6, inward=0.7)}),
        (0.46, {"r": Arm(flex=35, elbow=80, abd=10, inward=0.3)}),
        (16 / FPS, {}),
    ]

    def fx(p, t):
        b = bump(t, 0.08, 0.44)
        # Skinny: the right shoulder comes over the top and forward.
        _spine(p, "spine_03", twist=10.0 * b, abd=5.0 * b)
        _spine(p, "spine_04", twist=6.0 * b)
        p.pelvis["lateral"] = p.pelvis.get("lateral", 0.0) + 6.0 * b

    return run_move("dl_swim_l", 16, 0.55, 0.5, keys, fx, events={"contact": 5, "clear": 11}, hands={**SPREAD})


def rip_left() -> Clip:
    """The right hand swipes the blocker's hands (frame 4), the left
    shoulder dips and the left arm uppercuts up through his armpit (frame 7)."""
    keys = [
        (0.0, {}),
        (0.06, {"l": Arm(flex=-40, elbow=100, abd=16, inward=0.1), "r": Arm(flex=100, elbow=30, abd=6, inward=0.5)}),
        (0.14, {"r": Arm(flex=25, elbow=60, abd=10, inward=0.3)}),
        (0.23, {"l": Arm(flex=150, elbow=80, abd=14, inward=0.35), "r": None}),
        (0.36, {"l": Arm(flex=95, elbow=95, abd=12, inward=0.2)}),
        (16 / FPS, {}),
    ]

    def fx(p, t):
        b = bump(t, 0.06, 0.44)
        # The near shoulder dips under the blocker's hands: bend to the left.
        _spine(p, "spine_02", abd=-9.0 * b)
        _spine(p, "spine_03", abd=-7.0 * b, twist=-6.0 * b)
        p.pelvis["lateral"] = p.pelvis.get("lateral", 0.0) + 8.0 * b

    return run_move("dl_rip_l", 16, 0.5, 0.55, keys, fx, events={"contact": 4, "rip": 7}, hands={**FIST})


def club_left() -> Clip:
    """The right forearm swats across the blocker's shoulder (frame 5),
    the left arm rips through as the rusher clears him."""
    keys = [
        (0.0, {}),
        (0.07, {"r": Arm(flex=135, elbow=105, abd=48, inward=0.0)}),
        (0.16, {"r": Arm(flex=70, elbow=60, abd=-8, inward=0.8)}),
        (0.27, {"r": Arm(flex=25, elbow=75, abd=8, inward=0.5), "l": Arm(flex=-30, elbow=95, abd=14, inward=0.1)}),
        (0.38, {"l": Arm(flex=125, elbow=85, abd=14, inward=0.3), "r": None}),
        (16 / FPS, {}),
    ]

    def fx(p, t):
        b = bump(t, 0.05, 0.3)
        _spine(p, "spine_03", twist=12.0 * b)
        _spine(p, "spine_04", twist=6.0 * b)
        p.pelvis["lateral"] = p.pelvis.get("lateral", 0.0) + 5.0 * bump(t, 0.2, 0.46)

    return run_move("dl_club_l", 16, 0.5, 0.45, keys, fx, events={"contact": 5}, hands={**FIST})


def rush_spin_left() -> Clip:
    """Plant the left foot and spin to the left on its ball through a full
    turn off the blocker, arms tight, the right arm swinging round to club
    his back (frame 8); land and run on (phase 0). A ball carrier's spin's
    footwork (actions.spin) with a rusher's arms."""
    T = 15 / FPS
    v = RUN.speed

    def yaw(t):
        return 360.0 * smoothstep(0.03, 0.44, t)

    def fwd(t):
        a = 0.25
        if t < a:
            return 0.4 * t + (v - 0.4) * a / 5 * (1 - (1 - t / a) ** 5)
        x1 = 0.4 * a + (v - 0.4) * a / 5
        return _hermite(x1, x1 + 0.9, 0.4, 5.0, T - a, t - a)

    def side(t):
        return 0.35 * smoothstep(0.2, 0.45, t)

    def travel(t):
        return (side(t), -fwd(t))

    def rot(x, y, deg):
        a = math.radians(deg)
        return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)

    run0 = run_at(0)
    end = shift(run_at(0), side(T), -fwd(T))
    lf = run0.feet["l"]
    rx, ry = rot(-0.22, -0.02, yaw(0.25))
    r_land = Foot(x=rx + side(0.25), y=ry - fwd(0.25), heel=16, out=4 - yaw(0.25))
    steps = Steps([
        Plant("l", -1, 0.27, lf, roll=0.0),
        Plant("l", T, math.inf, end.feet["l"]),
        Plant("r", 0.25, 0.40, r_land, roll=0.0),
        Plant("r", T, math.inf, end.feet["r"], contact=False),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}, height=0.14)
    tight = Arm(flex=30, elbow=120, abd=10, inward=0.4)
    keys = [
        (0.0, {}),
        (0.06, {"l": tight, "r": tight}),
        (0.18, {"r": Arm(flex=80, elbow=40, abd=60, inward=0.0)}),
        (0.28, {"r": Arm(flex=60, elbow=70, abd=20, inward=0.5), "l": Arm(flex=35, elbow=60, abd=40, inward=0.1)}),
        (T, {}),
    ]

    def pose(t):
        p = shift(run_at(10 * t / T), side(t), -fwd(t))
        p.arms = arm_track(keys, p.arms, t)
        p.joints.update(FIST)
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + yaw(t)
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.12 * math.sin(math.pi * smoothstep(0.0, 0.44, t))
        p.yaw = yaw(t)
        p.fk_dir = yaw(t)
        g = yaw(t)
        p.gaze = (6.0, 0.65 * g if g < 330 else 0.65 * g * (1 - smoothstep(330, 360, g)), 0.6)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        if t < 0.27:
            p.feet["l"] = replace(lf, heel=18.0, out=lf.out + yaw(min(t, 0.27)))
        return p

    return Clip("dl_spin_l", "transition", T, pose, travel, "loco_run", "loco_run", steps, events={"contact": 8}, from_phase=0.0)


def bull_rush() -> Clip:
    """Out of the run into the blocker: gather low with the hands loaded,
    strike both hands into his chest plate (frame 6), lock out and drive
    him back with short steps, and settle engaged (dl_engage)."""
    T = 0.9
    v = RUN.speed
    D1, D2 = 0.75, 0.45

    def fwd(t):
        if t < 0.2:
            return _hermite(0.0, D1, v, 1.6, 0.2, t)
        return _hermite(D1, D1 + D2, 1.6, 0.0, 0.66, min(t - 0.2, 0.66))

    def travel(t):
        return (0.0, -fwd(t))

    run0 = run_at(0)
    end = shift(ENGAGE, 0.0, -fwd(T))
    steps = Steps([
        Plant("l", -1, 0.07, run0.feet["l"], roll=20),
        Plant("l", 0.36, 0.52, Foot(x=0.14, y=-fwd(0.44) - 0.06, heel=16, out=6), roll=16),
        Plant("l", 0.70, math.inf, end.feet["l"]),
        Plant("r", 0.15, 0.33, Foot(x=-0.13, y=-fwd(0.24) - 0.03, heel=14, out=6), roll=18),
        Plant("r", 0.56, math.inf, end.feet["r"]),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}, height=0.09)
    gather = copy.deepcopy(run0)
    gather.pelvis.update({"up": -0.2, "flex": 30})
    gather.arms = {"l": LOADED, "r": LOADED}
    gather.joints.update({**SPREAD, **STRIKE_WRISTS, "neck_01": (-14, 0, 0)})
    strike = copy.deepcopy(ENGAGE)
    strike.arms = {"l": replace(PUNCH, flex=112), "r": replace(PUNCH, flex=112)}
    lock = copy.deepcopy(ENGAGE)
    lock.arms = {"l": replace(LOCK, flex=108), "r": replace(LOCK, flex=108)}
    keys = [(0.0, run0), (0.13, gather), (0.2, strike), (0.32, lock), (0.66, lock), (T, ENGAGE)]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, -fwd(t))
        # Drive: the pads stay under his, a little lower still on each push.
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.03 * bump(t, 0.2, 0.7)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("dl_bull_rush", "transition", T, pose, travel, "loco_run", "dl_engage", steps, events={"contact": 6}, from_phase=0.0)


def engage_loop() -> Clip:
    """Engaged: hand fighting. The left hand strips the blocker's hand and
    re-fits inside (0.1-0.35 s), then the right (0.7-0.95 s); the chest works
    against him and each foot chops in place once. A 1.2 s loop."""
    T = 1.2
    e = ENGAGE
    strip = Arm(flex=70, elbow=55, abd=28, inward=0.2)
    fit = replace(PUNCH, flex=112, elbow=30)
    keys = [
        (0.0, {}), (0.14, {"l": strip}), (0.3, {"l": fit}), (0.45, {"l": None}),
        (0.7, {"r": strip}), (0.86, {"r": fit}), (1.0, {"r": None}), (T, {}),
    ]
    steps = Steps([
        Plant("l", -1, 0.36, e.feet["l"]), Plant("l", 0.46, math.inf, e.feet["l"]),
        Plant("r", -1, 0.92, e.feet["r"]), Plant("r", 1.02, math.inf, e.feet["r"]),
    ], height=0.035)

    def pose(t):
        p = copy.deepcopy(e)
        p.arms = arm_track(keys, e.arms, t)
        w = math.sin(2 * math.pi * t / T)
        _spine(p, "spine_03", twist=6.0 * w)
        _spine(p, "spine_02", twist=3.0 * w)
        p.pelvis["side"] = p.pelvis.get("side", 0.0) + 0.012 * w
        p.pelvis["up"] = p.pelvis.get("up", 0.0) + 0.008 * math.sin(4 * math.pi * t / T)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("dl_engage", "stance", T, pose, loop=True, com=False, contacts=steps.contacts(round(T * FPS)))


def shed(side: str) -> Clip:
    """From the hand fight: lock out, yank the blocker to the other side
    (frame 6), step past him toward `side` and pursue at run speed."""
    T = 0.7
    d = 1.0 if side == "l" else -1.0
    first, second = ("l", "r") if side == "l" else ("r", "l")
    ph = 0.5 if second == "r" else 0.0
    xt = power_travel(1.35, T, RUN.speed)

    def lat(t):
        return 0.55 * d * smoothstep(0.1, 0.45, t)

    def travel(t):
        return (lat(t), -xt(t))

    run_end = run_at(ph * RUN.frames)
    end = shift(run_end, lat(T), -xt(T))
    e = ENGAGE
    mid = 0.4
    past = Foot(x=lat(mid) + 0.13 * d, y=-xt(mid) - 0.10, heel=12, out=10)
    steps = Steps([
        Plant(first, -1, 0.12, e.feet[first], roll=10.0), Plant(first, 0.28, T - 0.17, past, roll=26.0), Plant(first, T, math.inf, end.feet[first], contact=False),
        Plant(second, -1, 0.31, e.feet[second], roll=18.0), Plant(second, T, math.inf, end.feet[second]),
    ], height=0.1)
    lock = copy.deepcopy(e)
    lock.arms = {"l": replace(LOCK, flex=108), "r": replace(LOCK, flex=108)}
    # The yank: both arms swing across toward the other side, the chest turns with them.
    yank = copy.deepcopy(e)
    near, far = ("l", "r") if d < 0 else ("r", "l")
    yank.arms = {far: Arm(flex=92, elbow=30, abd=-18, inward=0.8), near: Arm(flex=70, elbow=45, abd=42, inward=0.0)}
    yank.pelvis.update({"up": -0.22})
    keys = [(0.0, e), (0.1, lock), (0.2, yank), (0.34, blend(yank, run_end, 0.4)), (T, run_end)]

    def pose(t):
        p = shift(keyed(keys, t), lat(t), -xt(t))
        b = bump(t, 0.1, 0.4)
        _spine(p, "spine_03", twist=-14.0 * d * b)
        _spine(p, "spine_04", twist=-6.0 * d * b)
        p.gaze = (6.0, 10.0 * d * bump(t, 0.2, T), 0.5)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip(f"dl_shed_{side}", "transition", T, pose, travel, "dl_engage", "loco_run", steps, to_phase=ph, events={"contact": 3, "yank": 6})


def dl_clips() -> list[Clip]:
    out = []
    for c in (swim_left(), rip_left(), club_left(), rush_spin_left()):
        out += [c, mirrored(c, c.name[:-2] + "_r", to_phase=0.0 if c.to_phase == 0.5 else 0.5)]
    return [*out, bull_rush(), engage_loop(), shed("l"), shed("r")]


def line_clips() -> list[Clip]:
    return [*ol_clips(), *dl_clips()]

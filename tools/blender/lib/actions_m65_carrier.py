"""M6.5 ball-carrier clips (brief item 11): a ball carrier moves
differently from a receiver on a route, so he gets his own gait set and
the moments that make a run: the plant-and-cut, the burst, the dip before
contact, the truck, the hurdle and the reach for the line. Keyed here like
every clip (CLAUDE.md rule 6): no downloaded, captured or third-party
motion. The ball is always in the right arm (the arm the game carries in).

Technique, from running-back coaching ("high and tight", "pad level",
"press the hole", "one cut and go", "pad under pad") and the cutting and
acceleration literature:
- Carry gaits (carry_jog, carry_run, carry_sprint): the ball high and
  tight (the nose in the fingers, the forearm across the ribs, the elbow
  in), the free arm working hard from cheek to hip, the hips a few
  centimetres lower and the trunk leaning further forward than a receiver
  on a route (a carrier runs "behind his pads", ready to be hit or to cut),
  a slightly wider base, and less trunk counter-rotation (one arm is locked
  on the ball, so the free arm and the hips do the balancing).
- Traffic (carry_traffic_jog, carry_traffic_run): shorter, choppier steps
  (about three quarters of the stride at the same speed, so a higher
  cadence), the knees higher, a wider base, the hips low, the free hand up
  in front of the ball ready to cover it. What a back does pressing a hole
  or setting up a tackler.
- Drive (carry_drive_jog, carry_drive_run, carry_drive_sprint): the burst's
  acceleration phase (sprint-start mechanics: Mero et al. 1992, Čoh et al.
  2006): a big forward lean, the foot striking under or behind the hips, a
  longer ground contact with full hip and knee extension at toe-off (the
  "push"), a low heel recovery and a piston knee drive, the free arm big.
- cut_plant_l/_r (a 30-60 degree cut) and cut_plant_sharp_l/_r (90 and
  more): the outside foot plants wide and ahead of the hips with the toe
  turned in, the hips drop and the weight loads over the plant knee, the
  shoulders turn to the new line before the hips, then the push off the
  plant foot and the inside foot steps out along the new line. Authored in
  the runner's own frame: the game turns his heading with the sim's cut, so
  the clip has no net turn (the plant foot is locked in the world by the
  runtime while the body turns over it). Events: plant, push.
- truck: pads lowered in the gather ("pad level wins"), the off forearm
  and the lead shoulder come up and through the tackler's chest, and the
  legs keep driving in short, wide, choppy steps. Event: contact.
- hurdle: a long gather step, a one-foot takeoff off the left with the
  lead (right) knee driven up and the trail leg tucked, the ball tight and
  the free arm out for balance, landing on the lead foot in stride.
  Events: takeoff, over (the top), land.
- dive_reach: out of the run the ball arm goes out to full length in front
  (the ball over the plane or to the sticks) and the free arm braces for
  the landing; he lands on the chest with the ball still out
  (stance_down_prone_reach).
- ovl_dip_l/_r (overlays, held): the shoulder and pads dip toward a
  tackler closing in front of him (tackler on the left / right), the trunk
  flexes, the free hand covers the nose of the ball.
"""

from __future__ import annotations

# Lying stances this module adds (no balance gate); set before the imports
# (actions.py reads it at the end of its own import).
NO_BALANCE = {"down_prone_reach"}

import copy  # noqa: E402
import math
from dataclasses import replace

from .actions import FIST, GRIP, SPINE_UP, STANCES, Clip, arm_mask, hands_of, mirror_pose, run_at, shift, _trailing_feet, _blend_feet
from .actions_m6 import bump, gait_clip
from .gait import FPS, GAITS, Gait, gait_pose, smoothstep
from .poses import Arm, Foot, Pose
from .transitions import Plant, Steps, _hermite

RUN = GAITS["run"]

# --- The ball arm and the covering hand --------------------------------------------

# The tuck as an aimed arm (thorax frame), so it rides with the chest through
# a gait's lean, bob and counter-rotation. Fitted in Blender to the IK tuck of
# actions.carry_pose on the idle body (the ovl_carry_r overlay the game lays
# over the right arm): elbow and wrist within ~1.5 cm in the chest's frame
# (a grid search over flex/elbow/abd/inward).
TUCK_ARM = Arm(flex=-7, elbow=115, abd=1, inward=0.3)
TUCK_HAND = {**hands_of(GRIP, "r"), "hand_r": (-15, 0, 10)}
# The free hand over the nose of the ball (the wrist at the tucked ball's
# nose on the idle body with the protect's chest fold, fitted the same way:
# elbow and wrist within ~1 cm).
COVER_ARM = Arm(flex=25, elbow=101, abd=-7, inward=0.8)
COVER_HAND = {**hands_of(GRIP, "l"), "hand_l": (30, 0, -10)}


def carry_arms(p: Pose, left: Arm | None = None) -> Pose:
    """The right arm on the ball; the left as given (or as the gait swings it)."""
    p.arms = dict(p.arms)
    p.arms["r"] = TUCK_ARM
    if left is not None:
        p.arms["l"] = left
    p.joints.update(TUCK_HAND)
    p.joints.update(hands_of(FIST, "l"))
    return p


# --- Gaits ----------------------------------------------------------------------------
# Against the receiver's gaits (gait.py), same speeds: hips 3-5 cm lower
# ("pelvis_up"), the trunk 3-5 degrees further forward, less counter-rotation
# (the ball arm doesn't swing), the free arm a little bigger and crossing a
# touch toward the midline, the feet a little wider. Stride and cadence
# match the receiver's in space: the long stride is the open-field run.


def _carry(base: str, name: str, **kw) -> Gait:
    return replace(GAITS[base], name=name, **kw)


CARRY = {
    "carry_jog": _carry("jog", "carry_jog", pelvis_up=-0.12, lean=16, counter=6, width=0.095, arm_a=34, inward=0.12, gaze=4),
    "carry_run": _carry("run", "carry_run", pelvis_up=-0.15, lean=21, counter=7, width=0.085, arm_a=52, arm_c=8, inward=0.12, gaze=4),
    "carry_sprint": _carry("sprint", "carry_sprint", pelvis_up=-0.13, lean=23, counter=8, width=0.075, arm_a=66, inward=0.1, gaze=4),
    # Traffic: ~3/4 of the stride at the same speed (a quicker cadence), a
    # longer share on the ground, a wide base, hips low, knees driven higher
    # with a shorter heel recovery (short steps), the trunk well forward.
    "carry_traffic_jog": Gait(
        "carry_traffic_jog", frames=18, speed=3.2, duty=0.40, width=0.15, pelvis_up=-0.19, bob=0.020, sway=0.020, drop=4, turn=6, counter=4, lean=20,
        arm_c=24, arm_a=14, elbow=104, elbow_d=6, arm_abd=10, inward=0.5, hand="fist",
        hip_max=62, hip_ext=-10, knee_max=96, retract=4, lift=0.20,
        strike=6, flat_by=0.1, heel_mid=8, rise_at=0.45, toe_off=46, dorsi=10, gaze=4, ahead=0.3,
    ),
    "carry_traffic_run": Gait(
        "carry_traffic_run", frames=15, speed=5.6, duty=0.32, width=0.14, pelvis_up=-0.20, bob=0.022, sway=0.018, drop=5, turn=7, counter=5, lean=22,
        arm_c=26, arm_a=18, elbow=106, elbow_d=6, arm_abd=10, inward=0.55, hand="fist",
        hip_max=74, hip_ext=-12, knee_max=104, retract=6, lift=0.26,
        strike=8, flat_by=0.1, heel_mid=10, rise_at=0.42, toe_off=52, dorsi=12, gaze=4, ahead=0.3,
    ),
    # Drive (the burst): a longer ground contact at the same speed (duty up),
    # the foot landing under the hips (little "ahead"), full extension at
    # toe-off (hip_ext), a low heel recovery and a big knee drive, a deep lean.
    "carry_drive_jog": Gait(
        "carry_drive_jog", frames=20, speed=4.0, duty=0.32, width=0.10, pelvis_up=-0.16, bob=0.024, sway=0.012, drop=5, turn=9, counter=7, lean=30,
        arm_c=6, arm_a=52, elbow=90, elbow_d=14, arm_abd=12, inward=0.1, hand="fist",
        hip_max=66, hip_ext=-26, knee_max=96, retract=4, lift=0.20,
        strike=12, flat_by=0.1, heel_mid=14, rise_at=0.35, toe_off=66, dorsi=12, gaze=2, ahead=0.28,
    ),
    "carry_drive_run": Gait(
        "carry_drive_run", frames=16, speed=6.2, duty=0.27, width=0.09, pelvis_up=-0.16, bob=0.026, sway=0.012, drop=6, turn=10, counter=8, lean=28,
        arm_c=6, arm_a=62, elbow=90, elbow_d=16, arm_abd=12, inward=0.1, clavicle=5, hand="fist",
        hip_max=76, hip_ext=-28, knee_max=108, retract=4, lift=0.28,
        strike=14, flat_by=0.1, heel_mid=16, rise_at=0.33, toe_off=68, dorsi=14, gaze=2, ahead=0.3,
    ),
    "carry_drive_sprint": Gait(
        "carry_drive_sprint", frames=14, speed=8.2, duty=0.23, width=0.08, pelvis_up=-0.14, bob=0.026, sway=0.01, drop=6, turn=12, counter=9, lean=26,
        arm_c=5, arm_a=68, elbow=90, elbow_d=16, arm_abd=10, inward=0.08, clavicle=6, hand="fist",
        hip_max=82, hip_ext=-28, knee_max=118, retract=6, lift=0.36,
        strike=14, flat_by=0.1, heel_mid=14, rise_at=0.33, toe_off=66, dorsi=14, gaze=2, ahead=0.3,
    ),
}


def _tuck_extra(p: Pose, phase: float) -> Pose:
    return carry_arms(p)


def carry_gaits() -> list[Clip]:
    return [gait_clip(n, g, _tuck_extra) for n, g in CARRY.items()]


# --- Speed profiles -------------------------------------------------------------------


def speed_profile(pts: list[tuple[float, float]]):
    """Distance along the run from (time, speed) keys: Hermite segments that
    match the speeds at the keys (so it never runs backward for positive speeds)."""
    xs = [0.0]
    for (ta, va), (tb, vb) in zip(pts, pts[1:]):
        xs.append(xs[-1] + (va + vb) / 2 * (tb - ta))

    def fwd(t):
        for i, ((ta, va), (tb, vb)) in enumerate(zip(pts, pts[1:])):
            if t <= tb or i == len(pts) - 2:
                return _hermite(xs[i], xs[i + 1], va, vb, tb - ta, min(max(t - ta, 0.0), tb - ta))
        return xs[-1]

    return fwd


def _add(p: Pose, bone: str, flex: float = 0.0, abd: float = 0.0, twist: float = 0.0) -> None:
    f, a, t = p.joints.get(bone, (0.0, 0.0, 0.0))
    p.joints[bone] = (f + flex, a + abd, t + twist)


def _no_arms(p: Pose) -> Pose:
    p.arms = {}
    p.hands = {}
    p.elbow = {}
    return p


# --- The plant-and-cut --------------------------------------------------------------


def cut_plant(side: str, sharp: bool) -> Clip:
    """Out of the run with the right foot about to land (run phase 0.35):
    for a cut to the left the right (outside) foot plants wide and ahead with
    the toe turned in (frame `plant`), the hips drop and load over the plant
    knee while the shoulders turn to the new line, the push off it (frame
    `push`), the left foot steps out along the new line, and the right
    lands back in the run (phase 0.5). A cut to the right mirrors the legs
    and trunk; the ball stays in the right arm."""
    v0 = RUN.speed
    start = 7  # run frame: both feet in the air, the right about to land
    if sharp:
        T, tp, tpush, tl, tl_off = 24 / FPS, 0.10, 0.36, 0.44, 0.56
        vmin, vend = 0.8, 4.6
        W, A, drop, twist_sh, twist_hip, lat, bend, toe_in, L = 0.42, 0.42, 0.22, 34.0, 18.0, 16.0, 12.0, 24.0, 0.24
    else:
        T, tp, tpush, tl, tl_off = 19 / FPS, 0.10, 0.28, 0.35, 0.46
        vmin, vend = 2.8, 5.0
        W, A, drop, twist_sh, twist_hip, lat, bend, toe_in, L = 0.38, 0.38, 0.11, 22.0, 10.0, 11.0, 8.0, 10.0, 0.16
    fwd = speed_profile([(0.0, v0), (tp, v0 * 0.97), (tpush, vmin), (T, vend)])

    def lateral(t):
        # The push carries the body a little toward the new line (in his own frame).
        return L * smoothstep(tp + 0.06, tl + 0.06, t)

    def travel(t):
        return (lateral(t), -fwd(t))

    end = shift(run_at(10), lateral(T), -fwd(T))
    r_plant = Foot(x=lateral(tp) - W, y=-fwd(tp) - A, heel=10, out=-toe_in)
    l_step = Foot(x=lateral(tl) + 0.12, y=-fwd(tl) - 0.14, heel=12, out=8 + toe_in)
    steps = Steps([
        Plant("r", tp, tpush, r_plant, roll=30.0),
        Plant("r", T, math.inf, end.feet["r"]),
        Plant("l", tl, tl_off, l_step, roll=28.0),
        Plant("l", T, math.inf, end.feet["l"], contact=False),
    ], before={
        "r": lambda t: shift(run_at(start + t * FPS), 0.0, -v0 * t).feet["r"],
        "l": lambda t: shift(run_at(start + t * FPS), 0.0, -v0 * t).feet["l"],
    }, height=0.12 if sharp else 0.10)

    def load(t):
        """The plant's load: in as the foot lands, held through the plant, out with the push."""
        return smoothstep(tp - 0.03, tp + 0.10, t) * (1 - smoothstep(tpush - 0.02, tpush + 0.16, t))

    def legs(t):
        # The run's own cycle underneath (its trunk and hip rhythm), a touch
        # quicker than the run so its footfalls meet the plan's: the right
        # at the plant, the left on the new line, the right again at T.
        f = start + (30 - start) * t / T
        p = _no_arms(shift(run_at(f), lateral(t), -fwd(t)))
        k = load(t)
        early = smoothstep(tp - 0.05, tp + 0.08, t) * (1 - smoothstep(tpush + 0.02, T, t))
        hips = smoothstep(tp + 0.06, tpush + 0.04, t) * (1 - smoothstep(tpush + 0.06, T, t))
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - drop * k
        p.pelvis["flex"] = p.pelvis.get("flex", 0.0) + (10.0 if sharp else 7.0) * k
        # Weight over the plant knee: the hips shift toward the plant foot and
        # the trunk leans in toward the new line (a cut to the left leans left;
        # checked on the front-view contact sheet).
        p.pelvis["lateral"] = p.pelvis.get("lateral", 0.0) - lat * k
        p.pelvis["side"] = p.pelvis.get("side", 0.0) - 0.05 * k
        _add(p, "spine_02", abd=-bend * 0.5 * k)
        _add(p, "spine_03", abd=-bend * 0.5 * k)
        # Shoulders first (early), the hips follow (later): + turns to the left.
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + twist_hip * hips
        for b, share in (("spine_02", 0.25), ("spine_03", 0.35), ("spine_04", 0.40)):
            _add(p, b, twist=twist_sh * share * early)
        # Eyes to the new line ahead of everything.
        p.gaze = (6.0, (40.0 if sharp else 25.0) * smoothstep(tp - 0.08, tp + 0.04, t) * (1 - smoothstep(tpush, T, t)), 0.6)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    def free_arm(t, cut_side):
        """The free (left) arm: the run's swing, but through the plant it helps
        turn the chest. Cutting left, the elbow drives back and out; cutting
        right, the arm swings across the body; both drive through the push."""
        run = run_at(start + (30 - start) * t / T).arms["l" if cut_side == "l" else "r"]
        k = load(t)
        push = bump(t, tpush - 0.04, tl_off + 0.04)
        if cut_side == "l":
            key = Arm(flex=-30, elbow=96, abd=26, inward=0.05)
        else:
            key = Arm(flex=48, elbow=100, abd=4, inward=0.6)
        drive = Arm(flex=55, elbow=88, abd=10, inward=0.12)
        a = Arm(*(x + (y - x) * k for x, y in zip((run.flex, run.elbow, run.abd, run.inward), (key.flex, key.elbow, key.abd, key.inward))))
        return Arm(*(x + (y - x) * push * 0.7 for x, y in zip((a.flex, a.elbow, a.abd, a.inward), (drive.flex, drive.elbow, drive.abd, drive.inward))))

    name = f"cut_plant_sharp_{side}" if sharp else f"cut_plant_{side}"
    ev = {"plant": round(tp * FPS), "push": round(tpush * FPS)}

    def pose_l(t):
        return carry_arms(legs(t), free_arm(t, "l"))

    c = Clip(name, "transition", T, pose_l, travel, "loco_run", "loco_run", steps, to_phase=0.5, events=ev, from_phase=start / RUN.frames)
    if side == "l":
        return c
    # The right cut: the legs and trunk mirrored, the ball still in the right arm.
    m = Clip(name, "transition", T, lambda t: carry_arms(mirror_pose(legs(t)), free_arm(t, "r")), lambda t: (-lateral(t), -fwd(t)), "loco_run", "loco_run",
             contacts={"l": c.contacts["r"], "r": c.contacts["l"]}, to_phase=0.0, events=ev, from_phase=(start / RUN.frames + 0.5) % 1.0)
    return m


# --- The truck --------------------------------------------------------------------------


def truck_run() -> Clip:
    """Out of the run (left touch-down): the pads drop in the gather, the
    right foot plants wide under him as the lead shoulder and the off forearm
    come up and through the tackler (frame `contact`), then two short,
    driving steps with the pads still low, back into the run at the right
    touch-down (phase 0.5)."""
    T = 17 / FPS
    v0 = RUN.speed
    tc = 0.24
    fwd = speed_profile([(0.0, v0), (0.16, 4.8), (tc, 3.2), (0.40, 3.6), (T, 4.7)])

    def travel(t):
        return (0.0, -fwd(t))

    run0 = run_at(0)
    end = shift(run_at(10), 0.0, -fwd(T))
    y = lambda t: -fwd(t)  # noqa: E731
    r1 = Foot(-0.17, y(0.24) - 0.16, heel=16, out=10)
    l1 = Foot(0.16, y(0.40) - 0.14, heel=18, out=8)
    steps = Steps([
        Plant("l", -1, 0.09, run0.feet["l"], roll=24.0),
        Plant("l", 0.36, 0.46, l1, roll=30.0),
        Plant("l", T, math.inf, end.feet["l"], contact=False),
        Plant("r", 0.17, 0.30, r1, roll=30.0),
        Plant("r", T, math.inf, end.feet["r"]),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v0 * t).feet["r"]}, height=0.09)

    def low(t):
        return smoothstep(0.02, 0.16, t) * (1 - smoothstep(0.42, T, t))

    def up(t):
        """Up and through: the trunk rises through the contact."""
        return bump(t, tc - 0.08, 0.46)

    def pose(t):
        p = _no_arms(shift(run_at(30 * t / T), 0.0, y(t)))
        k, u = low(t), up(t)
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.16 * k + 0.05 * u
        p.pelvis["flex"] = p.pelvis.get("flex", 0.0) + 28 * k - 12 * u
        # The lead (left) shoulder into him: the chest turns a little right, the pads square after.
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) * (1 - k) - 6 * k
        _add(p, "spine_02", flex=8 * k - 6 * u, twist=-6 * k)
        _add(p, "spine_03", flex=6 * k - 4 * u, twist=-8 * k)
        _add(p, "spine_04", flex=2 * k, twist=-6 * k)
        # Eyes up: the neck extends against the trunk's flex.
        _add(p, "neck_01", flex=-18 * k)
        _add(p, "head", flex=-10 * k)
        # The off forearm across the chest as a shield, then up and through.
        run_l = run_at(30 * t / T).arms["l"]
        shield = Arm(flex=62, elbow=112, abd=22, inward=0.62, clavicle=6)
        thru = Arm(flex=104, elbow=78, abd=16, inward=0.42, clavicle=10)
        a = Arm(*(x + (y_ - x) * k for x, y_ in zip((run_l.flex, run_l.elbow, run_l.abd, run_l.inward, run_l.clavicle), (shield.flex, shield.elbow, shield.abd, shield.inward, shield.clavicle))))
        a = Arm(*(x + (y_ - x) * u for x, y_ in zip((a.flex, a.elbow, a.abd, a.inward, a.clavicle), (thru.flex, thru.elbow, thru.abd, thru.inward, thru.clavicle))))
        p = carry_arms(p, a)
        p.gaze = (-2.0 * k, 0.0, 0.5)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("truck", "transition", T, pose, travel, "loco_run", "loco_run", steps, to_phase=0.5, events={"contact": round(tc * FPS)}, from_phase=0.0)


# --- The hurdle ------------------------------------------------------------------------


def hurdle() -> Clip:
    """Out of the run at the right touch-down (the gather step, long and a
    little low), the left plants and drives him up and over (a one-foot
    takeoff) with the right knee high and the left leg tucked behind; the
    top of the flight is the `over` frame; he lands on the right foot in
    stride and the left comes through into the run (phase 0)."""
    v0 = RUN.speed
    t_gl, t_gr = 0.0, 0.14  # the gather (right) contact
    t_pl, t_off = 0.26, 0.38  # the takeoff (left) contact
    t_land, t_rl = 0.84, 0.96  # the landing (right) contact
    T = 36 / FPS
    t_top = (t_off + t_land) / 2
    rise = 9.81 * (t_land - t_off) ** 2 / 8  # a free flight of this length: ~0.2 m of hip rise
    fwd = speed_profile([(0.0, v0), (t_pl, 5.2), (t_off, 5.4), (t_land, 5.4), (t_rl, 5.0), (T, v0)])
    y = lambda t: -fwd(t)  # noqa: E731

    def travel(t):
        return (0.0, -fwd(t))

    up_off = 0.0

    def hip(t):
        if t < t_pl:
            return -0.08 - 0.05 * smoothstep(0.0, t_pl, t)
        if t < t_off:
            return -0.13 + (up_off + 0.13) * smoothstep(t_pl + 0.03, t_off, t)
        if t < t_land:
            u = t - t_off
            vz = 9.81 * (t_land - t_off) / 2
            return up_off + vz * u - 9.81 * u * u / 2
        if t < t_rl + 0.04:
            return up_off - 0.14 * math.sin(math.pi / 2 * smoothstep(t_land, t_rl + 0.04, t))
        return up_off - 0.14 + 0.06 * smoothstep(t_rl + 0.04, T, t)

    run_half = run_at(RUN.frames / 2)
    f_end = shift(run_at(0), 0.0, y(T))
    r_g = run_half.feet["r"]
    l_off = Foot(0.06, y((t_pl + t_off) / 2) - 0.12, heel=4, out=4)
    r_land = Foot(-0.08, y(t_land) - 0.30, heel=8, out=4)
    steps = Steps([
        Plant("r", -1, t_gr, r_g, roll=20.0),
        Plant("r", t_land, t_rl, r_land, roll=30.0),
        Plant("r", T, math.inf, f_end.feet["r"], contact=False),
        Plant("l", t_pl, t_off, l_off, roll=40.0),
        Plant("l", T, math.inf, f_end.feet["l"]),
    ], before={"l": lambda t: shift(run_at(RUN.frames / 2 + t * FPS), 0.0, -v0 * t).feet["l"]}, height=0.14)

    def flight(t, p):
        """In the air the legs are shaped from the hips: the lead knee up and
        the foot under it, reaching for the turf at the end; the trail leg
        extends off the takeoff and folds up behind."""
        w = smoothstep(t_off, t_off + 0.06, t) * (1 - smoothstep(t_land - 0.08, t_land, t))
        lead = smoothstep(t_off - 0.04, t_top - 0.04, t)
        reach = smoothstep(t_top, t_land - 0.03, t)
        trail = smoothstep(t_off, t_top + 0.06, t)
        right = (22 + 66 * lead - 36 * reach, 55 + 45 * lead - 70 * reach)  # (thigh from vertical, knee), deg
        left = (-22 + 44 * trail, 30 + 100 * trail - 30 * reach)
        out = {}
        for s, (a, k) in (("l", left), ("r", right)):
            base = steps.foot(s, t)
            base = replace(base, lift=base.lift + max(0.0, hip(t) - up_off) * 0.9, heel=base.heel + 30 * w)
            out[s] = replace(base, fk=(a, k, w)) if w > 1e-3 else base
        return out

    def pose(t):
        a = run_at(RUN.frames / 2 + t * FPS)
        b = run_at((t - T) * FPS)
        base = copy.deepcopy(a if t < t_land else b)
        r = 1 - smoothstep(0.1, t_off, t) + smoothstep(t_rl, T, t)
        for k in ("spine_01", "spine_02", "spine_03", "spine_04"):
            f, ab, tw = base.joints.get(k, (0, 0, 0))
            base.joints[k] = (f, ab * r, tw * r)
        e0, e1 = smoothstep(0.0, 0.10, t), smoothstep(t_rl, T, t)
        up = a.pelvis["up"] * (1 - e0) + hip(t) * e0
        up = up * (1 - e1) + b.pelvis["up"] * e1
        base.pelvis.update({"up": up, "side": base.pelvis.get("side", 0.0) * r, "lateral": base.pelvis.get("lateral", 0.0) * r, "twist": base.pelvis.get("twist", 0.0) * r})
        # Over the lead knee in the air, a touch taller at the landing.
        base.pelvis["flex"] = base.pelvis.get("flex", 0.0) + 10 * bump(t, t_pl, t_land) + 8 * bump(t, t_land - 0.04, T)
        base = _no_arms(base)
        # Free arm forward and out for balance in the air; back to the swing after.
        air = bump(t, t_pl - 0.06, t_rl)
        src = (a if t < t_land else b).arms["l"]
        bal = Arm(flex=62, elbow=70, abd=30, inward=0.1)
        left = Arm(*(x + (y_ - x) * air for x, y_ in zip((src.flex, src.elbow, src.abd, src.inward), (bal.flex, bal.elbow, bal.abd, bal.inward))))
        base = carry_arms(base, left)
        # Eyes on the body on the gather, then up the field.
        base.gaze = (6.0 + 22.0 * bump(t, 0.0, t_top), 0.0, 0.7)
        p = shift(base, 0.0, y(t))
        p.feet = flight(t, p) if t_off < t < t_land else {s: steps.foot(s, t) for s in "lr"}
        return p

    ev = {"takeoff": round(t_off * FPS), "over": round(t_top * FPS), "land": round(t_land * FPS)}
    assert rise > 0.15
    return Clip("hurdle", "transition", T, pose, travel, "loco_run", "loco_run", steps, to_phase=0.0, events=ev, from_phase=0.5)


# --- The dive that reaches the ball out -------------------------------------------------

# Lying face down with the ball arm still out in front (the ball over the
# plane or at the sticks), the free arm bent under the shoulder.
STANCES["down_prone_reach"] = Pose(
    pelvis={"forward": 0.0, "up": -0.80, "flex": 90},
    joints={"spine_02": (-4, 0, 0), "spine_03": (-4, 0, 0), "neck_01": (-26, 0, 6), "head": (-12, 0, 6), **hands_of(GRIP, "r"), **hands_of(FIST, "l"), "hand_r": (-10, 0, 0)},
    feet={"l": Foot(0.15, 0.93, heel=88, out=10), "r": Foot(-0.12, 0.95, heel=88, out=4)},
    arms={"r": Arm(flex=172, elbow=6, abd=10, inward=0.05), "l": Arm(flex=130, elbow=88, abd=48, inward=0.3)},
    knee=(0.0, 0.05, -0.9),
)


def dive_reach() -> Clip:
    """The carrier's dive (actions.dive: push off the left, horizontal, land
    on the chest), with the ball arm going out to full length in front and
    the free arm reaching down to take the landing."""
    T = 0.8
    v = RUN.speed
    D = 2.4

    def fwd(t):
        return _hermite(0.0, D, v, 0.0, 0.62, min(t, 0.62))

    def travel(t):
        return (0.0, -fwd(t))

    lying = copy.deepcopy(STANCES["down_prone_reach"])
    run0 = carry_arms(run_at(0))
    reach = copy.deepcopy(run0)
    reach.pelvis.update({"up": 0.02, "flex": 55})
    reach.arms = {"r": Arm(flex=128, elbow=26, abd=12, inward=0.1), "l": Arm(flex=86, elbow=40, abd=26, inward=0.2)}
    reach.joints.update({"neck_01": (-26, 0, 0), "head": (-12, 0, 0), "hand_r": (-10, 0, 0)})
    fly = copy.deepcopy(lying)
    fly.pelvis.update({"up": -0.55, "flex": 82})
    fly.arms = {"r": Arm(flex=170, elbow=6, abd=8, inward=0.05), "l": Arm(flex=108, elbow=30, abd=34, inward=0.2)}
    keys = [(0.0, run0), (0.16, reach), (0.36, fly), (0.47, lying), (T, lying)]
    from .actions import keyed

    def pose(t):
        p = shift(keyed(keys, t), 0.0, -fwd(t))
        if t < 0.14:
            p.feet = {"l": run0.feet["l"], "r": shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}
            p.feet["l"] = replace(p.feet["l"], heel=p.feet["l"].heel + 30 * smoothstep(0.0, 0.14, t))
        else:
            trail = _trailing_feet(p, t - 0.14)
            if t < 0.22:
                a = smoothstep(0.14, 0.22, t)
                p.feet = {s: _blend_feet(shift(run_at(t * FPS), 0.0, -v * t).feet[s] if s == "r" else run0.feet["l"], trail[s], a) for s in "lr"}
            else:
                p.feet = trail
        p.knee = (0.0, -0.9 * (1 - smoothstep(0.1, 0.4, t)), -0.9 * smoothstep(0.1, 0.4, t))
        p.joints.update(hands_of(GRIP, "r"))
        return p

    contacts = {s: [[round(0.62 * FPS), round(T * FPS)]] for s in "lr"}
    contacts["l"] = [[0, round(0.14 * FPS)], [round(0.62 * FPS), round(T * FPS)]]
    return Clip("dive_reach", "transition", T, pose, travel, "loco_run", "stance_down_prone_reach", contacts=contacts)


# --- The dip before contact (overlay) ----------------------------------------------------


def dip(side: str) -> Clip:
    """Held: the trunk flexes and the near shoulder dips toward a tackler on
    that side (the pads under his), the free hand over the nose of the ball.
    Only the arms and the upper spine: the legs keep their stride."""
    from .actions import IDLE

    s = 1.0 if side == "l" else -1.0
    p = copy.deepcopy(IDLE)
    p.joints.update({
        # Forward flex (pad level), a side bend down toward him, the far shoulder turned back a little.
        "spine_02": (8, 6 * s, -4 * s),
        "spine_03": (8, 7 * s, -5 * s),
        "spine_04": (5, 5 * s, -4 * s),
        **TUCK_HAND, **COVER_HAND,
    })
    p.arms = {"r": Arm(flex=-4, elbow=120, abd=0, inward=0.34), "l": COVER_ARM}
    p.hands, p.elbow = {}, {}

    def pose(t):
        q = copy.deepcopy(p)
        b = math.sin(2 * math.pi * t)
        _add(q, "spine_03", flex=-0.6 * b)
        return q

    return Clip(f"ovl_dip_{side}", "overlay", 1.0, pose, mask=arm_mask("l") + arm_mask("r") + SPINE_UP, loop=True)


# --- Registry ---------------------------------------------------------------------------


def carrier_clips() -> list[Clip]:
    return [
        *carry_gaits(),
        cut_plant("l", False), cut_plant("r", False), cut_plant("l", True), cut_plant("r", True),
        truck_run(), hurdle(), dive_reach(), dip("l"), dip("r"),
    ]


__all__ = ["carrier_clips", "CARRY", "NO_BALANCE", "TUCK_ARM", "COVER_ARM", "gait_pose"]

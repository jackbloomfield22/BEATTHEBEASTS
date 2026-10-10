"""Passing round 6 (docs/passing/PASSING6.md): the deep ball's catches.

Keyed here like every clip (CLAUDE.md rule 6): no downloaded, captured or
third-party motion. Each carries "secure" (the ball in the hands: the
runtime paces the clip so that frame lands on the sim's catch, the tick
the ball gets to his hands) and "tuck" events, as the M6.5 and round-5 sets.

Why these were re-keyed: round five keyed the in-stride catches on the
run's trunk (actions_p5.py) and left the deep ball's catches as M6.5 had
them. Round six's AI book draws most deep completions over the shoulder
(tools/sim/p6find.ts: the go, the post and the corner on the cue, nearly
every one), so the deep ball looked like the old clip:
- catch_over_shoulder_l/_r was keyed on the idle body, standing straight:
  laid over the run (trunk 13-17 degrees forward, hips 8 cm down) the hands
  came out low and close, at the face mask, with the head and chest square
  to the goal line: a man catching a ball in front of his face, not one
  looking back over his shoulder at a ball dropping in.
- catch_high_point swung one arm up ahead of the other and folded forward
  on the way up; at the top the body wasn't extended.
- catch_toe_tap_l/_r leaned out only a little over the line, so from the
  broadcast camera it read as a jog with the arms up, and the drag foot
  stayed under him.

Technique, from receiver coaching and the broadcast:
- Over the shoulder: run through it at full speed (the legs are the run's:
  an overlay); turn the head and the upper back to look the ball in over the
  inside shoulder; the hands go up late and away from the body, out in front
  of the face mask at the end of soft arms, pinkies together and palms to
  the sky (the basket), and the ball drops into them over the shoulder; the
  hands give down with it and bring it into the chest, then high and tight.
- The high point: a gather step, a one-foot takeoff, the free knee driven
  up; both arms swing up together and reach to full length so the hands meet
  the ball above and in front of the helmet at the top of the jump (the
  secure frame), the body long and a little arched; the ball pulled down to
  the chin on the way down, the landing on both feet absorbing.
- The toe tap: the upper body leans out over the white with both arms
  extended high and outside to the ball, the hips and feet staying inside;
  the catch on the inside foot, the outside foot taps down on its toes, the
  inside foot's toe drags in bounds behind him as he falls out.
"""

from __future__ import annotations

import math
from dataclasses import replace

from .actions import GRIP, IDLE, SPREAD, Clip, keyed, mirror_pose, mix, run_at, shift, with_upper
from .actions_m6 import bump
from .actions_m65 import DIAMOND_WRIST, PINKIES_WRIST, events, mirrored_right_tuck, ready_pose, sided, tuck_pose, upper
from .actions_p5 import MASK, carriage, run_upper, sternum, tuck
from .gait import FPS, GAITS, gait_pose, smoothstep
from .poses import Foot, Pose
from .transitions import Plant, Steps, _blend_foot, _hermite

RUN = GAITS["run"]
JOG = GAITS["jog"]


# --- Over the shoulder (overlay over the run) ---------------------------------------------------------


def over_shoulder(side: str) -> Clip:
    """The deep ball dropping in over his inside shoulder (authored on the
    left), keyed on the run's trunk so the hands land where they're keyed.

    The upper back turns toward the ball (about 30 degrees over the three
    upper spine bones) and the chest lifts; the hands come up late from the
    run's carriage, out and away in front of the face mask (~0.5 m ahead of
    the chest, at ~1.6 m) in the basket, the left a little higher and toward
    the ball's side; the ball drops in (secure), the hands give 8 cm down
    with it, bring it to the sternum by +0.15 s with the trunk turning back
    square, and tuck it by +0.3 s. The runtime turns the head to the ball
    (choreo.ts eyesFor) and puts the hands on it (catchReach)."""
    T = 0.8
    ts, tt = 9 / FPS, 18 / FPS
    m = sided(side)
    # Turned back toward the ball over the left shoulder: (flex, lean, twist) added per bone.
    turn = {"spine_02": (0, 2, 8), "spine_03": (0, 3, 11), "spine_04": (0, 2, 11)}

    def turned(p: Pose, k: float) -> Pose:
        for b, (fl, ab, tw) in turn.items():
            f0 = p.joints.get(b, (0, 0, 0))
            p.joints[b] = (f0[0] + fl * k, f0[1] + ab * k, f0[2] + tw * k)
        return p

    basket_wrist = {"hand_l": (-45, 0, 65), "hand_r": (-45, 0, -65)}
    # Late hands: up from the carriage past the chest, palms turning up.
    up = turned(run_upper({"l": (0.16, -0.40, 1.42), "r": (-0.06, -0.42, 1.40)}, {**SPREAD, **PINKIES_WRIST}, {"l": (0.45, 0.05, 1.05), "r": (-0.40, 0.05, 1.02)}, (-3, -3, -2)), 0.8)
    # Out and away: soft arms, the basket in front of the face mask, toward the ball's side.
    reach = turned(run_upper({"l": (0.15, -0.56, 1.64), "r": (0.00, -0.58, 1.60)}, {**SPREAD, **basket_wrist}, {"l": (0.45, -0.20, 1.20), "r": (-0.35, -0.22, 1.18)}, (-6, -5, -4)), 1.0)
    # The give: down and in with the ball, the fingers closing.
    give = turned(run_upper({"l": (0.12, -0.50, 1.56), "r": (-0.01, -0.52, 1.52)}, {**GRIP, **basket_wrist}, {"l": (0.45, -0.10, 1.15), "r": (-0.35, -0.12, 1.12)}, (-4, -3, -2)), 0.9)
    keys = [(0.0, carriage()), (ts - 0.17, m(up)), (ts - 0.05, m(reach)), (ts, m(reach)), (ts + 0.05, m(give)), (ts + 0.15, sternum()), (tt, tuck()), (T, tuck())]
    return Clip(f"catch_over_shoulder_{side}", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


# --- GO UP: the high point (full body) --------------------------------------------------------------


def high_point() -> Clip:
    """Out of the run at the right foot's touch-down (the gather, long and
    low), the left plants and drives him up with the right knee high; both
    arms swing up together and reach to full length, the hands meeting the
    ball above and in front of the helmet at the top of the jump (the secure
    frame), the body long and a touch arched; the ball pulled down to the
    chin on the way down, a two-foot landing absorbing it, and two steps back
    into the run (the left touch-down, phase 0). The legs, the flight and the
    footfalls are M6.5's (actions_m65.py); the arms and the trunk are new."""
    v0 = RUN.speed
    t_plant, t_off, t_land = 0.27, 0.42, 1.02
    t_apex = (t_off + t_land) / 2
    rise = 0.44  # hip rise from takeoff to the top (m)
    g = 8.0 * rise / (t_land - t_off) ** 2
    T = 49 / FPS

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
    ts = round(t_apex * FPS) / FPS
    tt = 1.0
    # Hand targets around a body standing at the origin, carried with the hips (below).
    # Both arms together, the whole way: low and loaded at the gather, swinging up through the face, full length at the top.
    top = 2.12
    load = upper({"l": (0.20, -0.18, 1.02), "r": (-0.20, -0.18, 1.02)}, {**SPREAD}, {"l": (0.5, 0.35, 0.9), "r": (-0.5, 0.35, 0.9)})
    swing = upper({"l": (0.14, -0.40, 1.66), "r": (-0.14, -0.40, 1.66)}, {**SPREAD, **DIAMOND_WRIST}, {"l": (0.55, -0.05, 1.25), "r": (-0.55, -0.05, 1.25)})
    reach = upper({"l": (0.065, -0.30, top), "r": (-0.065, -0.30, top)}, {**SPREAD, **DIAMOND_WRIST}, {"l": (0.45, -0.05, top - 0.40), "r": (-0.45, -0.05, top - 0.40)})
    secure = upper({"l": (0.055, -0.28, top - 0.04), "r": (-0.055, -0.28, top - 0.04)}, {**GRIP, **DIAMOND_WRIST}, {"l": (0.45, -0.05, top - 0.44), "r": (-0.45, -0.05, top - 0.44)})
    # Pulled down to the chin, elbows in, on the way down.
    chin = upper({"l": (0.07, -0.26, 1.50), "r": (-0.06, -0.25, 1.52)}, {**GRIP, "hand_l": (20, 0, -25), "hand_r": (-5, 0, 25)}, {"l": (0.32, 0.12, 1.12), "r": (-0.32, 0.12, 1.12)})

    def arms(t):
        """Upper-body key at t, authored around a body standing at the origin with its hips at `hip(t)`."""
        if t < 0.12:
            return None
        if t < t_plant:
            return mix(ready_pose(), load, smoothstep(0.12, t_plant, t))
        if t < ts - 0.1:
            return mix(load, swing, smoothstep(t_plant, t_off + 0.06, t)) if t < t_off + 0.06 else mix(swing, reach, smoothstep(t_off + 0.06, ts - 0.1, t))
        if t < ts:
            return reach
        if t < ts + 0.05:
            return mix(reach, secure, smoothstep(ts, ts + 0.05, t))
        if t < tt - 0.1:
            return mix(secure, chin, smoothstep(ts + 0.05, ts + 0.3, t))
        return mix(chin, tuck_pose(), smoothstep(tt - 0.1, 1.2, t))

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
        """In the air: the takeoff leg trails long under him, the right knee drives up, then both reach for the turf."""
        u = smoothstep(t_off, t_apex, t)
        w = smoothstep(t_off, t_off + 0.08, t) * (1 - smoothstep(t_land - 0.1, t_land, t))
        left = (-22 + 44 * smoothstep(t_apex - 0.05, t_land - 0.06, t), 30 + 15 * u - 30 * smoothstep(t_apex, t_land, t))
        right = (82 - 58 * smoothstep(t_apex, t_land - 0.06, t), 100 - 65 * smoothstep(t_apex, t_land - 0.06, t))
        out = {}
        for s, (a, k) in (("l", left), ("r", right)):
            base = steps.foot(s, t)
            base = replace(base, lift=base.lift + max(0.0, hip(t) - up_off) * 0.9, heel=base.heel + 40 * w)
            out[s] = replace(base, fk=(a, k, w)) if w > 1e-3 else base
        return out

    def pose(t):
        a = run_at(RUN.frames / 2 + t * FPS)
        b = run_at((t - T) * FPS)
        base = mix(a, b, smoothstep(t_off, t_land + 0.1, t))
        r = 1 - smoothstep(0.1, t_off, t) + smoothstep(t_land + 0.1, T, t)
        # Long at the top: the trunk's run lean comes out and it arches a little back as the arms reach (the hands over the helmet).
        ext = bump(t, t_off - 0.05, t_land - 0.05)
        for k, arch in (("spine_01", 2.0), ("spine_02", 4.0), ("spine_03", 4.0), ("spine_04", 3.0)):
            f, ab, tw = base.joints.get(k, (0, 0, 0))
            base.joints[k] = (f * (1 - ext) - arch * ext, ab * r, tw * r)
        e0, e1 = smoothstep(0.0, 0.12, t), smoothstep(1.3, T, t)
        up = a.pelvis["up"] * (1 - e0) + hip(t) * e0
        up = up * (1 - e1) + b.pelvis["up"] * e1
        base.pelvis.update({"up": up, "side": base.pelvis.get("side", 0.0) * r, "lateral": base.pelvis.get("lateral", 0.0) * r, "twist": base.pelvis.get("twist", 0.0) * r})
        # The trunk over the knee at the gather, upright at the top, folded over the knees as the landing absorbs.
        base.pelvis["flex"] = base.pelvis.get("flex", 0.0) * (1 - ext) + 8 * bump(t, 0.0, t_off) - 6 * ext + 24 * bump(t, t_land - 0.06, 1.42)
        up_arms = arms(t)
        if up_arms is not None:
            fingers = ("fingers", "index", "thumb", "hand_")
            base = with_upper(base, up_arms.hands, {**{k: v for k, v in base.joints.items() if not k.startswith(fingers)}, **{k: v for k, v in up_arms.joints.items() if k.startswith(fingers)}}, up_arms.elbow)
            dz = up - IDLE.pelvis.get("up", 0.0)
            base.hands = {s: (h[0], h[1], h[2] + dz) for s, h in base.hands.items()}
            base.elbow = {s: (e[0], e[1], e[2] + dz) for s, e in base.elbow.items()}
            k_in = smoothstep(0.12, 0.24, t)
            k_l = k_in * (1 - smoothstep(1.2, T, t))
            base.hands = {s: (*h[:3], k_l if s == "l" else k_in) for s, h in base.hands.items()}
            src = a if t < t_off else b
            arms_ = {s: replace(am, weight=am.weight * (1 - (k_l if s == "l" else k_in))) for s, am in src.arms.items()}
            base.arms = {s: am for s, am in arms_.items() if am.weight > 1e-3}
        # Eyes up to the ball over the top, then into the hands and back down the field.
        look = bump(t, 0.05, ts + 0.3)
        base.gaze = (6.0 - 50.0 * look, 0.0, 0.8)
        p = shift(base, 0.0, y(t))
        if t_off < t < t_land:
            p.feet = flight_feet(t, p)
        else:
            p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("catch_high_point", "transition", T, pose, travel, "loco_run", "loco_run", steps, to_phase=0.0, events=events(ts, tt), from_phase=0.5)


# --- The sideline: the toe tap (full body) ----------------------------------------------------------


def toe_tap_left() -> Clip:
    """Running up the sideline (the white on his left): the upper body leans
    well out over it (the pelvis tipped and the spine bent toward the line)
    with both arms long, high and outside to the ball, the hips and feet in;
    the catch on the right (inside) foot (frame 12), then the left taps down
    on its toes and the right's toe drags in bounds behind him, the foot
    pointed and trailing long, as he falls out; he gathers himself at a jog
    out of bounds (the jog's right touch-down, phase 0.5). The travel and the
    footfalls are M6.5's; the lean, the arms and the drag are new."""
    T = 1.0
    v0, v1 = RUN.speed, JOG.speed
    D = (v0 + v1) / 2 * T * 0.94

    def fwd(t):
        return _hermite(0.0, D, v0, v1, T, min(t, T))

    def side(t):
        return 0.18 * smoothstep(0.18, 0.5, t) + 0.42 * smoothstep(0.52, T, t)

    def travel(t):
        return (side(t), -fwd(t))

    ts, tt = 12 / FPS, 21 / FPS
    run0 = run_at(0)
    end = shift(gait_pose(JOG, JOG.frames / 2), side(T), -fwd(T))
    lean = {"spine_02": (-3, 18, 6), "spine_03": (-4, 22, 8), "spine_04": (-3, 16, 6)}
    # Both arms long to the ball, high and outside his left shoulder (over the white), thumbs in.
    reach = upper({"l": (0.86, -0.30, 1.66), "r": (0.62, -0.40, 1.74)}, {**SPREAD, "hand_l": (-30, 0, 15), "hand_r": (-30, 0, -15)}, {"l": (0.95, 0.15, 1.30), "r": (0.10, -0.15, 1.25)})
    reach.joints.update(lean)
    secure = upper({"l": (0.80, -0.28, 1.60), "r": (0.58, -0.36, 1.67)}, {**GRIP, "hand_l": (-20, 0, 15), "hand_r": (-20, 0, -15)}, {"l": (0.95, 0.15, 1.25), "r": (0.10, -0.15, 1.20)})
    secure.joints.update(lean)
    # Pulled in to the chest as the body comes back over the feet.
    pull = upper({"l": (0.20, -0.32, 1.36), "r": (0.04, -0.34, 1.38)}, {**GRIP, "hand_l": (10, 0, 20), "hand_r": (-10, 0, -20)}, {"l": (0.50, 0.10, 1.00), "r": (-0.30, 0.10, 1.00)})
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
        if t < ts + 0.2:
            return mix(secure, pull, smoothstep(ts + 0.06, ts + 0.2, t)), 1.0
        return mix(pull, tk, smoothstep(ts + 0.2, tt + 0.05, t)), 1.0

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
    drag0, drag1 = 0.46, 0.76

    def pose(t):
        base = mix(run_at(t * FPS * 0.8), gait_pose(JOG, JOG.frames / 2), smoothstep(0.55, T, t))
        b = bump(t, 0.12, 0.85)
        # The hips stay in and tip toward the line; the trunk leans out over it.
        base.pelvis.update({"side": 0.0, "lateral": base.pelvis.get("lateral", 0.0) - 22.0 * b, "up": base.pelvis.get("up", 0.0) - 0.06 * b})
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
                k = smoothstep(0.8, T, t)
                base.hands = {s: (*h[:3], 1 - k) for s, h in base.hands.items() if s == "l"} | {"r": base.hands["r"]}
                base.arms = {"l": replace(gait_pose(JOG, JOG.frames / 2).arms["l"], weight=k)}
        # Eyes out to the ball over the line, then the feet (the drag).
        base.gaze = (-18.0 * bump(t, 0.05, 0.5) + 25.0 * bump(t, 0.42, 0.8), 40.0 * bump(t, 0.0, 0.62), 0.8)
        p = shift(base, side(t), -fwd(t))
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        if drag0 <= t < drag1 + 0.1:
            # The drag: toes pointed, the ball of the foot scraping forward much slower than the body (it trails long behind him), then lifting away into the swing.
            u = smoothstep(drag0, drag1, t)
            dragged = replace(r_plant, y=r_plant.y - 0.32 * u, x=r_plant.x + 0.06 * u, heel=10 + 70 * smoothstep(drag0, drag0 + 0.1, t), lift=0.0)
            if t < drag1:
                p.feet["r"] = dragged
            else:
                p.feet["r"] = _blend_foot(dragged, p.feet["r"], smoothstep(drag1, drag1 + 0.1, t))
        return p

    contacts = steps.contacts(round(T * FPS))
    return Clip("catch_toe_tap_l", "transition", T, pose, travel, "loco_run", "loco_jog", contacts=contacts, events={**events(ts, tt), "tap": round(0.52 * FPS)}, to_phase=0.5, from_phase=0.0)


# --- The ball in the left arm (built in code from our own carry clips) -------------------------------


def carry_left() -> list[Clip]:
    """The carrier's gaits and the carry overlay with the ball in the LEFT
    arm (passing round 6: carry it in the arm away from the nearest defender,
    toward the sideline, as runners are coached). Built here from the M6.5
    carry gaits (actions_m65_carrier.py), not keyed again: each frame is the
    right-arm gait half a cycle on, mirrored. Mirroring swaps the legs as well
    as the arms; half a cycle swaps them back, so the left foot plants on the
    same phase as in the right-arm gait (the runtime blends the two families
    on one shared phase), the left arm carries the ball and the right arm
    swings opposite the left leg."""
    from .actions import carry, mirrored
    from .actions_m6 import gait_clip
    from .actions_m65_carrier import CARRY, _tuck_extra

    out = []
    for n, g in CARRY.items():
        base = gait_clip(n, g, _tuck_extra)
        T = g.frames / FPS
        h = T / 2

        def pose(t, b=base, T=T, h=h):
            return mirror_pose(b._pose((t + h) % T))

        out.append(Clip(f"{n}_l", "locomotion", T, pose, loop=True, contacts=base.contacts, speed=g.speed, loco_dir=(-g.dir[0], g.dir[1])))
    out.append(mirrored(carry(), "ovl_carry_l"))
    return out


def p6_clips() -> list[Clip]:
    tp = toe_tap_left()
    return [over_shoulder("l"), over_shoulder("r"), high_point(), tp, mirrored_right_tuck(tp, "catch_toe_tap_r", 12 / FPS, 21 / FPS, to_phase=0.0), *carry_left()]

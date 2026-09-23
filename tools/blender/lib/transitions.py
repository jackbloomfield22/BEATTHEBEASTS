"""Transition clips (M4.5): the moves between the loops. Keyed here, like
every clip (CLAUDE.md rule 6).

- huddle_break: the clap and stand-up out of the huddle.
- set_<stance>: from standing into each stance, a foot at a time, hands last.
- getoff_<stance>: the snap get-off: two drive steps out of the stance that
  land exactly on the run cycle's first frame at run speed, so the runtime
  hands over to locomotion without a pop.
- stop_<gait>: from each gait to standing over two decelerating steps.

Authoring is in world space: planted feet stay where they land and the body
travels. The exporter then subtracts the travel so the clip plays in place
like the loops (the runtime moves the player by the `travel` curve written
to anims.json), which is also what the foot-slide gate checks against.

Timings: a lineman's first step off the snap takes ~0.2-0.25 s and the
first two steps ~0.5-0.6 s; skill players are quicker. Deceleration from a
sprint takes ~2 steps over ~1.2 s (sports science stopping-distance norms);
a jog stops in about a stride.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .gait import FPS, GAITS, gait_pose, smoothstep, swing_leg
from .poses import ARMS_DOWN, RELAXED, STANCES, Arm, Foot, Pose


def _lerp(a, b, t):
    return a + (b - a) * t


def _hermite(p0, p1, v0, v1, T, t):
    """Cubic position at time t in [0, T] from p0 (velocity v0) to p1 (v1)."""
    s = t / T
    s2, s3 = s * s, s * s * s
    return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * v0 * T + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * v1 * T


# --- Pose blending -----------------------------------------------------------

REST_ARM = Arm(flex=4, elbow=16, abd=10, inward=0.1)


def _blend_foot(a: Foot, b: Foot, t: float) -> Foot:
    fa = a.fk or (0.0, 0.0, 0.0)
    fb = b.fk or (0.0, 0.0, 0.0)
    fk = tuple(_lerp(x, y, t) for x, y in zip(fa, fb))
    return Foot(
        x=_lerp(a.x, b.x, t), y=_lerp(a.y, b.y, t), heel=_lerp(a.heel, b.heel, t), out=_lerp(a.out, b.out, t),
        lift=_lerp(a.lift, b.lift, t), fk=fk if fk[2] > 1e-4 else None,
    )


def _blend_arm(a: Arm | None, b: Arm | None, t: float) -> Arm | None:
    if a is None and b is None:
        return None
    # A pose without aimed arms keys them as joints; the aim fades in or out
    # over it (Arm.weight).
    if a is None:
        return replace(b, weight=b.weight * t)
    if b is None:
        return replace(a, weight=a.weight * (1 - t))
    return Arm(*(_lerp(x, y, t) for x, y in zip((a.flex, a.elbow, a.abd, a.inward, a.clavicle, a.weight), (b.flex, b.elbow, b.abd, b.inward, b.clavicle, b.weight))))


def blend(a: Pose, b: Pose, t: float) -> Pose:
    """A pose between two others (t 0..1). Missing keys count as rest."""
    t = min(1.0, max(0.0, t))
    pel = {k: _lerp(a.pelvis.get(k, 0.0), b.pelvis.get(k, 0.0), t) for k in set(a.pelvis) | set(b.pelvis)}
    ja, jb = {**ARMS_DOWN, **a.joints}, {**ARMS_DOWN, **b.joints}
    joints = {k: tuple(_lerp(x, y, t) for x, y in zip(ja.get(k, (0, 0, 0)), jb.get(k, (0, 0, 0)))) for k in set(ja) | set(jb)}
    feet = {s: _blend_foot(a.feet[s], b.feet[s], t) for s in "lr"}
    hands = {}
    for s in set(a.hands) | set(b.hands):
        ha, hb = a.hands.get(s), b.hands.get(s)
        pa = ha[:3] if ha else hb[:3]
        pb = hb[:3] if hb else ha[:3]
        wa = (ha[3] if len(ha) > 3 else 1.0) if ha else 0.0
        wb = (hb[3] if len(hb) > 3 else 1.0) if hb else 0.0
        w = _lerp(wa, wb, t)
        if w > 1e-3:
            hands[s] = (*(_lerp(x, y, t) for x, y in zip(pa, pb)), w)
    arms = {}
    for s in "lr":
        arm = _blend_arm(a.arms.get(s), b.arms.get(s), t)
        if arm is not None and arm.weight > 1e-3:
            arms[s] = arm
    ga = (*a.gaze, *((0.45,) if len(a.gaze) < 3 else ()), *((1.0,) if len(a.gaze) < 4 else ())) if a.gaze else None
    gb = (*b.gaze, *((0.45,) if len(b.gaze) < 3 else ()), *((1.0,) if len(b.gaze) < 4 else ())) if b.gaze else None
    if ga or gb:
        ga = ga or (*gb[:3], 0.0)
        gb = gb or (*ga[:3], 0.0)
        gaze = tuple(_lerp(x, y, t) for x, y in zip(ga, gb))
    else:
        gaze = None
    return Pose(pelvis=pel, joints=joints, feet=feet, hands=hands, arms=arms, gaze=gaze)


def translate(p: Pose, fwd: float) -> Pose:
    """Move a pose `fwd` meters forward (-Y) in the field."""
    q = copy.deepcopy(p)
    q.pelvis["forward"] = q.pelvis.get("forward", 0.0) + fwd
    for s in "lr":
        q.feet[s].y -= fwd
    q.hands = {s: (h[0], h[1] - fwd, *h[2:]) for s, h in q.hands.items()}
    return q


def with_foot(p: Pose, s: str, f: Foot) -> Pose:
    q = copy.deepcopy(p)
    q.feet[s] = f
    return q


def step(a: Foot, b: Foot, s: float, height: float) -> Foot:
    """A foot on its way from a to b (s 0..1), lifted along an arc."""
    e = smoothstep(0.0, 1.0, s)
    f = _blend_foot(a, b, e)
    f.lift += height * math.sin(math.pi * min(1.0, max(0.0, s))) if 0 < s < 1 else 0.0
    return f


# --- Footsteps -------------------------------------------------------------------


class Plant:
    """One foot on the ground in world space, from `land` to `lift` (s).
    `contact` False marks a swing target that isn't a plant (the clip ends
    with the foot still in the air, handing over to a gait mid-swing)."""

    def __init__(self, side: str, land: float, lift: float, foot: Foot, contact: bool = True, roll: float = 0.0):
        self.side, self.land, self.lift, self.foot, self.contact, self.roll = side, land, lift, foot, contact, roll


class Steps:
    """A footstep plan: planted feet stay put (no slide by construction) and
    a foot between plants swings on an arc. `before[s](t)` places a foot that
    starts the clip in the air (mid-swing out of a gait)."""

    def __init__(self, plants: list[Plant], before: dict | None = None, height: float = 0.08):
        self.plants = {s: sorted((p for p in plants if p.side == s), key=lambda p: p.land) for s in "lr"}
        self.before = before or {}
        self.height = height

    def foot(self, s: str, t: float) -> Foot:
        ps = self.plants[s]
        first = ps[0]
        if t < first.land:
            if s in self.before:
                # Out of a gait's swing: its own path, easing onto the plan's
                # first plant by touch-down.
                return _blend_foot(self.before[s](t), first.foot, smoothstep(0.0, first.land, t))
            return copy.deepcopy(first.foot)
        for i, p in enumerate(ps):
            nxt = ps[i + 1] if i + 1 < len(ps) else None
            if t < p.lift or nxt is None:
                f = copy.deepcopy(p.foot)
                if f.heel < 0 and p.lift < math.inf:
                    # Heel strike: the toes come down (heel pivot) early in the contact.
                    f.heel *= 1.0 - smoothstep(p.land, p.land + 0.25 * (p.lift - p.land), t)
                if p.roll and p.lift < math.inf:
                    # Up onto the ball before it leaves (ball pivot: no slide).
                    f.heel += p.roll * smoothstep(p.land + 0.55 * (p.lift - p.land), p.lift, min(t, p.lift))
                return f
            if t < nxt.land:
                a = copy.deepcopy(p.foot)
                a.heel += p.roll
                span = nxt.land - p.lift
                h = self.height * min(1.0, span / 0.3)
                u = (t - p.lift) / span
                f = step(a, nxt.foot, u, h)
                # A running swing takes the gaits' leg shape (heel recovery,
                # knee drive, pull-back), from the actual hip, so the foot
                # never trails out of reach behind a moving body.
                v = abs(nxt.foot.y - a.y) / span / 2
                if a.fk is None and nxt.foot.fk is None and v > 1.8:
                    g = min((GAITS[n] for n in ("jog", "run", "sprint")), key=lambda g: abs(g.speed - v))
                    w = g.fk * min(1.0, (v - 1.8) / 1.2) * smoothstep(0.0, 0.2, u) * (1 - smoothstep(0.8, 1.0, u))
                    if w > 0:
                        f.fk = (*swing_leg(g, u), w)
                return f
        return copy.deepcopy(ps[-1].foot)

    def contacts(self, frames: int) -> dict:
        """Planted frames per foot as [start, end) runs, for the slide gate
        and the runtime's foot lock."""
        out = {}
        for s in "lr":
            fs = [f for f in range(frames + 1) if any(p.contact and p.land - 1e-6 <= f / FPS < p.lift for p in self.plants[s])]
            runs, cur = [], []
            for f in fs:
                if cur and f != cur[-1] + 1:
                    runs.append([cur[0], cur[-1] + 1])
                    cur = []
                cur.append(f)
            if cur:
                runs.append([cur[0], cur[-1] + 1])
            out[s] = [[a, min(b, frames)] for a, b in runs if a < frames]
        return out


def _phase_of(landings: list[tuple[float, float]]):
    """Gait phase over time from the plan's landings [(t, phase)], linear in
    between, so a gait's pelvis and arm swing keep time with the steps."""

    def ph(t):
        for (t0, p0), (t1, p1) in zip(landings, landings[1:]):
            if t <= t1:
                return p0 + (p1 - p0) * (t - t0) / (t1 - t0)
        (t0, p0), (t1, p1) = landings[-2], landings[-1]
        return p1 + (p1 - p0) * (t - t1) / (t1 - t0)

    return ph


# --- Clips ----------------------------------------------------------------------


class Transition:
    """A keyed transition: pose_world(time) plus the forward travel curve."""

    def __init__(self, name: str, T: float, pose_world, travel, frm: str, to: str, steps: Steps):
        self.name, self.frm, self.to = name, frm, to
        self.frames = round(T * FPS)
        self._pose, self._travel = pose_world, travel
        self.contacts = steps.contacts(self.frames)

    def travel(self, f: int) -> float:
        return self._travel(f / FPS)

    def pose(self, f: int) -> Pose:
        """In place: the travel so far is taken back out of the body."""
        return translate(self._pose(f / FPS), -self._travel(f / FPS))


def _stance(name: str) -> Pose:
    return copy.deepcopy(STANCES[name])


def _still(t):
    return 0.0


def huddle_break() -> Transition:
    """Hands off the knees, the clap (~0.45 s) and up to a ready stand,
    stepping out of the huddle's wide base into the idle stance."""
    T = 1.3
    huddle, idle = _stance("huddle"), _stance("idle")
    clap = blend(huddle, idle, 0.45)
    clap.hands = {"l": (0.02, -0.34, 1.28, 1.0), "r": (-0.02, -0.34, 1.28, 1.0)}
    clap.joints.update(RELAXED)
    clap.gaze = (6.0, 0.0, 0.45, 1.0)
    steps = Steps([
        Plant("l", -1, 0.55, huddle.feet["l"]), Plant("l", 0.8, math.inf, idle.feet["l"]),
        Plant("r", -1, 0.8, huddle.feet["r"]), Plant("r", 1.05, math.inf, idle.feet["r"]),
    ], height=0.04)

    def pose(t):
        p = blend(huddle, clap, smoothstep(0.0, 0.45, t)) if t < 0.45 else blend(clap, idle, smoothstep(0.55, T, t))
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Transition("huddle_break", T, pose, _still, "stance_huddle", "stance_idle", steps)


def set_stance(stance: str) -> Transition:
    """From standing into a stance: the left foot sets, then the right,
    the body sinks, and the hands go down last."""
    down = stance in ("ol_3pt", "dl_3pt", "dl_4pt")
    T = 1.0 if down else 0.8
    idle, st = _stance("idle"), _stance(stance)
    t1, t2 = 0.3 * T, 0.6 * T
    steps = Steps([
        Plant("l", -1, 0.02, idle.feet["l"]), Plant("l", t1, math.inf, st.feet["l"]),
        Plant("r", -1, t1 + 0.02, idle.feet["r"]), Plant("r", t2, math.inf, st.feet["r"]),
    ], height=0.05)

    def pose(t):
        p = blend(idle, st, smoothstep(0.0, T * (0.92 if down else 0.85), t))
        # Hands reach the turf (or the thighs) in the last part.
        if st.hands:
            hw = smoothstep(0.55 * T, T, t)
            p.hands = {s: (*h[:3], hw) for s, h in st.hands.items()}
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Transition(f"set_{stance}", T, pose, _still, "stance_idle", f"stance_{stance}", steps)


def getoff(stance: str) -> Transition:
    """The snap: the back (right) foot drives through first while the front
    foot pushes, then the front foot comes through and lands on the run
    cycle's first frame (left touch-down) at run speed."""
    line = stance in ("ol_3pt", "dl_3pt", "dl_4pt")
    g = GAITS["run"]
    cyc = g.frames / FPS
    T = 0.62 if line else 0.5
    t1 = 0.4 * T  # the first step lands
    st = _stance(stance)
    run0 = gait_pose(g, 0)
    # Where the run's left foot touches down, 1.25 m (line) / 1.4 m (skill) out.
    land = 1.25 if line else 1.4
    target = translate(run0, land + run0.feet["l"].y)
    x0 = st.pelvis.get("forward", 0.0)
    fwd_end = target.pelvis["forward"] - x0

    def travel(t):
        return _hermite(0.0, fwd_end, 0.0, g.speed, T, min(t, T))

    # The right foot lifts from the run's own swing timing so the hand-over
    # is seamless: at run frame 0 it has been in the air (0.5 - duty) cycles.
    r_lift = T - (0.5 - g.duty) * cyc
    mid = 0.5 * (t1 + r_lift)
    # Accelerating, the foot plants a little behind the body's mid-stance line.
    r1 = Foot(x=-0.10, y=-(x0 + travel(mid)) - 0.11 + 0.12, heel=18.0, out=4.0)
    steps = Steps([
        Plant("l", -1, t1 - 0.03, st.feet["l"], roll=12.0),
        Plant("l", T, math.inf, target.feet["l"]),
        Plant("r", -1, 0.07, st.feet["r"], roll=8.0),
        Plant("r", t1, r_lift, r1, roll=16.0),
        Plant("r", T, math.inf, target.feet["r"], contact=False),
    ], height=0.14)

    first = blend(st, target, 0.45)
    first.hands = {}
    first.pelvis["flex"] = 55.0 if line else 45.0
    first.pelvis["up"] = _lerp(st.pelvis.get("up", 0.0), target.pelvis["up"], 0.35 if line else 0.5)
    first.arms = {"l": Arm(flex=55, elbow=85, abd=12, inward=0.1), "r": Arm(flex=-45, elbow=80, abd=12, inward=0.05)}
    first.joints.update({k: v for k, v in target.joints.items() if k.startswith(("index_", "fingers_", "thumb_"))})

    def pose(t):
        # Linemen keep their pads low through the get-off and rise late.
        rise = smoothstep(t1, T, t) ** (1.8 if line else 1.0)
        p = blend(st, first, smoothstep(0.0, t1, t)) if t < t1 else blend(first, target, rise)
        p.pelvis["forward"] = x0 + travel(t)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        p.hands = {s: (*h[:3], 1.0 - smoothstep(0.0, 0.1, t)) for s, h in st.hands.items()} if t < 0.1 else {}
        return p

    return Transition(f"getoff_{stance}", T, pose, travel, f"stance_{stance}", "loco_run", steps)


# Stopping: a constant deceleration (the Hermite from v to 0 with distance
# v*T/2 has linear velocity). ~5 m/s^2 from a sprint is inside what trained
# field athletes manage (braking studies report 4-7 m/s^2 over the last
# steps), so a sprinter needs ~1.7 s and ~7 m and four or five steps.
STOP_T = {"walk": 0.9, "jog": 1.1, "run": 1.4, "sprint": 1.7}


def stop(gait: str) -> Transition:
    """From the gait (at its left touch-down) to standing: decelerating steps
    that plant ahead of the body, then the feet come together under it."""
    g = GAITS[gait]
    T = STOP_T[gait]
    v0 = g.speed
    cyc = g.frames / FPS
    idle = _stance("idle")
    dist = v0 * T * 0.5

    def travel(t):
        return _hermite(0.0, dist, v0, 0.0, T, min(t, T))

    def speed(t):
        return v0 * max(0.0, 1.0 - t / T)

    start = gait_pose(g, 0)
    end = translate(idle, dist)
    plants = []
    landings = [(0.0, 0.0)]
    # The left foot is down at t = 0 where the gait put it; the right lands
    # half a cycle later. Each step after takes a little longer (cadence
    # drops as the body slows) and stays down longer.
    side, t_land, k = "l", 0.0, 0
    y = start.feet["l"].y
    contact0 = g.duty * cyc
    while True:
        v = speed(t_land)
        interval = 0.5 * cyc * (1.0 + 0.35 * t_land / T)
        # Down long enough to take the body over the foot, never less than the gait's.
        c = min(max(contact0, 0.7 / max(v, 0.3)), 1.4 * interval)
        # Up onto the ball before toe-off, less so as the push fades.
        roll = 30.0 * min(1.0, v / 3.5)
        if k == 0:
            foot = copy.deepcopy(start.feet["l"])
        else:
            # The gaits put the ball right under the hip line at mid-stance
            # (gait.py); braking plants it a few cm further ahead.
            ahead = 0.03 + 0.05 * v / 8.5
            foot = Foot(x=g.width * (1 if side == "l" else -1), y=-travel(t_land + 0.5 * c) - ahead, heel=-8.0 if gait == "walk" else 0.0, out=5.0)
        plants.append(Plant(side, t_land, t_land + c, foot, roll=roll))
        k += 1
        side = "r" if side == "l" else "l"
        t_land += interval
        landings.append((t_land, 0.5 * k))
        if speed(t_land) < 1.2 or t_land > T - 0.3:
            break
    # The last two steps: into the idle stance under the stopping body.
    last = side
    other = "r" if last == "l" else "l"
    t_last = t_land
    t_other = min(T - 0.06, t_last + max(0.22, 0.5 * cyc))
    plants.append(Plant(last, t_last, math.inf, end.feet[last]))
    plants.append(Plant(other, t_other, math.inf, end.feet[other]))
    landings.append((t_other, 0.5 * (k + 1)))
    # Feet that step again lift when their contact ends; the plan's first
    # plants per side end the swing from the gait.
    before = {}
    if g.duty > 0.5:
        # Walking: the right foot is still down at the left's touch-down.
        plants.append(Plant("r", -0.1, (g.duty - 0.5) * cyc, start.feet["r"], roll=25.0))
    else:
        before["r"] = lambda t: translate(gait_pose(g, t * FPS), -v0 * t).feet["r"]
    steps = Steps(plants, before=before, height=0.06 + 0.012 * v0)
    phase = _phase_of(landings)

    def pose(t):
        # The gait keeps time with the planned steps (pelvis, trunk, arms)
        # and fades into the idle stance as the body slows.
        gp = gait_pose(g, (phase(t) % 1.0) * g.frames)
        # The arm swing dies down with the speed, and the elbows open only
        # once the swing has gone (lerping a swinging arm straight to a
        # hanging one reaches it out in front, stiff).
        a = 1.0 - smoothstep(0.0, 0.8 * T, t)
        for s_, arm in gp.arms.items():
            rest = idle.arms[s_]
            gp.arms[s_] = replace(arm, flex=_lerp(rest.flex, arm.flex, a), elbow=_lerp(rest.elbow, arm.elbow, math.sqrt(a)), clavicle=arm.clavicle * a)
        p = blend(gp, idle, smoothstep(0.15 * T, 0.95 * T, t))
        # Sit back into the stop: less lean and a lower pelvis while braking.
        b = math.sin(math.pi * min(1.0, t / T)) * min(1.0, max(0.4, v0 / 5.8))
        p.pelvis["flex"] = p.pelvis.get("flex", 0.0) - 8.0 * b
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.04 * b
        p.pelvis["forward"] = travel(t) + idle.pelvis.get("forward", 0.0) * smoothstep(0.6 * T, T, t)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Transition(f"stop_{gait}", T, pose, travel, f"loco_{gait}", "stance_idle", steps)


SET_STANCES = ["ol_3pt", "dl_3pt", "dl_4pt", "wr_2pt", "lb_ready", "db_ready", "rb_2pt", "qb_center", "qb_gun"]
GETOFF_STANCES = ["ol_3pt", "dl_3pt", "dl_4pt", "wr_2pt", "lb_ready", "db_ready", "rb_2pt"]


def transitions() -> list[Transition]:
    return [huddle_break(), *(set_stance(s) for s in SET_STANCES), *(getoff(s) for s in GETOFF_STANCES), *(stop(g) for g in ("walk", "jog", "run", "sprint"))]

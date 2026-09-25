"""M6 locker-room signature clips: the drafted player's hologram in the
draft room plays one on a loop in front of his locker. Keyed here
(CLAUDE.md rule 6), and mostly built from our own clips: stances, the
get-offs, the gaits, the stops, the juke, the drop and throw, the drive
block and the kick-slide.

Each plays IN PLACE (the root never moves) and loops: the last frame is
the first. Where the play runs (receiver, back, tight end), the hips stay
over the root and the ground runs under the feet like a treadmill; the
quarterback and the lineman really move and come back to their spot.
Play them raw on a loop (no foot lock). ~2.8-3.5 s each.

- sig_qb: shotgun stance, the snap, a three-step drop, hitch-free throw
  (release frame 33), walk back up to the spot and set again.
- sig_wr: two-point stance, release off the line, a stride, a look back
  over the inside shoulder and the catch over it (frame 28), tuck,
  stop, back into the stance.
- sig_rb: two-point stance, burst off the ball, a jab cut (the juke) and
  burst the other way, stop, back into the stance.
- sig_te: three-point stance, fire out and strike the block (frame 9),
  drive, release off it into the route, stop, back into the stance.
- sig_ol: the two-point (hands on the thighs), settle into the
  three-point, a kick-slide and punch (frame 50), then walk back up to
  the spot into the two-point.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .actions import GRIP, HOLD_ELBOW, IDLE, SPREAD, STANCES, TUCK_ELBOW_R, TUCK_R, Clip, carry_pose, hands_of, keyed, mix, qb_drop, qb_throw, run_at, shift, with_upper
from .actions_m6 import PUNCH, READY, STRIKE_WRISTS, bump, hips_xy, with_arms
from .actions_m6_line import DRIVE, fire_drive
from .gait import FPS, GAITS, gait_pose, smoothstep
from .poses import Arm, Foot, Pose
from .transitions import Plant, Steps, _hermite, getoff, set_stance, stop

RUN = GAITS["run"]
_REST_HIPS = (0.0, 0.01)


class Chain:
    """Segments played back to back in world space. Each segment's pose
    function is authored in its own frame; the chain places it so its
    hips start where the last one's ended (the segments hand over on
    matching poses)."""

    def __init__(self) -> None:
        self.segs: list[dict] = []
        self.frames = 0

    def add(self, frames: int, pose, contacts: dict | None = None) -> "Chain":
        off = (0.0, 0.0)
        if self.segs:
            prev = self.segs[-1]
            ex, ey = hips_xy(self._world(prev, prev["frames"] / FPS))
            sx, sy = hips_xy(pose(0.0))
            off = (ex - sx, ey - sy)
        self.segs.append({"f0": self.frames, "frames": frames, "pose": pose, "off": off, "contacts": contacts or {"l": [[0, frames]], "r": [[0, frames]]}})
        self.frames += frames
        return self

    def add_clip(self, c) -> "Chain":
        """A Clip or a Transition (their world pose and footfalls)."""
        return self.add(c.frames, c._pose, c.contacts)

    def add_run(self, f0: float, frames: int) -> "Chain":
        """The run cycle from gait frame f0, travelling at run speed."""
        v = RUN.speed

        def pose(t):
            return shift(run_at(f0 + t * FPS), 0.0, -v * t)

        planted = {s: [] for s in "lr"}
        for f in range(frames):
            ph = ((f0 + f) / RUN.frames) % 1.0
            for s, o in (("l", 0.0), ("r", 0.5)):
                if (ph + o) % 1.0 < RUN.duty:
                    planted[s].append(f)
        return self.add(frames, pose, {s: _runs(fs, frames) for s, fs in planted.items()})

    def add_hold(self, frames: int, p: Pose) -> "Chain":
        return self.add(frames, lambda t: copy.deepcopy(p))

    @staticmethod
    def _world(seg, lt):
        return shift(seg["pose"](lt), *seg["off"])

    def seg_at(self, t: float):
        f = t * FPS
        for s in self.segs:
            if f < s["f0"] + s["frames"] - 1e-6:
                return s
        return self.segs[-1]

    def world(self, t: float) -> Pose:
        s = self.seg_at(t)
        return self._world(s, min(t - s["f0"] / FPS, s["frames"] / FPS))

    def contacts(self) -> dict:
        out = {}
        for side in "lr":
            runs = []
            for s in self.segs:
                for a, b in s["contacts"][side]:
                    a, b = a + s["f0"], b + s["f0"]
                    if runs and runs[-1][1] >= a:
                        runs[-1][1] = max(runs[-1][1], b)
                    else:
                        runs.append([a, b])
            out[side] = [[a, min(b, self.frames)] for a, b in runs if a < self.frames]
        return out

    @property
    def T(self) -> float:
        return self.frames / FPS


def _runs(frames_on: list[int], total: int) -> list[list[int]]:
    runs, cur = [], []
    for f in frames_on:
        if cur and f != cur[-1] + 1:
            runs.append([cur[0], cur[-1] + 1])
            cur = []
        cur.append(f)
    if cur:
        runs.append([cur[0], cur[-1] + 1])
    return runs


def _body_shift(p: Pose) -> tuple[float, float]:
    x, y = hips_xy(p)
    return x - _REST_HIPS[0], y - _REST_HIPS[1]


def local_upper(p: Pose, src: Pose, w: float = 1.0) -> Pose:
    """Lay `src`'s hands and elbow poles (authored around a body standing at
    the origin) over `p`, moved to where p's hips are, IK weight `w`."""
    dx, dy = _body_shift(p)
    q = copy.deepcopy(p)
    q.hands = {s: (h[0] + dx, h[1] + dy, h[2], (h[3] if len(h) > 3 else 1.0) * w) for s, h in src.hands.items()}
    q.elbow = {s: (e[0] + dx, e[1] + dy, e[2]) for s, e in src.elbow.items()}
    if w >= 0.999:
        for s in src.hands:
            q.arms.pop(s, None)
    q.joints.update({k: v for k, v in src.joints.items() if k.startswith(("fingers", "index", "thumb", "hand_"))})
    return q


def sig_clip(name: str, ch: Chain, fx=None, treadmill: bool = True, events=None) -> Clip:
    """The chain as an in-place looping clip. Treadmill: the hips'
    travel over the ground is taken back out (the ground moves)."""
    h0 = hips_xy(ch.world(0.0))

    def raw(t):
        p = ch.world(t)
        return fx(p, t) if fx else p

    # The loop seam: the segments start with the heels a little rolled
    # (a plant's roll begins before the clip does) and a stance's gaze; the
    # difference to the last frame fades out over the first 0.2 s, so the
    # loop closes. Heels pivot on the ball: planted feet don't move.
    first, last = raw(0.0), raw(ch.T)

    def pose(t):
        p = raw(t)
        k = 1.0 - smoothstep(0.0, 0.2, t)
        if k > 0.0:
            for s_ in "lr":
                p.feet[s_] = replace(p.feet[s_], heel=p.feet[s_].heel + k * (last.feet[s_].heel - first.feet[s_].heel))
            if p.gaze and first.gaze and last.gaze:
                g0, g1 = (*first.gaze, 0.45, 1.0)[:4], (*last.gaze, 0.45, 1.0)[:4]
                gp = (*p.gaze, 0.45, 1.0)[:4]
                p.gaze = tuple(gp[i] + k * (g1[i] - g0[i]) for i in range(4))
        return p

    def travel(t):
        if not treadmill:
            return (0.0, 0.0)
        x, y = hips_xy(ch.world(t))
        return (x - h0[0], y - h0[1])

    return Clip(name, "signature", ch.T, pose, travel, loop=True, contacts=ch.contacts(), events=events or {})


# --- Quarterback ---------------------------------------------------------------------


def sig_qb() -> Clip:
    """Shotgun: the snap, a three-step drop, the throw, then walk back up
    to the spot (three steps) and set in the gun again. Really moves."""
    drop, throw = qb_drop(3), qb_throw()
    ch = Chain().add_clip(drop).add_clip(throw)
    # Walk back up: from the throw's finish (idle, 1.44 m behind the spot)
    # to the shotgun stance on the spot.
    fin = ch.world(ch.T)
    T = 1.2
    gun = STANCES["qb_gun"]
    # Author the walk in its own frame (the finish's idle at the origin):
    # the spot is where the drop started, i.e. the gun stance there.
    start = copy.deepcopy(IDLE)
    fx0, fy0 = hips_xy(fin)
    sx, sy = hips_xy(drop._pose(0.0))
    ix, iy = hips_xy(start)
    gx, gy = hips_xy(gun)
    ex, ey = (sx - fx0 + ix) - gx, (sy - fy0 + iy) - gy
    end = shift(copy.deepcopy(gun), ex, ey)
    walk_w = GAITS["walk"]
    mid_y = (start.feet["r"].y + end.feet["r"].y) / 2
    steps = Steps([
        Plant("r", -1, 0.12, start.feet["r"], roll=20.0), Plant("r", 0.4, 0.62, Foot(-0.14, mid_y, heel=-8, out=8), roll=22.0), Plant("r", 1.0, math.inf, end.feet["r"]),
        Plant("l", -1, 0.36, start.feet["l"], roll=20.0), Plant("l", 0.8, math.inf, end.feet["l"]),
    ], height=0.07)

    def walk(t):
        # The hips travel on an eased curve; the body walks (the gait's
        # pelvis and arms) and sets into the gun as the last foot lands.
        e = _hermite(0.0, 1.0, 0.0, 0.0, T * 0.92, min(t, T * 0.92))
        ph = (t / 0.62) % 1.0
        wp = gait_pose(walk_w, ph * walk_w.frames)
        p = mix(mix(start, wp, bump(t, 0.0, 1.0) * 0.6), end, smoothstep(0.55, T, t))
        for k in ("forward", "side"):
            p.pelvis[k] = start.pelvis.get(k, 0.0) * (1 - e) + end.pelvis.get(k, 0.0) * e
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        if t > 0.7:
            k = smoothstep(0.7, T, t)
            p.hands = {s: (*h[:3], k) for s, h in end.hands.items()}
            # The drop takes the snap with these elbow poles (actions.HOLD_ELBOW).
            p.elbow = {s: (e[0] + ex, e[1] + ey, e[2]) for s, e in HOLD_ELBOW.items()}
            p.joints.update({k_: v for k_, v in gun.joints.items() if k_.startswith(("fingers", "index", "thumb", "hand_"))} if k > 0.5 else {})
        return p

    ch.add(round(T * FPS), walk, steps.contacts(round(T * FPS)))
    return sig_clip("sig_qb", ch, treadmill=False, events={"release": drop.frames + 11})


# --- Receiver ---------------------------------------------------------------------------


def sig_wr() -> Clip:
    """Off the line, a stride, the catch over the inside shoulder, tuck,
    stop, and back into the stance."""
    go, st_, back = getoff("wr_2pt"), stop("run", T=1.0, name="sig_stop"), set_stance("wr_2pt")
    ch = Chain().add_clip(go).add_run(0, RUN.frames).add_clip(st_).add_clip(back)
    t_run = go.frames / FPS
    t_stop = t_run + RUN.frames / FPS
    t_set = t_stop + st_.frames / FPS
    # The over-the-shoulder basket: hands up in front of the face, pinkies
    # together, palms to the sky, arms reaching; eyes back over the left shoulder.
    reach = with_upper(IDLE, {"l": (0.05, -0.42, 1.60), "r": (-0.06, -0.42, 1.58)}, {**SPREAD, "hand_l": (-30, 0, 70), "hand_r": (-30, 0, -70)}, {"l": (0.5, -0.1, 1.2), "r": (-0.5, -0.1, 1.2)})
    secure = with_upper(IDLE, {"l": (0.04, -0.36, 1.48), "r": (-0.05, -0.36, 1.46)}, {**GRIP, "hand_l": (-20, 0, 60), "hand_r": (-20, 0, -60)}, {"l": (0.5, 0.0, 1.1), "r": (-0.5, 0.0, 1.1)})
    tuck = carry_pose()
    tc = t_run + 0.45  # the catch

    def fx(p, t):
        if t_run + 0.1 < t < t_set + 0.4:
            if t < tc - 0.15:
                k = smoothstep(t_run + 0.1, tc - 0.15, t)
                p = local_upper(p, reach, k)
            elif t < tc:
                p = local_upper(p, reach)
            elif t < tc + 0.18:
                p = local_upper(p, mix(secure, tuck, smoothstep(tc + 0.04, tc + 0.18, t)))
            elif t < t_set:
                p = local_upper(p, tuck)
            else:
                p = local_upper(p, tuck, 1.0 - smoothstep(t_set, t_set + 0.4, t))
            # Eyes back over the left shoulder for the ball, then upfield.
            look = bump(t, t_run + 0.05, tc + 0.12)
            if look > 0:
                p.gaze = (-12.0 * look, 105.0 * look, 0.9)
                p.joints["spine_03"] = (p.joints.get("spine_03", (0, 0, 0))[0], 0.0, 10.0 * look)
                p.joints["spine_04"] = (p.joints.get("spine_04", (0, 0, 0))[0], 0.0, 8.0 * look)
        return p

    return sig_clip("sig_wr", ch, fx, events={"catch": round(tc * FPS)})


# --- Running back -----------------------------------------------------------------------------


def sig_rb() -> Clip:
    """Burst off the ball with it tucked, a jab cut (plant outside, go
    left), burst, stop, and back into the stance."""
    from .actions import juke_left

    go, jk, st_, back = getoff("rb_2pt"), juke_left(), stop("run", T=1.0, name="sig_stop"), set_stance("rb_2pt")
    ch = Chain().add_clip(go).add_clip(jk).add_run(10, RUN.frames // 2).add_clip(st_).add_clip(back)
    t_set = (ch.frames - back.frames) / FPS
    tuck = carry_pose()

    def fx(p, t):
        # The ball comes into the right arm off the first step, out as he sets.
        k = smoothstep(0.1, 0.35, t) * (1.0 - smoothstep(t_set, t_set + 0.4, t))
        if k > 1e-3:
            p = local_upper(p, tuck, k)
            if k < 0.999:
                p.arms = {s: a for s, a in p.arms.items()}
        return p

    return sig_clip("sig_rb", ch, fx, events={"cut": go.frames + 5})


# --- Tight end ---------------------------------------------------------------------------------


def release(frames: int = 20) -> Clip:
    """Off the drive block into the route: the hands push off (lock out
    and drop), the pads come up, three quick accelerating steps into the
    run at its right touch-down."""
    T = frames / FPS
    v0, v1 = DRIVE.speed, RUN.speed
    D = (v0 + v1) / 2 * T

    def fwd(t):
        return _hermite(0.0, D, v0, v1, T, min(t, T))

    def travel(t):
        return (0.0, -fwd(t))

    d0 = gait_pose(DRIVE, 0)
    end = shift(run_at(RUN.frames / 2), 0.0, -fwd(T))
    steps = Steps([
        Plant("l", -1, 0.22, d0.feet["l"], roll=18.0), Plant("l", 0.42, T - 0.18, Foot(0.08, -fwd(0.45) - 0.08, heel=10, out=4), roll=26.0), Plant("l", T, math.inf, end.feet["l"], contact=False),
        Plant("r", -1, 0.07, d0.feet["r"], roll=20.0), Plant("r", 0.24, 0.36, Foot(-0.09, -fwd(0.3) - 0.07, heel=12, out=4), roll=26.0), Plant("r", T, math.inf, end.feet["r"]),
    ], height=0.1)
    lock = copy.deepcopy(d0)
    lock.arms = {"l": replace(PUNCH, flex=108, elbow=8), "r": replace(PUNCH, flex=108, elbow=8)}
    keys = [(0.0, d0), (0.1, lock), (0.3, mix(lock, run_at(RUN.frames / 2), 0.5)), (T, run_at(RUN.frames / 2))]

    def pose(t):
        p = shift(keyed(keys, t), 0.0, -fwd(t))
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("te_release", "transition", T, pose, travel, "ol_drive", "loco_run", steps, to_phase=0.5)


def sig_te() -> Clip:
    """From the three-point: fire out and strike (frame 9), drive, release
    into the route, stop, and back into the stance."""
    fd, rl = fire_drive(), release()
    st_, back = stop("run", T=0.9, name="sig_stop_te"), set_stance("ol_3pt")
    ch = Chain().add_clip(fd).add_clip(rl).add_run(10, RUN.frames // 2).add_clip(st_).add_clip(back)
    return sig_clip("sig_te", ch, events={"contact": 9, "release": fd.frames + 3})


# --- Offensive lineman --------------------------------------------------------------------------


def sig_ol() -> Clip:
    """Two-point, settle into the three-point, hold, one kick-slide back
    and out with the hands coming up, punch (frame 50), hold, then walk
    back up to the spot into the two-point. Really moves."""
    from .actions_m6_line import settle

    rd, st, ps = STANCES["ol_ready"], STANCES["ol_3pt"], STANCES["ol_pass"]
    se = settle()
    T = 1.7
    B = (-0.18, 0.40)  # the set: back and out to the right

    def kick(t):
        # 0-0.1 still, hand up; kick (right) lands 0.34, slide (left) 0.5,
        # punch 0.66, hold, then two steps back up to the spot and down to
        # the hands-on-thighs two-point by T.
        e = smoothstep(0.1, 0.55, t) * (1 - smoothstep(1.0, 1.55, t))
        bx, by = B[0] * e, B[1] * e
        up = with_arms(ps, Pose(arms={"l": PUNCH, "r": PUNCH}, joints={**SPREAD, **STRIKE_WRISTS}))
        if t < 0.55:
            p = mix(st, ps, smoothstep(0.08, 0.5, t))
        elif t < 0.66:
            p = mix(ps, up, smoothstep(0.55, 0.66, t))
        elif t < 0.85:
            p = copy.deepcopy(up)
        elif t < 1.1:
            p = mix(up, ps, smoothstep(0.85, 1.1, t))
        else:
            p = mix(ps, rd, smoothstep(1.1, T, t))
        p = shift(p, bx, by)
        h = st.hands["r"]
        if t < 0.18:
            p.hands = {"r": (*h[:3], 1.0 - smoothstep(0.08, 0.18, t))}
        elif t > 1.3:
            p.hands = {s: (*hh[:3], smoothstep(1.3, T, t)) for s, hh in rd.hands.items()}
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    pr, pl = ps.feet["r"], ps.feet["l"]
    steps = Steps([
        Plant("r", -1, 0.2, st.feet["r"], roll=8.0), Plant("r", 0.34, 1.02, replace(pr, x=pr.x + B[0] - 0.03, y=pr.y + B[1] + 0.04, heel=12.0), roll=6.0), Plant("r", 1.2, math.inf, rd.feet["r"]),
        Plant("l", -1, 0.36, st.feet["l"], roll=6.0), Plant("l", 0.5, 1.2, replace(pl, x=pl.x + B[0], y=pl.y + B[1], heel=12.0), roll=10.0), Plant("l", 1.4, math.inf, rd.feet["l"]),
    ], height=0.04)
    ch = Chain().add_clip(se).add_hold(8, st).add(round(T * FPS), kick, steps.contacts(round(T * FPS)))
    return sig_clip("sig_ol", ch, treadmill=False, events={"punch": se.frames + 8 + round(0.66 * FPS)})


def sig_clips() -> list[Clip]:
    return [sig_qb(), sig_wr(), sig_rb(), sig_te(), sig_ol()]


__all__ = ["sig_clips", "Chain", "TUCK_R", "TUCK_ELBOW_R", "hands_of", "READY", "Arm", "GRIP"]

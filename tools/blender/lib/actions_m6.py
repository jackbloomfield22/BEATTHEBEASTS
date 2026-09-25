"""M6 clips: line play (offense and defense), linebackers, defensive
backs, the kicking game, the officials and the locker-room signature
clips. Keyed here like every clip (CLAUDE.md rule 6): no downloaded,
captured or third-party motion. The kick-slide, the pass-rush moves, the
hip flip and the break are technique clips (never cut).

The clips live in four modules by unit; this one holds what they share
(turning a pose, the upper-body split, the arm shapes a lineman uses) and
the registry.

- actions_m6_line.py: offensive and defensive line.
- actions_m6_back7.py: linebackers and defensive backs.
- actions_m6_special.py: long snapper, holder, kicker, punter, officials.
- actions_m6_sig.py: the draft room's hologram clips (in place).
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from mathutils import Euler, Matrix

from .actions import Clip, mix
from .gait import FPS, Gait, contacts as gait_contacts, gait_pose, smoothstep
from .poses import Arm, Pose

# --- Turning a pose -----------------------------------------------------------


def _rot(x: float, y: float, deg: float, cx: float = 0.0, cy: float = 0.0) -> tuple[float, float]:
    a = math.radians(deg)
    dx, dy = x - cx, y - cy
    return cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)


# The pelvis joint's rest position (skeleton.py J["pelvis"]).
_PELVIS_Y = 0.01


def rotate_pose(p: Pose, deg: float, cx: float = 0.0, cy: float = 0.0) -> Pose:
    """The whole pose turned `deg` (+ left, about the vertical) around a
    point on the field: feet, hands and poles move and turn with it, the
    pelvis turns in the world (its tilt kept in the body's own frame), the
    gaze and the swing plane of the legs turn with the body."""
    q = copy.deepcopy(p)
    if abs(deg) < 1e-9:
        return q
    x, y = _rot(q.pelvis.get("side", 0.0), _PELVIS_Y - q.pelvis.get("forward", 0.0), deg, cx, cy)
    q.pelvis["side"], q.pelvis["forward"] = x, _PELVIS_Y - y
    # The pelvis bone's rest frame is (left, up, forward), so a world yaw is
    # a turn about its local y, applied after the pose's own rotation.
    flex, twist, lat = (math.radians(q.pelvis.get(k, 0.0)) for k in ("flex", "twist", "lateral"))
    m = Matrix.Rotation(math.radians(deg), 3, "Y") @ Euler((flex, twist, lat), "XYZ").to_matrix()
    e = m.to_euler("XYZ", Euler((flex, twist + math.radians(deg), lat), "XYZ"))
    q.pelvis["flex"], q.pelvis["twist"], q.pelvis["lateral"] = (math.degrees(v) for v in e)
    for s, f in q.feet.items():
        fx, fy = _rot(f.x, f.y, deg, cx, cy)
        q.feet[s] = replace(f, x=fx, y=fy, out=f.out + (deg if s == "l" else -deg))
    q.hands = {s: (*_rot(h[0], h[1], deg, cx, cy), *h[2:]) for s, h in q.hands.items()}
    q.elbow = {s: (*_rot(e[0], e[1], deg, cx, cy), e[2]) for s, e in q.elbow.items()}
    if q.knee is not None:
        kx, ky = _rot(q.knee[0], q.knee[1], deg)
        q.knee = (kx, ky, q.knee[2])
    q.yaw += deg
    q.fk_dir += deg
    if q.gaze:
        q.gaze = (q.gaze[0], q.gaze[1] + deg, *q.gaze[2:])
    return q


def hips_xy(p: Pose) -> tuple[float, float]:
    """Where the pelvis joint stands on the field."""
    return p.pelvis.get("side", 0.0), _PELVIS_Y - p.pelvis.get("forward", 0.0)


def turn_about_hips(p: Pose, deg: float) -> Pose:
    """rotate_pose about the pose's own hips (a body turning where it stands)."""
    return rotate_pose(p, deg, *hips_xy(p))


# --- Upper body ----------------------------------------------------------------

UPPER_PREFIX = ("clavicle", "upperarm", "forearm", "hand", "fingers", "index", "thumb")


def with_arms(base: Pose, src: Pose, spine: bool = False) -> Pose:
    """`base` with the arms, hands (and optionally spine and head) of `src`."""
    p = copy.deepcopy(base)
    p.arms = copy.deepcopy(src.arms)
    p.hands = copy.deepcopy(src.hands)
    p.elbow = copy.deepcopy(src.elbow)
    for k in list(p.joints):
        if k.startswith(UPPER_PREFIX):
            del p.joints[k]
    p.joints.update({k: v for k, v in src.joints.items() if k.startswith(UPPER_PREFIX)})
    if spine:
        p.joints.update({k: v for k, v in src.joints.items() if k.startswith(("spine_02", "spine_03", "spine_04", "neck", "head"))})
        p.gaze = src.gaze
    return p


def arms_only(arms: dict, joints: dict | None = None, gaze=None) -> Pose:
    """An upper-body key: aimed arms and hand states, nothing else."""
    return Pose(joints=dict(joints or {}), arms=dict(arms), gaze=gaze)


# Arm shapes (thorax frame; poses.Arm). Coaching language in the comments.
# The thorax frame leans with the trunk, so an arm's angle from the
# vertical in the world is its flex minus the trunk's forward lean: a
# pass-set lineman (~28 degrees of lean) holds his punch at ~100 to put the
# hands just under his own shoulder height, on the rusher's chest plate.
# Pass protection "hands ready": elbows in, the hands up in front of the
# chest, thumbs up, ready to punch.
READY = Arm(flex=34, elbow=104, abd=14, inward=0.45, clavicle=4)
# The punch: both hands shoot to the rusher's chest plate, inside the
# frame, the elbows still a little bent at contact.
PUNCH = Arm(flex=100, elbow=24, abd=10, inward=0.38, clavicle=12)
# Locked out: arms long and straight into the chest, the shoulders behind them.
LOCK = Arm(flex=96, elbow=10, abd=9, inward=0.32, clavicle=14)
# Hands cocked low at the hips before a strike ("load the hands").
LOADED = Arm(flex=-8, elbow=96, abd=14, inward=0.15)
# Wrists cocked back for a strike with the heels of the hands.
STRIKE_WRISTS = {"hand_l": (-35, 0, 0), "hand_r": (-35, 0, 0)}


def arm(side_arms: dict, **kw) -> dict:
    return {s: replace(a, **kw) for s, a in side_arms.items()}


# --- Timing curves ----------------------------------------------------------------


def ease(t: float, t0: float, t1: float) -> float:
    return smoothstep(t0, t1, t)


def power_travel(D: float, T: float, v_end: float):
    """Distance from rest to D at T, arriving at v_end, never backward: x = D (t/T)^n
    with n = v_end T / D (the get-offs' curve, transitions.getoff)."""
    n = max(1.0, v_end * T / D)
    return lambda t: D * (min(max(t, 0.0), T) / T) ** n


def bump(t: float, t0: float, t1: float) -> float:
    """0 -> 1 -> 0 over [t0, t1] (a sine hump)."""
    if t <= t0 or t >= t1:
        return 0.0
    return math.sin(math.pi * (t - t0) / (t1 - t0))


def gait_clip(name: str, g: Gait, extra=None) -> Clip:
    """A locomotion loop from a gait (the keyer in gait.py), optionally
    with a function that edits each frame's pose (hands on a block...)."""

    def pose(t):
        f = t * FPS
        p = gait_pose(g, f % g.frames)
        return extra(p, (f % g.frames) / g.frames) if extra else p

    return Clip(name, "locomotion", g.frames / FPS, pose, loop=True, contacts=gait_contacts(g), speed=g.speed, loco_dir=g.dir)


def blend_keys(keys, t):
    """keyed() with a per-key easing already applied by mix (re-exported for the modules)."""
    from .actions import keyed

    return keyed(keys, t)


# --- Registry ------------------------------------------------------------------------

# Stances (kind "stance") the M6 modules add that don't bear weight only
# through the feet (a kneeling holder's knee is on the turf).
NO_BALANCE: set[str] = set()


def m6_clips() -> list[Clip]:
    from .actions_m6_back7 import back7_clips
    from .actions_m6_line import line_clips
    from .actions_m6_sig import sig_clips
    from .actions_m6_special import special_clips

    return [*line_clips(), *back7_clips(), *special_clips(), *sig_clips()]


__all__ = ["rotate_pose", "hips_xy", "turn_about_hips", "with_arms", "arms_only", "READY", "PUNCH", "LOCK", "LOADED", "STRIKE_WRISTS", "ease", "power_travel", "bump", "gait_clip", "mix", "NO_BALANCE", "m6_clips"]

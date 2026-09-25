"""Game-action clips (M5): the quarterback's drop and throw, catches, the
ball carrier's moves, the form tackle, lying on the turf and getting up.
Keyed here like every clip (CLAUDE.md rule 6): no downloaded, captured or
third-party motion. Technique clips (drops, the tackle) are never cut.

Three kinds:
- full-body clips (kind "transition"): authored in world space with the
  footstep planner from transitions.py (planted feet stay put) and the
  body's travel taken back out, so they play in place like the loops;
- overlays (kind "overlay"): upper-body motion (the ball tucked, a catch,
  a stiff arm) that the runtime lays over whatever the legs are doing, on
  the bones in the clip's mask only;
- the lying stances (kind "stance") that tackles and dives end in.

Clip events (the ball leaving the hand, a catch secured, a tackle's
contact) are written to anims.json so the runtime can time the clip to the
simulation: the sim decides when, the clip shows how.

Timings and shapes, from coaching and biomechanics descriptions:
- Shotgun drop: catch the snap and take a three-step (0.75 s, ~1.8 m) or
  five-step (1.05 s, ~2.7 m) drop, the plant foot setting last with the
  weight on the balls of the feet.
- Throw (a right-hander): load onto the back foot with the ball at the
  ear, stride ~0.4 m at the target with the front foot, hips open before
  the shoulders, the elbow at shoulder height, release in front of the
  head ~0.35 s into the motion (NFL releases 0.3-0.45 s), follow through
  across the body to the opposite hip. Fleisig et al. (1996) on the
  football throw: stride ~70% of height is a drop-back maximum; the pocket
  stride is shorter.
- Catch: hands out to the ball, thumbs together above the chest, fingers
  together below it ("the diamond"), eyes to the tuck; high and tight after.
- Carry: "high and tight": the ball's nose in the fingers, its back
  against the biceps, the forearm pressed across the ribs.
- Juke: a hard plant on the outside foot, hips sink, the push goes the
  other way; ~0.45 s including the landing step.
- Spin: plant, pivot on the ball of the foot through 360 degrees with the
  ball tucked away from the tackler, land and go.
- Form tackle: breakdown (hips low, head up), contact with the near
  shoulder, arms wrap and squeeze, feet drive, then both go down.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace

from .gait import FPS, GAITS, gait_pose, smoothstep
from .poses import FIST, GRIP, RELAXED, SPREAD, STANCES, Arm, Foot, Pose
from .transitions import Plant, Steps, _hermite, _lerp, blend

RUN = GAITS["run"]


# --- Helpers ---------------------------------------------------------------


def shift(p: Pose, dx: float, dy: float) -> Pose:
    """Move a pose (dx, dy) in the field (Blender x left, y back)."""
    q = copy.deepcopy(p)
    q.pelvis["side"] = q.pelvis.get("side", 0.0) + dx
    q.pelvis["forward"] = q.pelvis.get("forward", 0.0) - dy
    for s in "lr":
        q.feet[s].x += dx
        q.feet[s].y += dy
    q.hands = {s: (h[0] + dx, h[1] + dy, *h[2:]) for s, h in q.hands.items()}
    q.elbow = {s: (e[0] + dx, e[1] + dy, e[2]) for s, e in q.elbow.items()}
    return q


def mix(a: Pose, b: Pose, t: float) -> Pose:
    """transitions.blend, plus the fields it doesn't know (knee poles, yaw, elbow poles)."""
    p = blend(a, b, t)
    t = min(1.0, max(0.0, t))
    p.yaw = _lerp(a.yaw, b.yaw, t)
    p.fk_dir = _lerp(a.fk_dir, b.fk_dir, t)
    if a.knee is not None or b.knee is not None:
        ka = a.knee or (0.0, -0.9, 0.0)
        kb = b.knee or (0.0, -0.9, 0.0)
        p.knee = tuple(_lerp(x, y, t) for x, y in zip(ka, kb))
    for s in "lr":
        ea, eb = a.elbow.get(s), b.elbow.get(s)
        if ea or eb:
            ea = ea or eb
            eb = eb or ea
            p.elbow[s] = tuple(_lerp(x, y, t) for x, y in zip(ea, eb))
    return p


def keyed(keys: list[tuple[float, Pose]], t: float) -> Pose:
    """A pose from timed keys, smoothstep between neighbours."""
    if t <= keys[0][0]:
        return copy.deepcopy(keys[0][1])
    for (t0, a), (t1, b) in zip(keys, keys[1:]):
        if t <= t1:
            return mix(a, b, smoothstep(t0, t1, t))
    return copy.deepcopy(keys[-1][1])


def mirror_pose(p: Pose) -> Pose:
    """Left-right mirror of a whole pose (arms, gaze, poles and yaw too)."""

    def sw(n: str) -> str:
        return n[:-2] + ("_r" if n.endswith("_l") else "_l") if n.endswith(("_l", "_r")) else n

    pel = dict(p.pelvis)
    for k in ("side", "lateral", "twist"):
        if k in pel:
            pel[k] = -pel[k]
    joints = {}
    for b, (fl, ab, tw) in p.joints.items():
        joints[sw(b)] = (fl, ab, tw) if b.endswith(("_l", "_r")) else (fl, -ab, -tw)
    feet = {("r" if s == "l" else "l"): replace(f, x=-f.x) for s, f in p.feet.items()}
    hands = {("r" if s == "l" else "l"): (-h[0], *h[1:]) for s, h in p.hands.items()}
    arms = {("r" if s == "l" else "l"): a for s, a in p.arms.items()}
    elbow = {("r" if s == "l" else "l"): (-e[0], e[1], e[2]) for s, e in p.elbow.items()}
    gaze = (p.gaze[0], -p.gaze[1], *p.gaze[2:]) if p.gaze else None
    knee = (-p.knee[0], p.knee[1], p.knee[2]) if p.knee else None
    return Pose(pelvis=pel, joints=joints, feet=feet, hands=hands, arms=arms, gaze=gaze, knee=knee, yaw=-p.yaw, elbow=elbow, fk_dir=-p.fk_dir)


def hands_of(state: dict, side: str) -> dict:
    return {k: v for k, v in state.items() if k.endswith(f"_{side}")}


class Clip:
    """A keyed clip. `pose_world(t)` is authored in the field; `travel(t)`
    is the body's (dx, dy) displacement, taken back out so the clip plays in
    place. Metadata: kind, hand-over clips, bone mask, events (frame)."""

    def __init__(self, name, kind, T, pose_world, travel=None, frm=None, to=None, steps=None, mask=None, events=None, to_phase=0.0, loop=False, com=True, contacts=None, main_dir=None, turn=0.0, speed=0.0, loco_dir=None, from_phase=None):
        self.name, self.kind, self.frm, self.to = name, kind, frm, to
        self.frames = round(T * FPS)
        self._pose = pose_world
        self._travel = travel or (lambda t: (0.0, 0.0))
        self.mask = mask
        self.events = events or {}
        self.to_phase = to_phase
        self.loop = loop
        self.com = com
        # M6: a transition whose main travel is sideways (a pull runs down
        # the line) names it ([+-1, 0], Blender x); `turn` is how far the
        # body has turned by the last frame (deg, + left), so the runtime
        # turns the heading by it at the hand-over. Locomotion loops built
        # here carry their ground speed and direction (as the gaits do).
        self.main_dir = main_dir
        self.turn = turn
        self.speed = speed
        self.loco_dir = loco_dir
        # Out of a gait: the phase of it the clip starts at (0 = left
        # touch-down), when that isn't implied (M6 clips write it).
        self.from_phase = from_phase
        if contacts is not None:
            self.contacts = contacts
        elif steps is not None:
            self.contacts = steps.contacts(self.frames)
        else:
            self.contacts = {"l": [[0, self.frames]], "r": [[0, self.frames]]}

    def travel_xy(self, f: int) -> tuple[float, float]:
        return self._travel(f / FPS)

    def travel(self, f: int) -> float:
        """Distance along the clip's main direction (forward, or back for a drop)."""
        if self.kind == "locomotion":
            return self.speed * f / FPS
        dx, dy = self._travel(f / FPS)
        d = self.dir
        return dx * d[0] + dy * d[1]

    @property
    def dir(self) -> list:
        if self.kind == "locomotion":
            return list(self.loco_dir)
        if self.main_dir is not None:
            return list(self.main_dir)
        dx, dy = self._travel(self.frames / FPS)
        return [0.0, 1.0] if dy > 1e-6 else [0.0, -1.0]

    def pose(self, f: int) -> Pose:
        dx, dy = self._travel(f / FPS)
        return shift(self._pose(f / FPS), -dx, -dy)


def mirrored(c: Clip, name: str, to_phase: float | None = None) -> Clip:
    m = Clip(
        name, c.kind, c.frames / FPS, lambda t: mirror_pose(c._pose(t)), travel=lambda t: (-c._travel(t)[0], c._travel(t)[1]),
        frm=c.frm, to=c.to, mask=[_mirror_bone(b) for b in c.mask] if c.mask else None, events=c.events,
        to_phase=c.to_phase if to_phase is None else to_phase, loop=c.loop, com=c.com, contacts={"l": c.contacts["r"], "r": c.contacts["l"]},
        main_dir=[-c.main_dir[0], c.main_dir[1]] if c.main_dir else None, turn=-c.turn, speed=c.speed,
        loco_dir=(-c.loco_dir[0], c.loco_dir[1]) if c.loco_dir else None,
        from_phase=(c.from_phase + 0.5) % 1.0 if c.from_phase is not None else None,
    )
    return m


def _mirror_bone(n: str) -> str:
    return n[:-2] + ("_r" if n.endswith("_l") else "_l") if n.endswith(("_l", "_r")) else n


# Bone masks for overlays (the runtime applies an overlay to these only).
FINGERS = ("fingers_01", "fingers_02", "fingers_03", "index_01", "index_02", "index_03", "thumb_01", "thumb_02", "thumb_03")


def arm_mask(side: str) -> list[str]:
    return [f"{b}_{side}" for b in ("clavicle", "upperarm", "upperarm_twist", "forearm", "forearm_twist", "hand", *FINGERS)]


SPINE_UP = ["spine_02", "spine_03", "spine_04"]
HEAD = ["neck_01", "neck_02", "head"]


# --- Poses the clips share -------------------------------------------------

IDLE = STANCES["idle"]

# The ball tucked high and tight in the right arm: the wrist in front of the
# chest, the forearm across the ribs, the elbow in at the side and back.
TUCK_R = (-0.085, -0.255, 1.19)
TUCK_ELBOW_R = (-0.30, 0.45, 0.85)
# Both hands on the ball at the chest: the right on the laces, the left on the side.
HOLD = {"l": (0.07, -0.27, 1.21), "r": (-0.05, -0.23, 1.28)}
HOLD_ELBOW = {"l": (0.55, 0.35, 0.95), "r": (-0.55, 0.35, 0.95)}


def with_upper(base: Pose, hands: dict, joints: dict | None = None, elbow: dict | None = None, arms: dict | None = None) -> Pose:
    p = copy.deepcopy(base)
    p.hands = dict(hands)
    p.joints.update(joints or {})
    p.elbow = dict(elbow or {})
    p.arms = dict(arms or {})
    return p


def carry_pose(base: Pose = IDLE) -> Pose:
    return with_upper(base, {"r": TUCK_R}, {**hands_of(GRIP, "r"), "hand_r": (-15, 0, 10)}, {"r": TUCK_ELBOW_R})


# Quarterback set in the pocket: feet a little wider than the shoulders,
# the right (back) foot staggered ~15 cm, knees flexed, on the balls of the
# feet, the ball at the chest in both hands, eyes downfield.
STANCES["qb_set"] = with_upper(
    Pose(
        pelvis={"forward": -0.03, "up": -0.085, "flex": 12, "twist": -6},
        joints={"spine_02": (4, 0, 3), "spine_03": (3, 0, 2)},
        feet={"l": Foot(0.21, -0.15, heel=8, out=6), "r": Foot(-0.21, 0.01, heel=12, out=14)},
        gaze=(3.0, 0.0),
    ),
    HOLD,
    {**GRIP, "hand_l": (-10, 0, -20), "hand_r": (-25, 0, 15)},
    HOLD_ELBOW,
)

# Lying face down (tackled forward, after a dive): the trunk flat, hips on
# the turf, legs back with the toes dug in, the forearms on the ground ahead
# of the head, the head turned a little.
STANCES["down_prone"] = Pose(
    pelvis={"forward": 0.0, "up": -0.80, "flex": 90},
    joints={"spine_02": (-4, 0, 0), "spine_03": (-4, 0, 0), "neck_01": (-24, 0, 12), "head": (-12, 0, 10), **RELAXED},
    feet={"l": Foot(0.15, 0.93, heel=88, out=10), "r": Foot(-0.12, 0.95, heel=88, out=4)},
    arms={"l": Arm(flex=150, elbow=70, abd=40, inward=0.3), "r": Arm(flex=140, elbow=85, abd=45, inward=0.3)},
    knee=(0.0, 0.05, -0.9),
)

# Lying on the back: hips down, knees a little up, arms out at the sides.
STANCES["down_supine"] = Pose(
    pelvis={"forward": 0.0, "up": -0.80, "flex": -88},
    joints={"spine_02": (-2, 0, 0), "neck_01": (18, 0, -8), "head": (8, 0, -6), **RELAXED},
    feet={"l": Foot(0.18, -0.78, heel=-70, out=12), "r": Foot(-0.16, -0.72, heel=-60, out=14)},
    arms={"l": Arm(flex=35, elbow=40, abd=65, inward=0.1), "r": Arm(flex=20, elbow=30, abd=60, inward=0.1)},
    knee=(0.0, 0.0, 0.9),
)


# --- Quarterback ------------------------------------------------------------


def qb_drop(steps_n: int) -> Clip:
    """Shotgun: catch the snap, take the drop back, set. The body travels
    backward (+y); the right foot opens first, the left crosses, the right
    plants and the left settles."""
    T, D = (0.75, 1.8) if steps_n == 3 else (1.05, 2.7)
    gun, qset = copy.deepcopy(STANCES["qb_gun"]), copy.deepcopy(STANCES["qb_set"])

    def back(t):
        return _hermite(0.0, D, 0.0, 0.0, T * 0.92, min(t, T * 0.92))

    def travel(t):
        return (0.0, back(t))

    end = shift(qset, 0.0, D)
    # The drop's steps (right first), planned by distance: step i plants at
    # P_i along the drop and stays down while the body passes within 22 cm
    # of it either side; the last step sets, and the other foot settles.
    def when(x):
        lo, hi = 0.0, T * 0.92
        for _ in range(40):
            mid = (lo + hi) / 2
            if back(mid) < x:
                lo = mid
            else:
                hi = mid
        return lo

    n = steps_n
    P = [(i + 0.5) * D / n for i in range(n)]
    H = 0.22
    plants = [Plant("r", -1, 0.02, gun.feet["r"], roll=8.0), Plant("l", -1, when(min(H, P[0])), gun.feet["l"], roll=10.0)]
    for i in range(n):
        side = "r" if i % 2 == 0 else "l"
        base = gun.feet[side]
        if i == n - 1:
            plants.append(Plant(side, when(max(0.0, D - H)), math.inf, end.feet[side]))
            break
        plants.append(Plant(side, when(max(0.0, P[i] - H)), when(P[i] + H), replace(base, x=base.x * 1.15, y=base.y + P[i], heel=18, out=22 if side == "r" else 10), roll=12.0))
    last = "l" if n % 2 == 1 else "r"
    plants.append(Plant(last, min(T - 0.02, max(when(D - 0.02), when(max(0.0, D - H)) + 0.12)), math.inf, end.feet[last]))
    steps = Steps(plants, height=0.07)
    # Snap in the hands at ~0.1 s, up to the chest by 0.25 s.
    caught = with_upper(gun, {s: (h[0] * 0.6, -0.30, 1.12) for s, h in gun.hands.items()}, {**GRIP}, HOLD_ELBOW)

    def pose(t):
        b = back(t)
        p = mix(shift(gun, 0.0, b), shift(qset, 0.0, b), smoothstep(0.05 * T, 0.9 * T, t))
        # Hands: to the ball, then the ball to the chest, riding with the body.
        up = shift(qset, 0.0, b)
        if t < 0.25:
            c = shift(caught, 0.0, b)
            p.hands = mix(shift(gun, 0.0, b), c, smoothstep(0.0, 0.1, t)).hands if t < 0.1 else mix(c, up, smoothstep(0.1, 0.25, t)).hands
            p.elbow = dict(HOLD_ELBOW)
            p.elbow = {s: (e[0], e[1] + b, e[2]) for s, e in p.elbow.items()}
        else:
            p.hands = up.hands
            p.elbow = up.elbow
        p.joints.update(GRIP if t > 0.08 else {})
        # Open the hips on the first step (drop steps turn the body), square up to set.
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) - 20.0 * math.sin(math.pi * smoothstep(0.1 * T, 0.85 * T, t))
        p.gaze = (3.0, 20.0 * math.sin(math.pi * smoothstep(0.1 * T, 0.85 * T, t)), 0.6)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip(f"qb_drop_gun{steps_n}", "transition", T, pose, travel, "stance_qb_gun", "stance_qb_set", steps)


def qb_throw() -> Clip:
    """From the set: load, stride and throw, follow through, into a stand.
    Release at frame 11 (0.37 s)."""
    T = 0.8
    S = 0.36  # the stride carries the body this far forward
    qset = copy.deepcopy(STANCES["qb_set"])
    idle = copy.deepcopy(IDLE)
    fwd = lambda t: S * smoothstep(0.10, 0.62, t) ** 1.2  # noqa: E731

    def travel(t):
        return (0.0, -fwd(t))

    end = shift(idle, 0.0, -S)
    steps = Steps([
        Plant("l", -1, 0.13, qset.feet["l"], roll=6.0),
        Plant("l", 0.31, math.inf, replace(end.feet["l"], heel=-6.0)),
        Plant("r", -1, 0.50, qset.feet["r"], roll=28.0),
        Plant("r", 0.68, math.inf, end.feet["r"]),
    ], height=0.06)
    grip_r, spread_r = hands_of(GRIP, "r"), hands_of(SPREAD, "r")
    # Load: the ball to the right ear in both hands, the shoulders turned away.
    load = with_upper(qset, {"r": (-0.19, 0.04, 1.58), "l": (-0.09, -0.04, 1.51)}, {**GRIP, "hand_r": (-30, 0, 20)}, {"r": (-0.8, 0.3, 1.2), "l": (0.3, -0.2, 1.1)})
    load.pelvis.update({"twist": -30, "up": -0.10})
    load.joints.update({"spine_02": (3, 0, -8), "spine_03": (2, 0, -8), "spine_04": (0, 0, -6)})
    load.gaze = (3.0, 0.0, 0.8)
    # Cocked: the stride lands, the elbow at shoulder height, the ball behind the head; the glove arm points at the target.
    cock = shift(with_upper(qset, {"r": (-0.33, 0.16, 1.60), "l": (0.20, -0.52, 1.46)}, {**grip_r, **hands_of(SPREAD, "l"), "hand_r": (-45, 0, 30)}, {"r": (-0.9, 0.0, 1.55), "l": (0.6, 0.0, 1.2)}), 0.0, -fwd(0.30))
    cock.pelvis.update({"twist": -32, "up": -0.12, "flex": 10})
    cock.joints.update({"spine_02": (0, 4, -10), "spine_03": (-2, 4, -10), "spine_04": (-2, 0, -8)})
    cock.gaze = (3.0, 0.0, 0.9)
    # Release: hips and shoulders square to the target, the hand high in front of the head.
    rel = shift(with_upper(qset, {"r": (-0.11, -0.44, 1.78), "l": (0.26, -0.10, 1.12)}, {**spread_r, **hands_of(RELAXED, "l"), "hand_r": (10, 0, 0)}, {"r": (-0.7, -0.2, 1.35), "l": (0.7, 0.3, 1.0)}), 0.0, -fwd(0.367))
    rel.pelvis.update({"twist": 8, "up": -0.11, "flex": 16})
    rel.joints.update({"spine_02": (6, -2, 6), "spine_03": (4, -2, 6), "spine_04": (2, 0, 4)})
    rel.gaze = (4.0, 0.0, 0.9)
    # Follow-through: across the body to the left hip, the chest over the front knee.
    fol = shift(with_upper(qset, {"r": (0.17, -0.36, 1.00), "l": (0.28, 0.02, 1.06)}, {**hands_of(RELAXED, "r"), **hands_of(RELAXED, "l")}, {"r": (-0.3, -0.5, 1.2), "l": (0.7, 0.4, 1.0)}), 0.0, -fwd(0.55))
    fol.pelvis.update({"twist": 24, "up": -0.12, "flex": 26})
    fol.joints.update({"spine_02": (10, -2, 10), "spine_03": (8, -2, 8), "spine_04": (4, 0, 4)})
    fol.gaze = (6.0, 0.0, 0.9)
    stand = copy.deepcopy(end)
    keys = [(0.0, qset), (0.13, load), (0.30, cock), (0.367, rel), (0.55, fol), (T, stand)]

    def pose(t):
        p = keyed(keys, t)
        # The hands let go of IK into the stand's hanging arms at the end.
        if t > 0.55:
            k = 1.0 - smoothstep(0.55, T, t)
            p.hands = {s: (*h[:3], (h[3] if len(h) > 3 else 1.0) * k) for s, h in fol.hands.items()}
            p.arms = {s: replace(a, weight=a.weight * (1.0 - k)) for s, a in idle.arms.items()}
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("qb_throw", "transition", T, pose, travel, "stance_qb_set", "stance_idle", steps, events={"release": 11})


# --- Overlays ---------------------------------------------------------------


def still_overlay(name: str, p: Pose, mask: list[str], T: float = 1.0) -> Clip:
    """A held upper-body pose (a loop with a little breath in it)."""

    def pose(t):
        q = copy.deepcopy(p)
        b = math.sin(2 * math.pi * t / T)
        f, a, tw = q.joints.get("spine_03", (0, 0, 0))
        q.joints["spine_03"] = (f - 0.8 * b, a, tw)
        return q

    return Clip(name, "overlay", T, pose, mask=mask, loop=True)


def carry() -> Clip:
    return still_overlay("ovl_carry_r", carry_pose(), arm_mask("r"))


def protect() -> Clip:
    """Both arms over the ball: the right tucks it, the left hand caps the nose."""
    p = with_upper(IDLE, {"r": (-0.05, -0.25, 1.17), "l": (0.02, -0.31, 1.21)}, {**GRIP, "hand_l": (30, 0, -10), "spine_03": (8, 0, 0), "spine_04": (6, 0, 0)}, {"r": TUCK_ELBOW_R, "l": (0.45, 0.2, 0.9)})
    return still_overlay("ovl_protect", p, arm_mask("l") + arm_mask("r") + ["spine_03", "spine_04"])


def qb_hold() -> Clip:
    return still_overlay("ovl_qb_hold", with_upper(IDLE, HOLD, {**GRIP, "hand_l": (-10, 0, -20), "hand_r": (-25, 0, 15)}, HOLD_ELBOW), arm_mask("l") + arm_mask("r"))


def catch(high: bool) -> Clip:
    """Hands out to the ball, secure it (frame 6, 0.2 s), tuck it."""
    T = 0.5
    z = 1.98 if high else 1.30
    y = -0.30 if high else -0.50
    ready = with_upper(IDLE, {"l": (0.20, -0.22, 1.05), "r": (-0.20, -0.22, 1.05)}, {**RELAXED}, {"l": (0.6, 0.4, 0.9), "r": (-0.6, 0.4, 0.9)})
    # Thumbs together above the chest (the diamond); overhead the hands turn up.
    wrist = (-40, 0, 0) if not high else (-10, 0, 0)
    reach = with_upper(IDLE, {"l": (0.075, y, z), "r": (-0.075, y, z)}, {**SPREAD, "hand_l": wrist, "hand_r": wrist}, {"l": (0.7, 0.0, z - 0.4), "r": (-0.7, 0.0, z - 0.4)})
    secure = with_upper(IDLE, {"l": (0.05, y + 0.08, z - 0.03), "r": (-0.05, y + 0.08, z - 0.03)}, {**GRIP, "hand_l": wrist, "hand_r": wrist}, {"l": (0.7, 0.1, z - 0.45), "r": (-0.7, 0.1, z - 0.45)})
    tuck = with_upper(carry_pose(), {"r": TUCK_R, "l": (0.03, -0.31, 1.22)}, {**hands_of(GRIP, "r"), **hands_of(SPREAD, "l"), "hand_r": (-15, 0, 10), "hand_l": (20, 0, -10)}, {"r": TUCK_ELBOW_R, "l": (0.45, 0.2, 0.9)})
    keys = [(0.0, ready), (0.14, reach), (0.2, secure), (0.46, tuck), (T, tuck)]
    return Clip("ovl_catch_high" if high else "ovl_catch", "overlay", T, lambda t: keyed(keys, t), mask=arm_mask("l") + arm_mask("r"), events={"secure": 6})


def stiff_arm() -> Clip:
    """The free (left) arm drives out straight, palm to the tackler's facemask, and comes back."""
    T = 0.5
    side = carry_pose()
    side.arms = {"l": Arm(flex=20, elbow=85, abd=12, inward=0.1)}
    out = with_upper(carry_pose(), {"r": TUCK_R, "l": (0.30, -0.60, 1.34)}, {**hands_of(GRIP, "r"), **hands_of(SPREAD, "l"), "hand_r": (-15, 0, 10), "hand_l": (-70, 0, -10), "spine_03": (0, 0, 8), "spine_04": (0, 0, 6)}, {"r": TUCK_ELBOW_R, "l": (0.9, 0.2, 1.3)})
    keys = [(0.0, side), (0.13, out), (0.36, out), (T, side)]
    return Clip("ovl_stiff_arm", "overlay", T, lambda t: keyed(keys, t), mask=arm_mask("l") + arm_mask("r") + ["spine_03", "spine_04"])


def truck() -> Clip:
    """Lower the pads and lead with the shoulder, the off forearm up as a shield, head up."""
    T = 0.5
    base = carry_pose()
    base.arms = {"l": Arm(flex=20, elbow=85, abd=12, inward=0.1)}
    low = with_upper(carry_pose(), {"r": TUCK_R, "l": (0.04, -0.32, 1.40)}, {**hands_of(GRIP, "r"), **hands_of(FIST, "l"), "hand_r": (-15, 0, 10), "spine_02": (18, 0, 6), "spine_03": (10, 0, 4), "spine_04": (4, 0, 0), "neck_01": (-20, 0, 0), "head": (-12, 0, 0)}, {"r": TUCK_ELBOW_R, "l": (0.6, -0.7, 1.25)})
    keys = [(0.0, base), (0.12, low), (0.38, low), (T, base)]
    return Clip("ovl_truck", "overlay", T, lambda t: keyed(keys, t), mask=arm_mask("l") + arm_mask("r") + SPINE_UP + HEAD)


def pump() -> Clip:
    """Pump fake: the ball to the ear and the arm starts forward, then back to the chest."""
    T = 0.45
    hold = with_upper(IDLE, HOLD, {**GRIP, "hand_l": (-10, 0, -20), "hand_r": (-25, 0, 15)}, HOLD_ELBOW)
    ear = with_upper(IDLE, {"r": (-0.19, 0.04, 1.58), "l": (-0.09, -0.04, 1.51)}, {**GRIP, "hand_r": (-30, 0, 20), "spine_02": (0, 0, -8), "spine_03": (0, 0, -8)}, {"r": (-0.8, 0.3, 1.2), "l": (0.3, -0.2, 1.1)})
    fake = with_upper(IDLE, {"r": (-0.16, -0.20, 1.66), "l": (0.22, -0.25, 1.30)}, {**GRIP, "hand_r": (-10, 0, 10), "spine_02": (4, 0, 2), "spine_03": (2, 0, 2)}, {"r": (-0.8, -0.1, 1.4), "l": (0.6, 0.2, 1.1)})
    keys = [(0.0, hold), (0.12, ear), (0.22, fake), (T, hold)]
    return Clip("ovl_pump", "overlay", T, lambda t: keyed(keys, t), mask=arm_mask("l") + arm_mask("r") + SPINE_UP)


# --- Ball carrier moves (full body) ------------------------------------------


def run_at(frame: float) -> Pose:
    return gait_pose(RUN, frame % RUN.frames)


def juke_left() -> Clip:
    """Out of the run (left touch-down): the right foot plants wide, the hips
    sink, the push goes left; the left foot lands across, and the right
    touch-down hands back to the run (phase 0.5)."""
    T = 14 / FPS
    v = RUN.speed
    L = 0.75  # lateral move, m

    def fwd(t):
        return v * t - 0.45 * math.sin(math.pi * t / T) ** 2

    def side(t):
        return L * smoothstep(0.10, 0.40, t)

    def travel(t):
        return (side(t), -fwd(t))

    def at(p: Pose, t: float) -> Pose:
        return shift(p, side(t), -fwd(t))

    run0 = run_at(0)
    end = at(run_at(10), T)
    r1 = Foot(x=side(0.178) - 0.26, y=-fwd(0.178) - 0.06, heel=10, out=-16)
    l1 = Foot(x=side(0.345) + 0.10, y=-fwd(0.345) - 0.08, heel=6, out=12)
    steps = Steps([
        Plant("l", -1, 0.07, run0.feet["l"], roll=20),
        Plant("l", 0.30, 0.39, l1, roll=25),
        Plant("l", T, math.inf, end.feet["l"], contact=False),
        Plant("r", 0.12, 0.235, r1, roll=25),
        Plant("r", T, math.inf, end.feet["r"]),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}, height=0.12)

    def pose(t):
        p = at(run_at(10 * t / T), t)
        b = math.sin(math.pi * smoothstep(0.08, 0.36, t))
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.13 * b
        p.pelvis["lateral"] = p.pelvis.get("lateral", 0.0) + 12.0 * b
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + 10.0 * b
        p.pelvis["flex"] = p.pelvis.get("flex", 0.0) + 8.0 * b
        p.joints["spine_02"] = (p.joints.get("spine_02", (0, 0, 0))[0], 6.0 * b, p.joints.get("spine_02", (0, 0, 0))[2])
        p.gaze = (6.0, 12.0 * b)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("juke_l", "transition", T, pose, travel, "loco_run", "loco_run", steps, to_phase=0.5)


def spin() -> Clip:
    """Plant the left foot and pivot on its ball through a full turn to the
    left, the right leg swinging round; land on the left and go (phase 0)."""
    T = 14 / FPS
    v = RUN.speed

    def yaw(t):
        return 360.0 * smoothstep(0.03, 0.42, t)

    def fwd(t):
        # Onto the pivot: speed falls from the run to 0.4 m/s as (1 - t/0.25)^4 (never backward).
        a = 0.25
        x1 = 0.4 * a + (v - 0.4) * a / 5
        if t < a:
            return 0.4 * t + (v - 0.4) * a / 5 * (1 - (1 - t / a) ** 5)
        return _hermite(x1, x1 + 0.8, 0.4, 5.0, T - a, t - a)

    def travel(t):
        return (0.0, -fwd(t))

    def rot(x, y, deg):
        a = math.radians(deg)
        return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)

    run0 = run_at(0)
    end = shift(run_at(0), 0.0, -fwd(T))
    lf = run0.feet["l"]

    class Pivot:
        """The left foot pivoting on its ball: the contact stays, the foot turns."""

        def __call__(self, t):
            return replace(lf, heel=18.0, out=lf.out + yaw(min(t, 0.26)))

    rx, ry = rot(-0.22, -0.02, yaw(0.24))
    r_land = Foot(x=rx, y=ry - fwd(0.24), heel=16, out=4 - yaw(0.24))
    steps = Steps([
        Plant("l", -1, 0.26, lf, roll=0.0),
        Plant("l", T, math.inf, end.feet["l"]),
        Plant("r", 0.24, 0.38, r_land, roll=0.0),
        Plant("r", T, math.inf, end.feet["r"], contact=False),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}, height=0.14)
    pivot = Pivot()
    carry = carry_pose()

    def pose(t):
        base = shift(run_at(10 * t / T), 0.0, -fwd(t))
        tuck = shift(carry, 0.0, -fwd(t))
        p = mix(base, tuck, 0.0)
        # The ball stays tucked (the arm turns with the body), the left arm out for balance.
        rx_, ry_ = rot(TUCK_R[0], TUCK_R[1], yaw(t))
        ex, ey = rot(TUCK_ELBOW_R[0], TUCK_ELBOW_R[1], yaw(t))
        p.hands = {"r": (rx_, ry_ - fwd(t), TUCK_R[2])}
        p.elbow = {"r": (ex, ey - fwd(t), TUCK_ELBOW_R[2])}
        p.joints.update(hands_of(GRIP, "r"))
        p.arms = {"l": Arm(flex=35, elbow=55, abd=45, inward=0.1)}
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + yaw(t)
        p.pelvis["up"] = p.pelvis.get("up", 0.0) - 0.11 * math.sin(math.pi * smoothstep(0.0, 0.42, t))
        p.yaw = yaw(t)
        p.gaze = (6.0, 0.65 * yaw(t) if yaw(t) < 330 else 0.65 * yaw(t) * (1 - smoothstep(330, 360, yaw(t))), 0.6)
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        if t < 0.26:
            p.feet["l"] = pivot(t)
        return p

    return Clip("spin", "transition", T, pose, travel, "loco_run", "loco_run", steps, to_phase=0.0)


def _trailing_feet(p: Pose, t_air: float) -> dict:
    """Legs trailing behind a body going horizontal: the feet ride behind the hips."""
    up = p.pelvis.get("up", 0.0)
    flex = p.pelvis.get("flex", 0.0)
    k = min(1.0, max(0.0, (flex - 20) / 70))
    x0, y0 = p.pelvis.get("side", 0.0), -p.pelvis.get("forward", 0.0)
    z_hip = 0.975 + up
    back = 0.20 + 0.72 * k
    drop = max(0.0, z_hip - 0.10 - 0.72 * (1 - k))
    return {
        "l": Foot(x=x0 + 0.13, y=y0 + back, heel=30 + 58 * k, out=8, lift=max(0.0, drop - 0.02)),
        "r": Foot(x=x0 - 0.12, y=y0 + back + 0.05, heel=30 + 58 * k, out=4, lift=max(0.0, drop + 0.02)),
    }


def dive() -> Clip:
    """Push off the left foot, go horizontal with the ball out in front,
    land on the chest and slide to a stop: ends lying face down."""
    T = 0.8
    v = RUN.speed
    D = 2.4

    def fwd(t):
        return _hermite(0.0, D, v, 0.0, 0.62, min(t, 0.62))

    def travel(t):
        return (0.0, -fwd(t))

    prone = copy.deepcopy(STANCES["down_prone"])
    prone.arms = {"l": Arm(flex=165, elbow=15, abd=18, inward=0.1), "r": Arm(flex=168, elbow=12, abd=14, inward=0.1)}
    run0 = run_at(0)
    reach = copy.deepcopy(run0)
    reach.pelvis.update({"up": 0.02, "flex": 55})
    reach.arms = {"l": Arm(flex=120, elbow=25, abd=20, inward=0.1), "r": Arm(flex=125, elbow=20, abd=16, inward=0.1)}
    reach.joints.update({"neck_01": (-24, 0, 0), "head": (-12, 0, 0)})
    fly = copy.deepcopy(prone)
    fly.pelvis.update({"up": -0.55, "flex": 82})
    keys = [(0.0, run0), (0.16, reach), (0.36, fly), (0.47, prone), (T, prone)]

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
    return Clip("dive", "transition", T, pose, travel, "loco_run", "stance_down_prone", contacts=contacts)


def _blend_feet(a: Foot, b: Foot, t: float) -> Foot:
    from .transitions import _blend_foot

    return _blend_foot(a, b, t)


def tackle() -> Clip:
    """Form tackle out of the run: break down, contact (frame 8, 0.27 s) with
    the arms shooting round and squeezing, drive two steps, go down on top."""
    T = 0.9
    v = RUN.speed

    def fwd(t):
        if t < 0.27:
            return _hermite(0.0, 1.2, v, 2.2, 0.27, t)
        return _hermite(1.2, 2.3, 2.2, 0.0, T - 0.27 - 0.1, min(t - 0.27, T - 0.37))

    def travel(t):
        return (0.0, -fwd(t))

    run0 = run_at(0)
    gather = copy.deepcopy(run0)
    gather.pelvis.update({"up": -0.18, "flex": 38})
    gather.arms = {"l": Arm(flex=-25, elbow=95, abd=20, inward=0.05), "r": Arm(flex=-25, elbow=95, abd=20, inward=0.05)}
    gather.joints.update({"neck_01": (-22, 0, 0), "head": (-10, 0, 0), **FIST})
    wrap = with_upper(gather, {"l": (0.20, -0.58, 1.02), "r": (-0.20, -0.58, 1.02)}, {**GRIP, "neck_01": (-26, 0, 0), "head": (-12, 0, 0)}, {"l": (0.8, -0.3, 1.0), "r": (-0.8, -0.3, 1.0)})
    wrap.pelvis.update({"up": -0.22, "flex": 52})
    squeeze = with_upper(wrap, {"l": (0.05, -0.42, 0.98), "r": (-0.05, -0.42, 0.98)}, {**FIST}, {"l": (0.8, -0.1, 0.9), "r": (-0.8, -0.1, 0.9)})
    squeeze.pelvis.update({"up": -0.26, "flex": 60})
    prone = copy.deepcopy(STANCES["down_prone"])
    prone.hands = {"l": (0.10, -0.45, 0.22, 0.6), "r": (-0.10, -0.45, 0.22, 0.6)}
    going = copy.deepcopy(prone)
    going.pelvis.update({"up": -0.50, "flex": 75})
    keys = [(0.0, run0), (0.12, gather), (0.27, wrap), (0.36, squeeze), (0.6, going), (0.72, prone), (T, prone)]
    r1 = Foot(x=-0.10, y=-fwd(0.2) - 0.08, heel=20, out=4)
    l1 = Foot(x=0.12, y=-fwd(0.40) - 0.02, heel=24, out=6)
    steps = Steps([
        Plant("l", -1, 0.08, run0.feet["l"], roll=20),
        Plant("l", 0.36, 0.46, l1, roll=30),
        Plant("r", 0.18, 0.30, r1, roll=25),
    ], before={"r": lambda t: shift(run_at(t * FPS), 0.0, -v * t).feet["r"]}, height=0.08)

    def pose(t):
        p = shift(keyed(keys, t), 0.0, -fwd(t))
        if t < 0.46:
            p.feet = {s: steps.foot(s, t) for s in "lr"}
        else:
            trail = _trailing_feet(p, t)
            a = smoothstep(0.46, 0.56, t)
            p.feet = {s: _blend_feet(steps.foot(s, 0.46), trail[s], a) for s in "lr"}
        p.knee = (0.0, -0.9 * (1 - smoothstep(0.45, 0.7, t)), -0.9 * smoothstep(0.45, 0.7, t))
        return p

    contacts = steps.contacts(round(0.46 * FPS))
    contacts = {s: [c for c in contacts[s]] + [[round(0.8 * FPS), round(T * FPS)]] for s in "lr"}
    return Clip("tackle", "transition", T, pose, travel, "loco_run", "stance_down_prone", contacts=contacts, events={"contact": 8})


def getup_prone() -> Clip:
    """Up from face down: push up on the hands, knees under, one foot
    forward, stand."""
    T = 1.1
    prone = copy.deepcopy(STANCES["down_prone"])
    push = copy.deepcopy(prone)
    push.pelvis.update({"up": -0.66, "flex": 72})
    push.hands = {"l": (0.20, -0.40, 0.10), "r": (-0.20, -0.40, 0.10)}
    push.arms = {}
    push.elbow = {"l": (0.6, 0.2, 0.3), "r": (-0.6, 0.2, 0.3)}
    push.joints.update({"neck_01": (-20, 0, 0), "head": (-8, 0, 0), **SPREAD})
    kneel = Pose(
        pelvis={"forward": -0.05, "up": -0.40, "flex": 55},
        joints={"spine_02": (6, 0, 0), "neck_01": (-18, 0, 0), **SPREAD},
        feet={"l": Foot(0.15, 0.48, heel=86, out=6), "r": Foot(-0.14, 0.50, heel=86, out=4)},
        hands={"l": (0.20, -0.34, 0.10, 0.7), "r": (-0.20, -0.34, 0.10, 0.7)},
        elbow={"l": (0.6, 0.2, 0.4), "r": (-0.6, 0.2, 0.4)},
        knee=(0.0, -0.3, -0.8),
    )
    lunge = Pose(
        pelvis={"forward": -0.10, "up": -0.32, "flex": 38},
        joints={"spine_02": (6, 0, 0), "neck_01": (-10, 0, 0), **RELAXED},
        feet={"l": Foot(0.14, -0.22, heel=0, out=8), "r": Foot(-0.14, 0.46, heel=80, out=4)},
        hands={"l": (0.16, -0.24, 0.62, 0.8)},
        knee=(0.0, -0.9, -0.2),
    )
    idle = copy.deepcopy(IDLE)
    keys = [(0.0, prone), (0.28, push), (0.55, kneel), (0.8, lunge), (T, idle)]
    steps = Steps([
        Plant("l", -1, 0.40, prone.feet["l"]), Plant("l", 0.55, 0.62, kneel.feet["l"]), Plant("l", 0.74, math.inf, idle.feet["l"]),
        Plant("r", -1, 0.42, prone.feet["r"]), Plant("r", 0.56, 0.86, kneel.feet["r"]), Plant("r", 1.02, math.inf, idle.feet["r"]),
    ], height=0.08)

    def pose(t):
        p = keyed(keys, t)
        if t > 0.8:
            k = smoothstep(0.8, T, t)
            p.hands = {s: (*h[:3], (h[3] if len(h) > 3 else 1.0) * (1 - k)) for s, h in lunge.hands.items()}
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("getup_prone", "transition", T, pose, None, "stance_down_prone", "stance_idle", steps)


def getup_supine() -> Clip:
    """Up from the back: sit up with the hands behind, feet under, push up over them."""
    T = 1.2
    sup = copy.deepcopy(STANCES["down_supine"])
    sit = Pose(
        pelvis={"forward": 0.0, "up": -0.80, "flex": 8},
        joints={"spine_02": (12, 0, 0), "spine_03": (8, 0, 0), **SPREAD},
        feet={"l": Foot(0.16, -0.42, heel=0, out=10), "r": Foot(-0.16, -0.40, heel=0, out=12)},
        hands={"l": (0.26, 0.22, 0.10, 0.8), "r": (-0.26, 0.24, 0.10, 0.8)},
        elbow={"l": (0.6, 0.4, 0.3), "r": (-0.6, 0.4, 0.3)},
        knee=(0.0, -0.4, 0.8),
    )
    squat = Pose(
        pelvis={"forward": -0.30, "up": -0.52, "flex": 48},
        joints={"spine_02": (10, 0, 0), "neck_01": (-10, 0, 0), **RELAXED},
        feet={"l": Foot(0.16, -0.42, heel=10, out=10), "r": Foot(-0.16, -0.40, heel=10, out=12)},
        hands={"l": (0.18, -0.55, 0.40, 0.7), "r": (-0.18, -0.55, 0.40, 0.7)},
        knee=(0.0, -0.9, 0.2),
    )
    idle = shift(copy.deepcopy(IDLE), 0.0, -0.32)
    keys = [(0.0, sup), (0.4, sit), (0.8, squat), (T, idle)]
    steps = Steps([
        Plant("l", -1, 0.05, sup.feet["l"]), Plant("l", 0.35, 0.95, sit.feet["l"]), Plant("l", 1.1, math.inf, idle.feet["l"]),
        Plant("r", -1, 0.08, sup.feet["r"]), Plant("r", 0.38, math.inf, sit.feet["r"]),
    ], height=0.06)

    def pose(t):
        p = keyed(keys, t)
        if t > 0.8:
            k = smoothstep(0.8, T, t)
            p.hands = {s: (*h[:3], (h[3] if len(h) > 3 else 1.0) * (1 - k)) for s, h in squat.hands.items()}
        p.feet = {s: steps.foot(s, t) for s in "lr"}
        return p

    return Clip("getup_supine", "transition", T, pose, None, "stance_down_supine", "stance_idle", steps)


def action_clips() -> list[Clip]:
    from .actions_m55 import m55_clips  # (imports this module's helpers)
    from .actions_m6 import m6_clips

    jl = juke_left()
    return [
        qb_drop(3), qb_drop(5), qb_throw(),
        carry(), protect(), qb_hold(), catch(False), catch(True), stiff_arm(), truck(), pump(),
        jl, mirrored(jl, "juke_r", to_phase=0.0), spin(), dive(), tackle(), getup_prone(), getup_supine(),
        *m55_clips(),
        *m6_clips(),
    ]


# Stances added here (build_anims.py makes them breathing loops); lying ones skip the balance gate.
NO_BALANCE = {"down_prone", "down_supine"}

# The M6 modules add stances to the table when imported (the pass set, the
# snapper, the holder...): import them now so build_anims.py sees them.
from . import actions_m6_back7, actions_m6_line, actions_m6_special  # noqa: E402,F401
from .actions_m6 import NO_BALANCE as _M6_NO_BALANCE  # noqa: E402

NO_BALANCE |= _M6_NO_BALANCE

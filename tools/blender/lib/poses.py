"""Named key poses (TECH_PLAN §9.1 pose library) and how to apply one.

A pose is control values, not bone matrices: where the pelvis sits and how
it's tilted, spine/neck/arm angles (anatomical: flex, abduct, twist, degrees,
relative to the A-pose rest), where each foot's ball touches the field (with
heel raise and toe-out), and optional IK targets for hands (a hand on the
turf, hands on the knees). Blender's IK then solves the legs (and those
hands), and the build bakes everything to FK keys.

Numbers come from coaching descriptions of each stance: e.g. the lineman's
three-point stance has feet about shoulder width, the down-hand side foot
staggered back to the instep, the back flat and the down hand just inside
the foot line and a little ahead of the shoulders; the defensive back sits
on the balls of the feet with knees bent and chest over the toes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import bpy
from mathutils import Matrix, Quaternion, Vector

from .anim_rig import SIDES, Controls, reset_pose, set_joint, set_pelvis
from .skeleton import J

BALL_REST = {s: Vector(J[f"ball_{s}"]) for s in SIDES}
ANKLE_REST = {s: Vector(J[f"ankle_{s}"]) for s in SIDES}
# The heel's ground contact: under the ankle, 6.5 cm behind it (the foot mesh's
# heel ring, body.py), at the sole.
HEEL_REST = {s: Vector((J[f"ankle_{s}"][0], J[f"ankle_{s}"][1] + 0.065, 0.012)) for s in SIDES}
THIGH_LEN = (Vector(J["knee_l"]) - Vector(J["hip_l"])).length
SHANK_LEN = (Vector(J["ankle_l"]) - Vector(J["knee_l"])).length


@dataclass
class Foot:
    x: float  # ball of the foot on the field (m): +x left
    y: float  # -y forward
    heel: float = 0.0  # heel raise (deg): 0 flat, ~20 on the balls of the feet, negative = toes up
    out: float = 8.0  # toe-out (deg)
    lift: float = 0.0  # ball height above the field (m), for swing phases
    # With the toes up (heel < 0) the foot pivots on its heel, which stays on
    # the field where the flat foot's heel would be (heel strike); otherwise
    # it pivots on the ball.
    # Swing leg shaped by the hip and knee instead of by the foot:
    # (thigh flexion from vertical, knee flexion, weight 0..1). apply_pose
    # solves the ankle from the actual hip and blends the ball toward it.
    fk: tuple | None = None


@dataclass
class Arm:
    """A swinging arm in the thorax frame (degrees)."""

    flex: float  # upper arm forward (+) or back (-) of straight down, in the sagittal plane
    elbow: float  # elbow flexion (0 straight)
    abd: float = 8.0  # upper arm out from the side
    inward: float = 0.2  # forearm angled toward the midline (share of the bend)
    clavicle: float = 0.0  # shoulder girdle protraction (+) with the arm forward
    weight: float = 1.0  # how far the aim overrides the keyed joints (transitions fade it)


@dataclass
class Pose:
    pelvis: dict = field(default_factory=dict)  # forward, up, side, flex, lateral, twist
    joints: dict = field(default_factory=dict)  # bone -> (flex, abd, twist)
    feet: dict = field(default_factory=dict)  # side -> Foot
    hands: dict = field(default_factory=dict)  # side -> (x, y, z[, weight]) wrist target; IK on
    arms: dict = field(default_factory=dict)  # side -> Arm (aimed after the spine is posed)
    # Head held to a world gaze: (pitch down deg, yaw deg[, neck share]).
    gaze: tuple | None = None
    # Where the knees point (the IK poles), as a world offset from the middle
    # of each leg: forward by default; down for a player lying face down, up
    # on his back. `yaw` (deg, + left) turns the default with a spinning body.
    knee: tuple | None = None
    yaw: float = 0.0
    # Where the elbows point under hand IK: side -> world point (default:
    # behind and out, the rig's calibration).
    elbow: dict = field(default_factory=dict)
    # The facing (deg, + left) of the plane a hip-and-knee shaped swing
    # (Foot.fk) moves in: 0 runs toward -Y; a body turned by rotate_pose
    # (actions_m6.py) swings its legs along its own facing.
    fk_dir: float = 0.0


def _foot_rot(s: str, f: Foot) -> Quaternion:
    sign = 1.0 if s == "l" else -1.0
    yaw = Quaternion((0, 0, 1), math.radians(f.out * sign))
    pitch = Quaternion((1, 0, 0), math.radians(f.heel))
    return yaw @ pitch


def foot_ankle(s: str, f: Foot) -> Vector:
    """Where the ankle goes for this foot placement (heel or ball pivot)."""
    rot = _foot_rot(s, f)
    yaw = Quaternion((0, 0, 1), math.radians(f.out * (1.0 if s == "l" else -1.0)))
    ball = Vector((f.x, f.y, BALL_REST[s].z + f.lift))
    if f.heel < 0:
        # Heel strike: the heel sits where the flat foot's heel would be.
        heel = ball + yaw @ (HEEL_REST[s] - BALL_REST[s])
        return heel + rot @ (ANKLE_REST[s] - HEEL_REST[s])
    return ball + rot @ (ANKLE_REST[s] - BALL_REST[s])


def place_foot(c: Controls, s: str, f: Foot) -> None:
    c.foot[s].location = foot_ankle(s, f)
    c.foot[s].rotation_quaternion = _foot_rot(s, f) @ c.foot_rest[s]


def _fk_ankle(rig, s: str, alpha: float, kappa: float, facing: float = 0.0) -> Vector:
    """Ankle position for a thigh flexed `alpha` from vertical and a knee
    flexed `kappa`, from the posed hip, in the body's sagittal plane (-Y
    forward, turned `facing` degrees to the left)."""
    hip = rig.matrix_world @ rig.pose.bones[f"thigh_{s}"].head
    a, k = math.radians(alpha), math.radians(alpha - kappa)
    f = math.radians(facing)
    fwd, up = Vector((math.sin(f), -math.cos(f), 0)), Vector((0, 0, 1))
    return hip + (fwd * math.sin(a) - up * math.cos(a)) * THIGH_LEN + (fwd * math.sin(k) - up * math.cos(k)) * SHANK_LEN


def _set_matrix(rig, bone: str, x: Vector, y: Vector, weight: float = 1.0) -> None:
    """Point a bone along y with its hinge axis x (pose space), keeping its
    head; with weight < 1, only that far from its current orientation."""
    pb = rig.pose.bones[bone]
    y = y.normalized()
    x = (x - y * x.dot(y)).normalized()
    z = x.cross(y)
    q = Matrix((x, y, z)).transposed().to_quaternion()
    if weight < 1.0:
        q = pb.matrix.to_quaternion().slerp(q, weight)
    m = q.to_matrix().to_4x4()
    m.translation = pb.head
    pb.matrix = m


def aim_arms(rig, arms: dict) -> None:
    """Swing the arms in the thorax frame: shoulder angle, elbow bend,
    elbows a little out, forearms angled toward the midline."""
    if not arms:
        return
    t = rig.pose.bones["spine_04"].matrix.to_3x3()
    left, up, fwd = t.col[0].normalized(), t.col[1].normalized(), t.col[2].normalized()
    for s, a in arms.items():
        if a.clavicle:
            # Protraction: +X on the clavicle swings the shoulder forward.
            set_joint(rig, f"clavicle_{s}", a.clavicle * a.weight, 0.0, 0.0)
    bpy.context.view_layer.update()
    fore = {}
    for s, a in arms.items():
        out = left * (1.0 if s == "l" else -1.0)
        th, ph = math.radians(a.flex), math.radians(a.abd)
        d = (out * math.sin(ph) - up * math.cos(th) * math.cos(ph) + fwd * math.sin(th) * math.cos(ph)).normalized()
        e = fwd * math.cos(th) + up * math.sin(th)
        e = (e - d * e.dot(d)).normalized()
        e = (e - out * a.inward)
        e = (e - d * e.dot(d)).normalized()
        hinge = d.cross(e)
        _set_matrix(rig, f"upperarm_{s}", hinge, d, a.weight)
        ep = math.radians(a.elbow)
        fore[s] = (hinge, d * math.cos(ep) + e * math.sin(ep), a.weight)
    bpy.context.view_layer.update()
    for s, (hinge, f, w) in fore.items():
        _set_matrix(rig, f"forearm_{s}", hinge, f, w)
    bpy.context.view_layer.update()


def hold_gaze(rig, pitch: float, yaw: float = 0.0, share: float = 0.45, weight: float = 1.0, follow: float = 0.35) -> None:
    """Turn the neck and head so the face looks along a steady world direction
    (runners keep their eyes level while the trunk rotates and bobs). The
    head still follows `follow` of the shoulders' turn: holding it dead
    still would twist the neck hard against the pads."""
    t = rig.pose.bones["spine_04"].matrix.to_3x3().col[2]
    yaw += follow * math.degrees(math.atan2(t.x, -t.y))
    head = rig.pose.bones["head"]
    cur = head.matrix.to_quaternion()
    # The head's rest frame looks forward (local Z = world -Y) with its bone
    # pointing up; build the wanted frame from pitch (down +) and yaw (left +).
    # A positive rotation about +X tips the face (-Y) down toward -Z.
    want = Quaternion((0, 0, 1), math.radians(yaw)) @ Quaternion((1, 0, 0), math.radians(pitch)) @ rig.data.bones["head"].matrix_local.to_quaternion()
    if weight < 1.0:
        want = cur.slerp(want, weight)
    delta = want @ cur.inverted()
    for bone, w in (("neck_01", share * 0.5), ("neck_02", share * 0.5)):
        pb = rig.pose.bones[bone]
        part = Quaternion().slerp(delta, w)
        m = pb.matrix.copy()
        r = (part @ m.to_quaternion()).to_matrix().to_4x4()
        r.translation = m.translation
        pb.matrix = r
        bpy.context.view_layer.update()
    head = rig.pose.bones["head"]
    r = want.to_matrix().to_4x4()
    r.translation = head.matrix.translation
    head.matrix = r
    bpy.context.view_layer.update()


# Relaxed arms at the sides from the A-pose: down 40°, a little forward, the
# elbow soft.
ARMS_DOWN = {
    "upperarm_l": (6, -40, 0), "upperarm_r": (6, -40, 0),
    "forearm_l": (14, 0, 0), "forearm_r": (14, 0, 0),
}


def apply_pose(rig, c: Controls, p: Pose) -> None:
    reset_pose(rig)
    set_pelvis(rig, **p.pelvis)
    for s in SIDES:
        c.arm_ik(s, 0.0)
    joints = {**ARMS_DOWN, **p.joints}
    for bone, ang in joints.items():
        set_joint(rig, bone, *ang)
    feet = p.feet or {"l": Foot(0.13, -0.11), "r": Foot(-0.13, -0.11)}
    bpy.context.view_layer.update()
    for s in SIDES:
        f = feet[s]
        if f.fk:
            alpha, kappa, w = f.fk
            ankle = _fk_ankle(rig, s, alpha, kappa, p.fk_dir)
            base = foot_ankle(s, f)
            c.foot[s].location = base.lerp(ankle, w)
            c.foot[s].rotation_quaternion = _foot_rot(s, f) @ c.foot_rest[s]
        else:
            place_foot(c, s, f)
    # Knee poles follow the leg: ahead of the hip-to-ankle midpoint and a
    # little out with the toes, so a knee driven up past a fixed pole doesn't
    # swing outward.
    for s in SIDES:
        hip = rig.matrix_world @ rig.pose.bones[f"thigh_{s}"].head
        mid = (hip + c.foot[s].location) / 2
        if p.knee is not None:
            c.knee[s].location = mid + Vector(p.knee)
            continue
        off = Vector((0.12 * (1 if s == "l" else -1) * math.sin(math.radians(feet[s].out + 6)), -0.9, 0.0))
        c.knee[s].location = mid + (Quaternion((0, 0, 1), math.radians(p.yaw)) @ off if p.yaw else off)
    for s in SIDES:
        c.elbow[s].location = Vector(p.elbow[s]) if s in p.elbow else c.elbow_rest[s]
    for s, h in p.hands.items():
        c.arm_ik(s, h[3] if len(h) > 3 else 1.0)
        c.hand[s].location = Vector(h[:3])
    if p.arms or p.gaze:
        bpy.context.view_layer.update()
        aim_arms(rig, p.arms)
        if p.gaze:
            hold_gaze(rig, *p.gaze)


def mirror(p: Pose) -> Pose:
    """Left-right mirror (a right-handed stance from a left-handed one)."""
    def sw(n: str) -> str:
        return n[:-2] + ("_r" if n.endswith("_l") else "_l") if n.endswith(("_l", "_r")) else n

    pel = dict(p.pelvis)
    for k in ("side", "lateral", "twist"):
        if k in pel:
            pel[k] = -pel[k]
    joints = {}
    for b, (fl, ab, tw) in p.joints.items():
        # Spine/neck side-bend and twist flip sign; limbs swap sides (their abd/twist already mirror).
        joints[sw(b)] = (fl, ab, tw) if b.endswith(("_l", "_r")) else (fl, -ab, -tw)
    feet = {("r" if s == "l" else "l"): Foot(-f.x, f.y, f.heel, f.out, f.lift) for s, f in p.feet.items()}
    hands = {("r" if s == "l" else "l"): (-x, y, z) for s, (x, y, z) in p.hands.items()}
    return Pose(pel, joints, feet, hands)


# Hand states (clips key one per hand; rig.py rolls the fingers so +X curls
# them into the palm). Angles per finger joint: knuckle (01), middle (02),
# tip (03); the thumb's 01 is its base at the wrist, which opposes it.
def _hand(fingers, index=None, thumb=((0, 0, 0), (0, 0, 0), (0, 0, 0)), spread=0.0):
    index = index or fingers
    out = {}
    for s in SIDES:
        for i, n in enumerate(("01", "02", "03")):
            out[f"fingers_{n}_{s}"] = (fingers[i], -spread * 0.5 if n == "01" else 0.0, 0.0)
            out[f"index_{n}_{s}"] = (index[i], spread if n == "01" else 0.0, 0.0)
            out[f"thumb_{n}_{s}"] = thumb[i]
    return out


# Relaxed: a soft natural curl, thumb resting beside the index.
RELAXED = _hand((14, 22, 12), thumb=((6, 0, 0), (10, 0, 0), (8, 0, 0)))
# Fist: knuckles bent square, fingers closed into the palm, the thumb folded
# across the index and middle fingers.
FIST = _hand((88, 102, 62), thumb=((28, -18, 34), (34, 0, 0), (30, 0, 0)))
# Spread: fingers long and apart, thumb out (a quarterback's target hands,
# a lineman's punch).
SPREAD = _hand((6, 10, 6), index=(4, 8, 4), thumb=((-8, 26, -10), (4, 0, 0), (2, 0, 0)), spread=16)
# Gripping a football: fingers wrapped over the laces, thumb under the ball.
GRIP = _hand((42, 48, 30), index=(34, 38, 24), thumb=((24, -10, 28), (22, 0, 0), (16, 0, 0)), spread=10)
HAND_STATES = {"relaxed": RELAXED, "fist": FIST, "spread": SPREAD, "grip": GRIP}
# Older names used by the stances.
OPEN = RELAXED
LOOSE_FIST = FIST

# --- Stances -----------------------------------------------------------------
# Hips sit back to balance a forward trunk: each stance's pelvis offset was
# set so the centre of mass falls inside the feet (build_anims.py gate).

STANCES: dict[str, Pose] = {}

# Standing idle: weight on the left leg (the right knee soft and the foot
# turned out), hip dropped a touch on the relaxed side, shoulders level;
# arms hang loose with the elbows bent and the hands in a soft curl, the
# right a little forward. Not a mannequin's symmetric A-pose.
STANCES["idle"] = Pose(
    pelvis={"up": -0.02, "side": 0.022, "lateral": 2.5, "twist": 3},
    joints={"spine_01": (1, -1.5, 0), "spine_02": (2, -1.0, -1), "neck_01": (3, 0, 0), "head": (-2, 1, 0), **RELAXED},
    feet={"l": Foot(0.13, -0.10, out=9), "r": Foot(-0.17, -0.15, heel=5, out=15)},
    arms={"l": Arm(flex=3, elbow=17, abd=11, inward=0.1), "r": Arm(flex=9, elbow=27, abd=9, inward=0.15)},
)

# Offensive lineman, three-point (right hand down). Coaching: feet a little
# wider than the shoulders, the down-hand-side foot back heel-to-toe; hips
# up (~0.78 m here, 0.80-0.85 for a 6'4" tackle), back flat with the head
# up; the down hand light on the fingertips, just inside the back foot and
# under the shoulder, so he can fire out or pass-set straight back (~25% of
# the weight on the hand). The off forearm rests on the thigh. The pelvis
# and hand were searched against those targets (hip height, back angle,
# hand load, balance: build_anims.py STANCE_TARGETS).
STANCES["ol_3pt"] = Pose(
    pelvis={"forward": -0.24, "up": -0.21, "flex": 88},
    joints={
        "spine_01": (3, 0, 0), "spine_02": (3, 0, 0), "spine_03": (2, 0, 0),
        "clavicle_r": (0, -6, 0),
        "upperarm_l": (40, -30, 10), "forearm_l": (70, 0, 0), "hand_l": (-10, 0, 0),
        **FIST, **{k: v for k, v in SPREAD.items() if k.endswith("_r")},
    },
    feet={"l": Foot(0.25, -0.06, heel=14, out=6), "r": Foot(-0.24, 0.08, heel=22, out=4)},
    hands={"r": (-0.16, -0.36, 0.165)},
    gaze=(-4.0, 0.0, 0.85),  # the neck extends to lift the head over the shoulders
)

# Defensive lineman, three-point (right hand down): lower than the O-line,
# heels up and the weight forward over a loaded fist (~45% on the hand), a
# wider stagger to launch off the back foot.
STANCES["dl_3pt"] = Pose(
    pelvis={"forward": 0.04, "up": -0.315, "flex": 88},
    joints={
        "spine_01": (4, 0, 0), "spine_02": (5, 0, 0), "spine_03": (3, 0, 0),
        "clavicle_r": (0, -8, 0),
        "upperarm_l": (30, -20, 0), "forearm_l": (60, 0, 0), **FIST,
    },
    feet={"l": Foot(0.23, -0.04, heel=26, out=4), "r": Foot(-0.23, 0.14, heel=32, out=4)},
    hands={"r": (-0.15, -0.72, 0.075)},
    gaze=(-4.0, 0.0, 0.85),  # the neck extends to lift the head over the shoulders
)

# Defensive lineman four-point (both fists down): hips at or above the
# shoulders, heels up, half the weight on the hands.
STANCES["dl_4pt"] = Pose(
    pelvis={"forward": 0.04, "up": -0.29, "flex": 90},
    joints={
        "spine_01": (4, 0, 0), "spine_02": (6, 0, 0), "spine_03": (4, 0, 0),
        "clavicle_l": (0, -6, 0), "clavicle_r": (0, -6, 0), **FIST,
    },
    feet={"l": Foot(0.24, 0.0, heel=28, out=4), "r": Foot(-0.24, 0.06, heel=30, out=4)},
    hands={"l": (0.17, -0.70, 0.075), "r": (-0.17, -0.70, 0.075)},
    gaze=(-4.0, 0.0, 0.85),  # the neck extends to lift the head over the shoulders
)

# Receiver's two-point stance: staggered, outside foot back, chest over the front knee.
STANCES["wr_2pt"] = Pose(
    pelvis={"forward": -0.13, "up": -0.14, "flex": 26, "twist": -6},
    joints={
        "spine_02": (8, 0, 0), "spine_03": (6, 0, 0), "neck_01": (-14, 0, 0), "head": (-8, 0, 0),
        "upperarm_l": (30, -34, 0), "forearm_l": (70, 0, 0),
        "upperarm_r": (10, -30, 0), "forearm_r": (55, 0, 0), **OPEN,
    },
    feet={"l": Foot(0.10, -0.22, heel=10, out=0), "r": Foot(-0.13, 0.28, heel=34, out=6)},
    gaze=(2.0, 30.0),  # eyes inside on the ball, not the turf
)

# Linebacker ready: square, feet a bit wider than the shoulders, hips down, hands up.
STANCES["lb_ready"] = Pose(
    pelvis={"forward": -0.07, "up": -0.20, "flex": 30},
    joints={
        "spine_02": (8, 0, 0), "spine_03": (4, 0, 0), "neck_01": (-16, 0, 0), "head": (-10, 0, 0),
        "upperarm_l": (40, -26, 0), "forearm_l": (78, 0, 0),
        "upperarm_r": (40, -26, 0), "forearm_r": (78, 0, 0), **OPEN,
    },
    feet={"l": Foot(0.26, -0.08, heel=14, out=8), "r": Foot(-0.26, -0.06, heel=14, out=8)},
    gaze=(4.0, 0.0),  # reading the backfield
)

# Defensive back (off coverage): on the balls of the feet, one foot back, chest over the toes.
STANCES["db_ready"] = Pose(
    pelvis={"forward": -0.11, "up": -0.17, "flex": 32},
    joints={
        "spine_02": (10, 0, 0), "spine_03": (6, 0, 0), "neck_01": (-18, 0, 0), "head": (-10, 0, 0),
        "upperarm_l": (24, -32, 0), "forearm_l": (70, 0, 0),
        "upperarm_r": (24, -32, 0), "forearm_r": (70, 0, 0), **OPEN,
    },
    feet={"l": Foot(0.17, -0.18, heel=24, out=2), "r": Foot(-0.17, 0.10, heel=30, out=4)},
    gaze=(2.0, 0.0),  # eyes on the quarterback
)

# Running back (I-formation / offset): hands on the thighs, eyes up.
STANCES["rb_2pt"] = Pose(
    pelvis={"forward": -0.06, "up": -0.18, "flex": 40},
    joints={"spine_02": (10, 0, 0), "spine_03": (8, 0, 0), "neck_01": (-24, 0, 0), "head": (-16, 0, 0), **OPEN},
    feet={"l": Foot(0.19, -0.10, heel=12, out=6), "r": Foot(-0.19, -0.10, heel=12, out=6)},
    hands={"l": (0.16, -0.14, 0.66), "r": (-0.16, -0.14, 0.66)},
    gaze=(4.0, 0.0),  # eyes up on the defense
)

# Quarterback under center: knees bent, hands under the center (at his crotch height).
STANCES["qb_center"] = Pose(
    pelvis={"forward": -0.11, "up": -0.16, "flex": 34},
    joints={"spine_02": (12, 0, 0), "spine_03": (8, 0, 0), "neck_01": (-14, 0, 0), "head": (-12, 0, 0), **OPEN},
    feet={"l": Foot(0.20, -0.06, heel=8, out=8), "r": Foot(-0.20, -0.04, heel=8, out=8)},
    hands={"l": (0.03, -0.31, 0.66), "r": (-0.03, -0.3, 0.63)},
    gaze=(4.0, 0.0),  # surveying the defense
)

# Quarterback in the shotgun: feet shoulder width on the balls of the
# feet, knees bent, a slight forward lean; hands out at the waist with the
# fingers spread and the palms turned toward the center, thumbs in, a target
# for the snap (not held flat in front).
STANCES["qb_gun"] = Pose(
    pelvis={"forward": -0.05, "up": -0.10, "flex": 16},
    joints={
        "spine_02": (5, 0, 0), "spine_03": (3, 0, 0),
        # Wrists back, turned so the palms face the center, fingers up and out.
        "hand_l": (-55, 0, 20), "hand_r": (-55, 0, 20),
        **SPREAD,
    },
    feet={"l": Foot(0.19, -0.10, heel=10, out=6), "r": Foot(-0.19, -0.08, heel=10, out=6)},
    hands={"l": (0.11, -0.34, 0.97), "r": (-0.11, -0.34, 0.97)},
    gaze=(2.0, 0.0),
)

# The huddle: bent at the waist, hands on the knees, listening.
STANCES["huddle"] = Pose(
    pelvis={"forward": -0.09, "up": -0.12, "flex": 60},
    joints={"spine_02": (8, 0, 0), "spine_03": (6, 0, 0), "neck_01": (-22, 0, 0), "head": (-10, 0, 0), **OPEN},
    feet={"l": Foot(0.20, -0.10, out=10), "r": Foot(-0.20, -0.10, out=10)},
    # Hands on the lower thighs, just above the knees (knees at ~0.47 m).
    hands={"l": (0.16, -0.1, 0.57), "r": (-0.16, -0.1, 0.57)},
    gaze=(24.0, 0.0),  # listening, eyes on the play caller inside the huddle
)

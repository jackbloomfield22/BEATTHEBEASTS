"""Animation round 17 (docs/passing/PASSING17.md): the quarterback's feet in
the pocket. Keyed here with our own gait keyer (gait.py, CLAUDE.md rule 6);
no captured or third-party motion.

Round 16 left the passer moving in the pocket on other men's loops: a slide
played the linebacker's shuffle (the hips 26 cm under his set, the trunk
pitched 26 deg: a scrape, not a pocket slide), a climb the ball carrier's
traffic gait (the hips 12-17 cm under the set), and a drift back the
defensive back's pedal. Out of any of them the throw rose ~25 cm into the
release (choreo.ts FINISH_PLANTED's legs, keyed on the set).

The pocket's movement, from coaching descriptions (the "pocket movement"
drills: slide, climb, reset):
- The base never changes: the feet a little wider than the shoulders, the
  knees flexed 25-40 deg, the weight on the balls of the feet. He moves in
  his set, so he can throw off any step: the hips at the set's height
  (qb_set: 0.97 m) give or take a few centimetres.
- Slide: short, quick steps sideways, a few inches off the turf; the lead
  foot steps and the trail foot replaces it. Never cross the feet, never
  click the heels (a crossover takes him out of a throwing base).
- Climb (step up): short choppy steps up, the front foot first, the ball
  high and tight in both hands at the chest, the eyes downfield.
- Drift (back): the same short steps straight back off the rush, square.
- Through all of it the ball stays at the chest in both hands ("carry it
  high, two hands, ready to throw"), the eyes downfield (the game's look-at
  points the head at his read).

The game plays them on the side layer ('qb': the slide), the pocket's gait
family (the climb) and the pedal ('qb': the drift), each paced by the sim's
velocity (src/anim/animator.ts).
"""

from __future__ import annotations

from .actions import HOLD, HOLD_ELBOW, STANCES, Clip, mirror_pose
from .gait import FPS, Gait, contacts as gait_contacts, gait_pose
from .poses import GRIP

# The set's hips (actions.py SET_UP: 0.03 m under the rig's rest, 0.969 m) and the hold's
# (ovl_qb_hold is keyed on the idle body, whose hips are 0.085 m under the rest: the hands
# rise with the hips, as qb_set's do, SET_RISE).
HOLD_HIPS = -0.085
QB_TRUNK = 18.0  # the keyer's lean: pelvis flex lean*0.65 = 11.7 deg plus the spine's ~5.4 (qb_set: 12 + 4 + 3)

# The slide (to the left). A pocket slide at a walk's pace: 1.8 m/s, ten frames a cycle
# (six steps a second), the step ~0.3 m; a quarter of a metre either side of the hips (the
# set's 0.42 m base, a touch wider moving), the lift 4.5 cm.
QB_SHUFFLE = Gait(
    "qb_shuffle", frames=10, speed=1.8, duty=5.49 / 10, width=0.25, pelvis_up=-0.045, bob=0.008, sway=0.0, drop=2, turn=0, counter=0, lean=QB_TRUNK,
    arm_c=0, arm_a=0, elbow=90, elbow_d=0, hand="grip",
    hip_max=24, hip_ext=-8, knee_max=48, retract=0, fk=0.0, lift=0.045,
    strike=10, flat_by=0.1, heel_mid=8, rise_at=0.5, toe_off=20, dorsi=0, gaze=3, dir=(1.0, 0.0), ahead=0.5,
)
# The quick slide (away from a free rusher): 3.6 m/s, eight frames a cycle (7.5 steps a
# second), the step ~0.48 m, a little lower, the lift 6 cm. The base: the feet 0.14 m apart
# at their closest and 0.90 m at their widest (2 x width -/+ the 0.38 m each covers planted:
# a shorter stance than the slow slide's share, so the stride opens no wider than a big
# set; at 0.45 of the cycle it opened to a metre). The game plays it to ~1.4x (the player's
# stick slides him at 0.55 of his top speed, ~4.3 m/s).
QB_SHUFFLE_FAST = Gait(
    "qb_shuffle_fast", frames=8, speed=3.6, duty=3.19 / 8, width=0.26, pelvis_up=-0.06, bob=0.012, sway=0.0, drop=2, turn=0, counter=0, lean=QB_TRUNK + 2,
    arm_c=0, arm_a=0, elbow=90, elbow_d=0, hand="grip",
    hip_max=28, hip_ext=-10, knee_max=56, retract=0, fk=0.0, lift=0.06,
    strike=12, flat_by=0.1, heel_mid=10, rise_at=0.5, toe_off=22, dorsi=0, gaze=3, dir=(1.0, 0.0), ahead=0.5,
)

# The climb (forward). Short, choppy steps up into the pocket: the walk's heel-first
# contact at the slow end (a step up), the jog's midfoot at the fast end, at a quicker
# cadence than either and with half their arm-free trunk turn (the ball's in both hands).
QB_CLIMB_SLOW = Gait(
    "qb_climb_slow", frames=16, speed=1.3, duty=9.49 / 16, width=0.14, pelvis_up=-0.045, bob=0.01, sway=0.012, drop=3, turn=3, counter=3, lean=QB_TRUNK,
    arm_c=0, arm_a=0, elbow=90, elbow_d=0, hand="grip",
    hip_max=26, hip_ext=-10, knee_max=58, retract=3, lift=0.07, fk=0.8,
    strike=-10, flat_by=0.14, heel_mid=4, rise_at=0.55, toe_off=36, dorsi=8, gaze=3, ahead=0.4,
)
QB_CLIMB = Gait(
    "qb_climb", frames=12, speed=2.8, duty=5.49 / 12, width=0.13, pelvis_up=-0.055, bob=0.016, sway=0.01, drop=4, turn=4, counter=4, lean=QB_TRUNK + 1,
    arm_c=0, arm_a=0, elbow=90, elbow_d=0, hand="grip",
    hip_max=36, hip_ext=-12, knee_max=78, retract=4, lift=0.10, fk=0.9,
    strike=-4, flat_by=0.12, heel_mid=6, rise_at=0.5, toe_off=42, dorsi=8, gaze=3, ahead=0.38,
)
QB_CLIMB_FAST = Gait(
    "qb_climb_fast", frames=12, speed=4.4, duty=4.49 / 12, width=0.12, pelvis_up=-0.065, bob=0.022, sway=0.01, drop=5, turn=5, counter=5, lean=QB_TRUNK + 2,
    arm_c=0, arm_a=0, elbow=90, elbow_d=0, hand="grip",
    hip_max=44, hip_ext=-14, knee_max=92, retract=5, lift=0.14, fk=1.0,
    strike=0, flat_by=0.12, heel_mid=6, rise_at=0.48, toe_off=46, dorsi=10, gaze=3, ahead=0.36,
)

# The drift (straight back, square): the backpedal's mechanics (gait.py, a step on the ball
# of the foot reaching back) in the passer's set: upright (the pedal's 28 deg lean is a
# corner's, chest over his toes), the hips at the set's height, the ball high. The slow one
# at a walk's pace, the other the defensive back's 3.2 m/s; both two contacts a cycle at
# half the cycle each (the pedal's: the game reads the pair's contacts as one).
QB_PEDAL_SLOW = Gait(
    "qb_pedal_slow", frames=14, speed=1.5, duty=6.99 / 14, width=0.15, pelvis_up=-0.05, bob=0.008, sway=0.008, drop=2, turn=2, counter=2, lean=QB_TRUNK - 2,
    arm_c=0, arm_a=0, elbow=90, elbow_d=0, hand="grip",
    hip_max=30, hip_ext=-8, knee_max=56, retract=0, fk=0.0, lift=0.05,
    strike=16, flat_by=0.1, heel_mid=14, rise_at=0.5, toe_off=22, dorsi=0, gaze=3, dir=(0.0, 1.0), ahead=0.5,
)
QB_PEDAL = Gait(
    "qb_pedal", frames=14, speed=3.2, duty=6.99 / 14, width=0.15, pelvis_up=-0.065, bob=0.012, sway=0.01, drop=3, turn=3, counter=3, lean=QB_TRUNK,
    arm_c=0, arm_a=0, elbow=90, elbow_d=0, hand="grip",
    hip_max=36, hip_ext=-10, knee_max=66, retract=0, fk=0.0, lift=0.065,
    strike=20, flat_by=0.1, heel_mid=18, rise_at=0.5, toe_off=26, dorsi=0, gaze=3, dir=(0.0, 1.0), ahead=0.5,
)

_QSET = STANCES["qb_set"]


def with_ball(p):
    """The ball at the chest in both hands, as the set has it (qb_set's hands, grip and
    elbow poles), riding up and down with the hips; the eyes level downfield."""
    rise = p.pelvis.get("up", 0.0) - HOLD_HIPS
    p.hands = {s: (h[0], h[1], round(h[2] + rise, 4)) for s, h in HOLD.items()}
    p.elbow = {s: (e[0], e[1], round(e[2] + rise, 4)) for s, e in HOLD_ELBOW.items()}
    p.arms = {}
    p.joints.update({**GRIP, "hand_l": (-10, 0, -20), "hand_r": (-25, 0, 15)})
    # The chest a little up off the keyer's spine (qb_set: spine_02 4, spine_03 3 over the pelvis's 12).
    for b, (fl, ab, tw) in list(p.joints.items()):
        if b in ("spine_02", "spine_03"):
            p.joints[b] = (fl + 1.0, ab, tw)
    p.gaze = (3.0, 0.0)
    return p


def qb_loop(name: str, g: Gait, mirror: bool = False) -> Clip:
    """A pocket loop: the keyer's legs and trunk, the set's hold. `mirror`: the legs
    mirrored (the slide to the right, its right foot planting at phase 0 as the round-16
    side loops' right twins do), the ball still in the right hand behind it."""

    def pose(t):
        fr = (t * FPS) % g.frames
        p = gait_pose(g, fr)
        if mirror:
            p = mirror_pose(p)
        return with_ball(p)

    c = gait_contacts(g)
    return Clip(name, "locomotion", g.frames / FPS, pose, loop=True, contacts={"l": c["r"], "r": c["l"]} if mirror else c, speed=g.speed, loco_dir=(-g.dir[0], g.dir[1]) if mirror else g.dir)


def q17_clips() -> list[Clip]:
    return [
        qb_loop("qb_shuffle_l", QB_SHUFFLE), qb_loop("qb_shuffle_r", QB_SHUFFLE, mirror=True),
        qb_loop("qb_shuffle_fast_l", QB_SHUFFLE_FAST), qb_loop("qb_shuffle_fast_r", QB_SHUFFLE_FAST, mirror=True),
        qb_loop("qb_climb_slow", QB_CLIMB_SLOW), qb_loop("qb_climb", QB_CLIMB), qb_loop("qb_climb_fast", QB_CLIMB_FAST),
        qb_loop("qb_pedal_slow", QB_PEDAL_SLOW), qb_loop("qb_pedal", QB_PEDAL),
    ]


__all__ = ["q17_clips", "QB_SHUFFLE", "QB_SHUFFLE_FAST", "QB_CLIMB_SLOW", "QB_CLIMB", "QB_CLIMB_FAST", "QB_PEDAL_SLOW", "QB_PEDAL"]

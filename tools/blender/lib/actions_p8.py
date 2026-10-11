"""Passing round 8 (docs/passing/PASSING8.md): the catch out in front, the
low ball over the shoulder, the box-out, and the throw around a rusher.

Keyed here like every clip (CLAUDE.md rule 6): no downloaded, captured or
third-party motion. Each catch carries "secure" (the ball in the hands: the
runtime paces the clip so that frame lands on the sim's catch) and "tuck"
events, as the round-5 and round-6 sets do; each throw a "release".

What round 7's critique found, and why these exist:
- A ball led a stride is taken up to 1.15 m in front of him (the sim's
  reach, 0.85 yd round his hands point), and the run-speed catches put his
  finger roots at most ~0.67 m ahead of his centre (measure_reach.py: the
  arms are already straight in catch_hands_run, the shoulders only ~0.05 m
  ahead of the hips). The ball travelled its last ~0.5 m on the next frame.
  catch_reach_out is the receiver extending into the ball: the trunk folds
  forward over the run from the lower spine, the shoulders go after the
  hands and the arms reach to full length, then he pulls it in.
- A deep ball arriving at his belt was drawn hands-high over the shoulder.
  catch_over_shoulder_low_l/_r: the low basket on the run (pinkies
  together, the hands at the hip, the eyes back over the shoulder), scooped
  up into the chest.
- Round 7's throwing lane moves the release up to 0.4 yd off a lineman's
  hands, and the throw didn't change: qb_throw*_side (a lower, side-arm
  slot, the trunk tipped toward the throwing side) and qb_throw*_over (over
  the top, the throwing shoulder up), blended by the release's move.
- The box-out (round 5's open item): catch_box_l/_r, the big receiver's
  contested catch: the near shoulder and hip leaning into the man, the near
  forearm barred across him (the hand fight), then both hands up late to
  high-point it over him.

Technique, from receiver and quarterback coaching and the broadcast:
- Out in front: "extend and pluck": the eyes on the tip of the ball, the
  arms go to full length late, the chest goes after them (a receiver
  running onto a ball led a stride reaches with his whole upper body), the
  fingers take it, the elbows bend to absorb it as it comes in.
- Low over the shoulder: run through it, look it in over the inside
  shoulder, pinkies together and palms up at the hip, let it drop into the
  basket and bring it up into the chest.
- The arm slot: a QB throwing around a rusher drops his elbow and slings
  it three-quarters to side-arm (the shoulders tip toward the throwing
  side); to get it over one he stays tall, the elbow high and the glove-side
  shoulder down, the hand over the top of the helmet.
- The box-out: "post up": get the body between the man and the ball, the
  near hip and shoulder into him, the near arm a bar on his chest (the hands
  fight; it never extends into a push-off), then go up and take it at its
  highest point with both hands, late, and chin it.
"""

from __future__ import annotations

from .actions import GRIP, SPREAD, SPINE_UP, Clip, keyed
from .actions_m65 import DIAMOND_WRIST, PINKIES_WRIST, sided
from .actions_p5 import ARMS, FWD, MASK, carriage, events, run_upper, sternum, tuck
from .gait import FPS
from .poses import Pose

# The forward reach folds from the lower spine too (spine_01: the run's own is a twentieth of its lean).
REACH_MASK = ARMS + ["spine_01"] + SPINE_UP + ["neck_01", "neck_02"]


def _flex(p: Pose, fl: tuple[float, float, float, float]) -> Pose:
    """Add forward flexion (deg) to spine_01..04 (on top of the run's trunk), the neck extending back by most of it so
    the face stays up on the ball (the runtime's look-at then aims it)."""
    for b, d in zip(["spine_01", *SPINE_UP], fl):
        f0 = p.joints.get(b, (0, 0, 0))
        p.joints[b] = (f0[0] + d, *f0[1:])
    up = -0.7 * sum(fl)
    for b, k in (("neck_01", 0.5), ("neck_02", 0.5)):
        f0 = p.joints.get(b, (0, 0, 0))
        p.joints[b] = (f0[0] + up * k, *f0[1:])
    return p


def reach_out() -> Clip:
    """The ball led a stride ahead of him (overlay over the run): the hands
    come up late out of the carriage, then the whole upper body extends
    into it, the trunk folding ~50 degrees further forward from the lower
    spine so the shoulders go after the hands, the arms long, the diamond
    at chest height at the end of them (the finger roots ~0.95 m ahead of
    his centre: measure_reach.py). The fingers take it (secure), the elbows
    bend to absorb it as it comes in, the trunk comes back up as the ball
    comes to the sternum, then high and tight."""
    T = 0.9
    ts, tt = 10 / FPS, 21 / FPS
    z = 1.30
    up = _flex(run_upper({"l": (0.11, -0.46, z), "r": (-0.11, -0.46, z)}, {**SPREAD, **DIAMOND_WRIST}, {"l": (0.55, 0.0, z - 0.42), "r": (-0.55, 0.0, z - 0.42)}, (-1, -1, 0)), (3, 4, 4, 2))
    reach = _flex(run_upper({"l": (0.07, -1.00, z), "r": (-0.07, -1.00, z)}, {**SPREAD, **DIAMOND_WRIST}, {"l": (0.6, -0.4, z - 0.25), "r": (-0.6, -0.4, z - 0.25)}, (0, 0, 0)), (15, 16, 13, 6))
    give = _flex(run_upper({"l": (0.06, -0.62, z + 0.02), "r": (-0.06, -0.62, z + 0.02)}, {**GRIP, **DIAMOND_WRIST}, {"l": (0.6, -0.1, z - 0.40), "r": (-0.6, -0.1, z - 0.40)}, (0, 0, 0)), (6, 7, 6, 3))
    keys = [(0.0, carriage()), (ts - 0.2, up), (ts - 0.07, reach), (ts, reach), (ts + 0.07, give), (ts + 0.2, sternum()), (tt, tuck()), (T, tuck())]
    return Clip("catch_reach_out", "overlay", T, lambda t: keyed(keys, t), mask=REACH_MASK, events=events(ts, tt))


def over_shoulder_low(side: str) -> Clip:
    """The deep ball dropping in at his belt over his inside shoulder
    (authored on the left; overlay over the run). The eyes and the upper back
    turn back toward the ball as catch_over_shoulder_l's do, but the trunk
    folds forward over it and the hands go down, not up: the low basket at the
    hip, pinkies together and palms up, out a little ahead and toward the
    ball's side, soft arms. The ball drops in (secure), the hands give down
    and back with it, scoop it up into the sternum as the trunk comes up and
    turns square, then high and tight."""
    T = 0.85
    ts, tt = 9 / FPS, 19 / FPS
    m = sided(side)
    # Turned back toward the ball over the left shoulder (flex, lean, twist added per bone), folding forward over the low ball.
    turn = {"spine_02": (5, 3, 7), "spine_03": (7, 4, 10), "spine_04": (4, 2, 10)}

    def turned(p: Pose, k: float) -> Pose:
        for b, (fl, ab, tw) in turn.items():
            f0 = p.joints.get(b, (0, 0, 0))
            p.joints[b] = (f0[0] + fl * k, f0[1] + ab * k, f0[2] + tw * k)
        return p

    basket = {"hand_l": (-25, 0, 75), "hand_r": (-25, 0, -75)}
    # Late hands: down from the carriage, the palms turning up beside the hip.
    up = turned(run_upper({"l": (0.20, -0.36, 1.02), "r": (0.0, -0.40, 1.00)}, {**SPREAD, **PINKIES_WRIST}, {"l": (0.42, 0.10, 1.12), "r": (-0.36, 0.10, 1.10)}, (2, 2, 1)), 0.7)
    # The low basket: soft arms, the hands together at the hip out in front, toward the ball's side.
    reach = turned(run_upper({"l": (0.17, -0.50, 0.86), "r": (0.02, -0.52, 0.84)}, {**SPREAD, **basket}, {"l": (0.45, 0.05, 1.08), "r": (-0.36, 0.05, 1.06)}, (4, 3, 2)), 1.0)
    # The give: down and back with it, the fingers closing under it.
    give = turned(run_upper({"l": (0.14, -0.44, 0.82), "r": (0.00, -0.46, 0.80)}, {**GRIP, **basket}, {"l": (0.42, 0.10, 1.05), "r": (-0.34, 0.10, 1.03)}, (5, 4, 2)), 0.9)
    # Scooped up toward the chest, the trunk coming up and square.
    lift = turned(run_upper({"l": (0.10, -0.40, 1.08), "r": (-0.02, -0.42, 1.06)}, {**GRIP, **PINKIES_WRIST}, {"l": (0.45, 0.15, 0.95), "r": (-0.40, 0.15, 0.93)}, (2, 2, 1)), 0.5)
    keys = [(0.0, carriage()), (ts - 0.17, m(up)), (ts - 0.05, m(reach)), (ts, m(reach)), (ts + 0.06, m(give)), (ts + 0.13, m(lift)), (ts + 0.22, sternum()), (tt, tuck()), (T, tuck())]
    return Clip(f"catch_over_shoulder_low_{side}", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


def box_out(side: str) -> Clip:
    """The box-out on a contested ball, the defender on his left (authored on
    the left; overlay over the run, so the legs keep driving). Posted up
    through the ball's last half second: the trunk leans and turns into the
    man (the left hip and shoulder into him), the left forearm a bar across
    his chest at the numbers, the right hand up ready; then late, both hands go
    up together over the bar arm's side to take it at its highest point above
    the face mask (secure), the chest staying on the man; snatched and
    chinned at once, both forearms over it, the shoulder still into him; the
    tuck late, as the contested catch's."""
    T = 1.05
    ts, tt = 14 / FPS, 26 / FPS
    m = sided(side)
    # Into the man on the left: the trunk leans and turns toward him (flex, lean, twist added per bone).
    post = {"spine_02": (2, 6, 6), "spine_03": (2, 8, 8), "spine_04": (1, 6, 6)}

    def posted(p: Pose, k: float) -> Pose:
        for b, (fl, ab, tw) in post.items():
            f0 = p.joints.get(b, (0, 0, 0))
            p.joints[b] = (f0[0] + fl * k, f0[1] + ab * k, f0[2] + tw * k)
        return p

    # The bar: the left forearm across his chest out to the left, at the numbers; the right hand up at the chest, ready.
    bar = posted(run_upper({"l": (0.42, -0.26, 1.28), "r": (-0.10, -0.40, 1.42)}, {**GRIP, **SPREAD, "hand_l": (-10, 0, 40), "hand_r": (-30, 0, 0)}, {"l": (0.40, -0.05, 1.18), "r": (-0.45, 0.05, 1.05)}, (0, 0, 0)), 1.0)
    # Late hands: both up together over the face mask on the bar's side, the chest still on him.
    reach = posted(run_upper({"l": (0.10, -0.40, 1.98), "r": (-0.02, -0.42, 1.96)}, {**SPREAD, "hand_l": (-55, 0, 0), "hand_r": (-55, 0, 0)}, {"l": (0.55, -0.05, 1.50), "r": (-0.50, -0.05, 1.48)}, (-6, -5, -4)), 0.8)
    snatch = posted(run_upper({"l": (0.08, -0.36, 1.86), "r": (-0.02, -0.38, 1.84)}, {**GRIP, "hand_l": (-45, 0, 0), "hand_r": (-45, 0, 0)}, {"l": (0.45, 0.0, 1.40), "r": (-0.42, 0.0, 1.38)}, (-3, -3, -2)), 0.8)
    # Chinned: the ball under the face mask, both forearms over it, the left shoulder still into him.
    chin = posted(run_upper({"l": (0.07, -0.24 - FWD, 1.42), "r": (-0.06, -0.23 - FWD, 1.44)}, {**GRIP, "hand_l": (25, 0, -30), "hand_r": (-5, 0, 30)}, {"l": (0.30, 0.15, 1.05), "r": (-0.30, 0.15, 1.05)}, (6, 5, 4)), 1.0)
    keys = [(0.0, carriage()), (ts - 0.42, m(bar)), (ts - 0.17, m(bar)), (ts - 0.05, m(reach)), (ts, m(reach)), (ts + 0.04, m(snatch)), (ts + 0.13, m(chin)), (tt - 0.08, m(chin)), (tt + 0.04, tuck()), (T, tuck())]
    return Clip(f"catch_box_{side}", "overlay", T, lambda t: keyed(keys, t), mask=MASK, events=events(ts, tt))


# --- The arm slot: around or over a rusher (overlays on the throw) -----------------------------------

# Each throw as actions_pass.py keys it (the M4 throw, actions.py qb_throw, in the same terms): T, the stride,
# the load, cock, release and follow-through times, the throwing hand's targets, the pelvis, the lean, the feet.
THROWS = {
    "qb_throw": dict(T=0.8, S=0.36, keys_t=(0.13, 0.30, 0.367, 0.55), load_r=(-0.19, 0.04, 1.58), cock_r=(-0.33, 0.16, 1.60), rel_r=(-0.11, -0.44, 1.78), fol_r=(0.17, -0.36, 1.00), twist=(-30, -32, 8, 24), flex=(0, 10, 16, 26), feet=[("l", 0.13, 0.31), ("r", 0.50, 0.68)]),
    "qb_throw_quick": dict(T=0.70, S=0.22, keys_t=(0.07, 0.20, 8 / FPS, 0.42), load_r=(-0.17, 0.02, 1.66), cock_r=(-0.28, 0.12, 1.66), rel_r=(-0.11, -0.44, 1.80), fol_r=(0.10, -0.40, 1.08), twist=(-24, -28, 8, 20), flex=(0, 8, 14, 22), feet=[("l", 0.05, 0.19), ("r", 0.40, 0.56)]),
    "qb_throw_long": dict(T=1.00, S=0.44, keys_t=(0.20, 0.40, 14 / FPS, 0.66), load_r=(-0.30, 0.22, 1.24), cock_r=(-0.36, 0.20, 1.58), rel_r=(-0.11, -0.46, 1.76), fol_r=(0.19, -0.36, 0.98), twist=(-36, -36, 8, 28), flex=(2, 10, 18, 28), feet=[("l", 0.16, 0.40), ("r", 0.62, 0.82)]),
    "qb_throw_fade": dict(T=0.78, S=-0.24, keys_t=(0.08, 0.22, 9 / FPS, 0.46), load_r=(-0.18, 0.04, 1.62), cock_r=(-0.30, 0.18, 1.64), rel_r=(-0.13, -0.34, 1.82), fol_r=(-0.02, -0.34, 1.30), twist=(-26, -28, -6, 4), flex=(-2, 0, 2, 4), lean=-6.0, feet=[("r", 0.04, 0.22), ("l", 0.30, 0.50)]),
}
# The slots (the throwing hand's targets moved, m: x is his left, y ahead is −, z up; the elbow at the cock and the
# release; the spine's side bend, deg). From quarterback coaching: around a rusher the elbow drops and the ball comes
# out three-quarters to side-arm at the shoulder, the shoulders tipping toward the throwing side (the hand ~0.3 m
# lower and ~0.3 m wider at the release); over one he stays tall, the elbow above the shoulder and the glove-side
# shoulder down, the hand over the top of the helmet (~0.15 m higher, ~0.1 m inside).
SLOTS = {
    "side": dict(cock=(-0.10, 0.04, -0.20), rel=(-0.30, 0.08, -0.36), fol=(-0.04, -0.04, 0.08), elbows=((-0.95, 0.06, 1.28), (-0.88, -0.05, 1.12)), bend=9.0),
    "over": dict(cock=(0.06, 0.0, 0.08), rel=(0.10, -0.02, 0.15), fol=(0.02, 0.0, 0.0), elbows=((-0.62, 0.02, 1.78), (-0.48, -0.22, 1.66)), bend=-9.0),
}
# The upper body the slot drives over the throw (the legs, the stride and the hips are the throw's own).
SLOT_MASK = ARMS + SPINE_UP


def throw_slot(base: str, slot: str) -> Clip:
    """The throw `base` with its arm in another slot, as an overlay on the same
    timing (the runtime plays it over the throw at the time the throw is at,
    weighted by how far the sim moved his release off a lineman: choreo.ts
    throwSlot)."""
    from .actions_pass import _throw

    b, d = THROWS[base], SLOTS[slot]
    add = lambda v, dv: tuple(round(x + y, 3) for x, y in zip(v, dv))  # noqa: E731
    c = _throw(
        f"{base}_{slot}", b["T"], b["S"], b["keys_t"], b["load_r"], add(b["cock_r"], d["cock"]), add(b["rel_r"], d["rel"]), add(b["fol_r"], d["fol"]),
        twist=b["twist"], flex=b["flex"], lean=b.get("lean", 0.0), feet=b["feet"], elbows=d["elbows"], bend=d["bend"],
    )
    # In place, the feet held where the throw starts: an overlay drives only the upper body (the throw's own legs step).
    feet0 = c.pose(0).feet

    def pose(t):
        p = c.pose(round(t * FPS))
        p.feet = dict(feet0)
        return p

    return Clip(c.name, "overlay", c.frames / FPS, pose, mask=SLOT_MASK, events=c.events)


def p8_clips() -> list[Clip]:
    return [reach_out(), over_shoulder_low("l"), over_shoulder_low("r"), box_out("l"), box_out("r"), *[throw_slot(b, sl) for b in THROWS for sl in SLOTS]]

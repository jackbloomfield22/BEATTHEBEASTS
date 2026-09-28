"""M6.5 #12, contested catches: the defender at the catch point plays
through the receiver instead of running through him. Keyed here like every
clip (CLAUDE.md rule 6): no downloaded, captured or third-party motion.
Built on actions_m65.py's overlay helpers.

- def_contest_l/_r (the receiver on the defender's left / right): an
  overlay over the defender's run (arms and upper spine), so his legs keep
  the sim's pursuit. Technique from defensive-back coaching ("play through
  the hands", "rake", "hand fight at the catch point") and what a broadcast
  shows at a contested catch: the near hand goes to the receiver's near
  hip and back (the hand fight, feeling him), the trunk turns and leans in
  so the near shoulder meets his, and the far arm comes across the front
  of the receiver's body to the catch point (the arm across). At the
  "contact" event the far hand is at the ball; it then rakes down through
  the receiver's hands and the arms come back into the run.

The render (src/render/game/choreo.ts) starts it so "contact" lands on the
ball's arrival when a defender is within 1.2 yd of the target, and leans the
two bodies into each other (src/render/game/contact.ts).
"""

from __future__ import annotations

from .actions import GRIP, RELAXED, SPINE_UP, SPREAD, Clip, arm_mask, hands_of, keyed, mirrored
from .actions_m65 import ready_pose, upper
from .gait import FPS

ARMS = arm_mask("l") + arm_mask("r")

# Where the receiver is, in the defender's frame at the catch (x left, -y
# forward, z up; the defender stands at the origin facing -Y): beside and a
# little ahead, pads to pads (sim distance ~0.7-1.1 yd). His near hip is
# ~0.4 m to the left. The far (right) hand goes across the front of the
# receiver's body toward his hands: across the defender's own midline and
# out in front at chest height, as far as a right arm reaches that way
# (0.6 m from the right shoulder; the trunk's turn brings it forward).
NEAR_HIP = (0.40, -0.18, 1.02)
CATCH_POINT = (0.12, -0.44, 1.30)


def contest_left() -> Clip:
    """The receiver on his left: left hand fights at the hip, right arm
    across to the catch point, the rake, back into the run (overlay)."""
    T = 0.8
    tc = 9 / FPS  # contact: the far hand at the ball
    # Turned and leaning in toward him: the left shoulder into his.
    lean = {"spine_02": (4, 2, 6), "spine_03": (6, 2, 8), "spine_04": (4, 1, 6)}
    reach = upper(
        {"l": (0.36, -0.22, 1.06), "r": (0.02, -0.40, 1.36)},
        {**hands_of(SPREAD, "l"), **hands_of(SPREAD, "r"), "hand_l": (10, 0, 20), "hand_r": (-10, 0, 10)},
        {"l": (0.75, 0.25, 0.95), "r": (-0.35, -0.10, 0.95)},
    )
    reach.joints.update(lean)
    contact = upper(
        {"l": NEAR_HIP, "r": CATCH_POINT},
        {**hands_of(GRIP, "l"), **hands_of(SPREAD, "r"), "hand_l": (15, 0, 25), "hand_r": (10, 0, 10)},
        {"l": (0.80, 0.25, 0.95), "r": (-0.25, -0.15, 0.90)},
    )
    contact.joints.update({k: (f * 1.3, a * 1.3, t * 1.3) for k, (f, a, t) in lean.items()})
    # The rake: the far hand swipes down through his hands, the near arm pushes off.
    rake = upper(
        {"l": (0.42, -0.10, 1.08), "r": (0.16, -0.42, 1.04)},
        {**hands_of(RELAXED, "l"), **hands_of(GRIP, "r"), "hand_l": (0, 0, 10), "hand_r": (35, 0, 10)},
        {"l": (0.80, 0.30, 0.95), "r": (-0.25, -0.05, 0.80)},
    )
    rake.joints.update(lean)
    keys = [(0.0, ready_pose()), (tc - 0.12, reach), (tc, contact), (tc + 0.12, rake), (T, ready_pose())]
    return Clip("def_contest_l", "overlay", T, lambda t: keyed(keys, t), mask=ARMS + SPINE_UP, events={"contact": round(tc * FPS)})


def contact_clips() -> list[Clip]:
    left = contest_left()
    return [left, mirrored(left, "def_contest_r")]

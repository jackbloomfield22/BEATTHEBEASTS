"""Animation round 16 (docs/anim/FEET16.md): the loops for moving sideways
and for the line's pass set. Keyed here with our own gait keyer (gait.py,
CLAUDE.md rule 6); no captured or third-party motion. The kick-slide loop
is the pass set's technique (TECH_PLAN T8: never cut).

The game plays these on their own phase, paced by the sim's velocity
(src/anim/animator.ts, the side layer): a player moving at an angle to the
way he faces shuffles instead of running a forward gait turned sideways.

Timings and shapes, from coaching descriptions:
- Quick shuffle (a linebacker's scrape, a corner mirroring a release):
  the shuffle's step-close at speed, a short hop off the trail foot (a
  little flight), the base never narrower than the hips, ~3.4 m/s.
- Pass-pro slide (punch and mirror): the lead foot steps, the trail foot
  slides the same distance; wide base, knees bent and the butt down, chest
  up, hands up and in, short choppy steps low to the turf, ~1.8 m/s.
- Kick-slide (the vertical set): the outside foot kicks back and out, the
  inside foot slides back the same distance and stays in front of it
  (never crossing, never clicking the heels), the outside hip opened to the
  rusher. A quick set ~1.6 m/s (a kick of ~0.35 m every 0.2 s); a deep set
  against speed ~3.4 m/s (a bigger kick, a short flight off the slide foot).
"""

from __future__ import annotations

import math

from .actions import Clip, mirrored
from .actions_m6 import READY, STRIKE_WRISTS
from .gait import FPS, Gait, contacts as gait_contacts, gait_pose
from .poses import Arm

# The quick shuffle (to the left): the linebacker's shuffle (actions_m6_back7.py
# SHUFFLE, 2.0 m/s) at speed. The feet's closest approach is ~2·width less the
# ground each covers planted (0.62 - 0.45 m: the clearance gate's 7 cm with room; the knees come closer than the ankles).
# Each duty is a whole number of frames less a hair (the contacts are counted in
# frames, gait.contacts: a duty between frames plants the foot a frame longer than
# the keyer keeps it down).
SHUFFLE_FAST = Gait(
    "shuffle_fast", frames=10, speed=3.4, duty=3.99 / 10, width=0.31, pelvis_up=-0.22, bob=0.018, sway=0.0, drop=2, turn=0, counter=0, lean=26,
    arm_c=40, arm_a=8, elbow=92, elbow_d=6, arm_abd=16, inward=0.35, hand="spread",
    hip_max=30, hip_ext=-10, knee_max=62, retract=0, fk=0.0, lift=0.075,
    strike=16, flat_by=0.1, heel_mid=16, rise_at=0.5, toe_off=26, dorsi=0, gaze=4, dir=(1.0, 0.0), ahead=0.5,
)

# The line's trunk: ol_pass's 22 deg of pelvis (actions_m6_line.py STANCES["ol_pass"]), the keyer's lean * 0.65.
LINE_LEAN = 22.0 / 0.65

# The lineman's slide (to the left): ol_pass's base and hands (actions_m6_line.py),
# short steps close to the turf.
OL_SLIDE = Gait(
    "ol_slide", frames=12, speed=1.8, duty=6.99 / 12, width=0.30, pelvis_up=-0.20, bob=0.008, sway=0.0, drop=1, turn=0, counter=0, lean=LINE_LEAN,
    arm_c=READY.flex, arm_a=3, elbow=READY.elbow, elbow_d=3, arm_abd=READY.abd, inward=READY.inward, clavicle=0, hand="spread",
    hip_max=26, hip_ext=-8, knee_max=50, retract=0, fk=0.0, lift=0.045,
    strike=12, flat_by=0.1, heel_mid=10, rise_at=0.5, toe_off=20, dorsi=0, gaze=4, dir=(1.0, 0.0), ahead=0.5,
)

# The kick-slide (the left tackle's: back and out to his left). The kick-slide
# one-shot's travel (actions_m6_line.py kick_slide: 1.05 m back, 0.55 m out) is
# 28 deg outside straight back.
KICK_OUT = math.radians(28.0)
KICK_DIR = (math.sin(KICK_OUT), math.cos(KICK_OUT))  # Blender: +x left, +y back
OL_SET = Gait(
    "ol_set", frames=12, speed=1.6, duty=6.99 / 12, width=0.27, pelvis_up=-0.19, bob=0.01, sway=0.0, drop=1, turn=0, counter=0, lean=LINE_LEAN,
    arm_c=READY.flex, arm_a=3, elbow=READY.elbow, elbow_d=3, arm_abd=READY.abd, inward=READY.inward, clavicle=0, hand="spread",
    hip_max=26, hip_ext=-8, knee_max=52, retract=0, fk=0.0, lift=0.045,
    strike=12, flat_by=0.1, heel_mid=10, rise_at=0.5, toe_off=20, dorsi=0, gaze=4, dir=KICK_DIR, ahead=0.5,
)
OL_SET_FAST = Gait(
    "ol_set_fast", frames=9, speed=3.2, duty=3.99 / 9, width=0.29, pelvis_up=-0.18, bob=0.016, sway=0.0, drop=1, turn=0, counter=0, lean=LINE_LEAN,
    arm_c=READY.flex, arm_a=5, elbow=READY.elbow, elbow_d=4, arm_abd=READY.abd, inward=READY.inward, clavicle=0, hand="spread",
    hip_max=28, hip_ext=-10, knee_max=58, retract=0, fk=0.0, lift=0.06,
    strike=12, flat_by=0.1, heel_mid=10, rise_at=0.5, toe_off=22, dorsi=0, gaze=4, dir=KICK_DIR, ahead=0.5,
)
# The set's stagger: the kick (outside) foot rides this far (m) behind the slide
# foot, so the slide foot closes to it and never passes (ol_pass and the kick-slide
# one-shot's top of the set have the feet even; a vertical set's is toe-to-instep).
STAGGER = {"ol_set": 0.36, "ol_set_fast": 0.44}


def lineman(p, g: Gait, kick: str | None):
    """The lineman's upper body over the keyer's legs: ol_pass's trunk, hands up and
    in with the wrists cocked (READY, STRIKE_WRISTS), the eyes on the rusher; for the
    set, the outside hip opened and the kick foot staggered back."""
    p.arms = {"l": READY, "r": READY}
    # ol_pass's chest (spine_02 4, spine_03 2 over the pelvis's 22 deg: the keyer puts lean * 0.65 in the pelvis, LINE_LEAN).
    p.joints.update({"spine_02": (4.0, 0.0, 0.0), "spine_03": (2.0, 0.0, 0.0), **STRIKE_WRISTS})
    if kick:
        d = 1.0 if kick == "l" else -1.0
        S = STAGGER[g.name]
        # (g.dir is the set's travel: back and out to the kick side.)
        for s in "lr":
            ft = p.feet[s]
            # Along the set's travel: the kick foot back half the stagger, the slide foot up half.
            k = 0.5 * S if s == kick else -0.5 * S
            ft.x += k * g.dir[0]
            ft.y += k * g.dir[1]
            # The kick foot's toes turned out a little (open to the rusher).
            if s == kick:
                ft.out += 6.0
        # The outside hip open to the rusher (the one-shot's 12 deg at the top of its arc), the chest back toward square.
        p.pelvis["twist"] = p.pelvis.get("twist", 0.0) + 12.0 * d
        f3 = p.joints.get("spine_03", (0.0, 0.0, 0.0))
        p.joints["spine_03"] = (f3[0], f3[1], f3[2] - 5.0 * d)
        p.gaze = (4.0, 14.0 * d, 0.6)
    return p


def loop(name: str, g: Gait, kick: str | None = None, ol: bool = False) -> Clip:
    def pose(t):
        fr = (t * FPS) % g.frames
        p = gait_pose(g, fr)
        return lineman(p, g, kick) if ol else p

    return Clip(name, "locomotion", g.frames / FPS, pose, loop=True, contacts=gait_contacts(g), speed=g.speed, loco_dir=g.dir)


def a16_clips() -> list[Clip]:
    sf = loop("lb_shuffle_fast_l", SHUFFLE_FAST)
    sl = loop("ol_slide_l", OL_SLIDE, ol=True)
    st = loop("ol_set_l", OL_SET, kick="l", ol=True)
    stf = loop("ol_set_fast_l", OL_SET_FAST, kick="l", ol=True)
    return [
        sf, mirrored(sf, "lb_shuffle_fast_r"),
        sl, mirrored(sl, "ol_slide_r"),
        st, mirrored(st, "ol_set_r"),
        stf, mirrored(stf, "ol_set_fast_r"),
    ]


__all__ = ["a16_clips", "SHUFFLE_FAST", "OL_SLIDE", "OL_SET", "OL_SET_FAST"]

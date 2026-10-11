// The threat in the throwing lane (passing round 11), for the drawn arm slot (choreo.ts throwSlot). Pure: the sim
// state in, 0..1 out (tools/sim/p11_slot.ts counts it over the AI book).

import type { PlayState } from '@/sim';
import type { Agent } from '@/sim/types';
import { pressureFrom } from '@/sim/ai';
import { LANE_MAX } from '@/sim/passing';

/**
 * Round eight drew the side-arm or over-the-top slot by how far the QB moved
 * his release off a lineman in the line of the throw (sim/passing.ts
 * throwingLane), and every lineman at the line is in the line of a throw over
 * the middle: the slot showed on 56% of the AI's throws, most of them from a
 * clean pocket, a man locked up with a blocker four yards away (round 11's
 * owner note: it should read as reacting to the rush). The release still
 * moves for any of them (the slide, and the ball's line off the man's hands:
 * the batted-ball odds are the sim's and unchanged), but the arm drops or
 * goes over the top only when the man in the lane is pressure: the sim's own
 * pressure from him (ai.ts pressureFrom: a free rusher within ~4.5 yd, or one
 * driven back into the QB's lap through his blocker), full at THREAT_FULL.
 * A clean pocket throws from his normal slot.
 */
export function slotThreat(s: PlayState, qb: Agent, to: { x: number; y: number }): number {
  const dx = to.x - qb.pos.x;
  const dy = to.y - qb.pos.y;
  const L = Math.hypot(dx, dy);
  if (L < 3) return 0;
  const ux = dx / L;
  const uy = dy / L;
  let t = 0;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (d.down || (d.p.pos !== 'DE' && d.p.pos !== 'DT')) continue;
    const px = d.pos.x - qb.pos.x;
    const py = d.pos.y - qb.pos.y;
    const u = (px * ux + py * uy) / L;
    const a = Math.abs(-px * uy + py * ux);
    if (u <= 0 || u >= LANE_U || a > LANE_A) continue;
    t = Math.max(t, Math.min(1, pressureFrom(s, qb, i) / THREAT_FULL));
  }
  return t;
}
/** A lineman in the lane: in the front half of the throw (sim/passing.ts LANE_U), within the reach of his hands (BAT_LANE, 0.85 yd) and the most the QB moves his release (LANE_MAX) of its line. */
const LANE_U = 0.5;
const LANE_A = 0.85 + LANE_MAX;
/** The pressure from the man in the lane at which the slot is drawn whole (pressureFrom: a blocked man driven to within ~1.9 yd of him, a free one within ~2.75). Ours. */
const THREAT_FULL = 0.5;

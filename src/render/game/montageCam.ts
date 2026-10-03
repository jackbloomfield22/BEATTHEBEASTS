// The Beasts' drive montage's cameras (M7, src/game/montageSession.ts):
// one pose per shot, in the field frame (x downfield from the Beasts' goal
// line, y to their left, yd; heights in m), which GameCamera springs to
// and cuts to on each shot's first frame.
//   establish  the high wide from the sideline (the sun behind it), the
//              offense set at the line across the frame, a slow drift.
//   play       the live broadcast angle (GameCamera's own logic).
//   reaction   low and tight on the man the play was about, from in front
//              of him and off his shoulder, on a long lens.
//   board      from high over the south end, down the bowl to the north
//              stands and the video board over them, a slow push in on the lens.

import { montage, type ShotId } from '@/game/montageSession';
import { YARD } from '../world/constants';

export interface MontagePose {
  ex: number;
  ey: number;
  eh: number;
  lx: number;
  ly: number;
  lh: number;
  fov: number;
}

/** The video board's face in the field frame (World.tsx: on the north roof lip, z ≈ −64.9 m, its middle ~54 m up). */
const BOARD = { x: 50 + 64.9 / YARD, h: 54 };

/** The reaction shot's side: fixed at its cut (radians off his facing), so the tracking never swings round him. */
const reaction = { side: 0.55, epoch: -1, face: 0 };

export function montagePose(shot: ShotId, broadcast: () => MontagePose | null): MontagePose | null {
  const p = montage.player;
  if (!p) return null;
  const s = p.runner.state;
  const cur = p.runner.cur;
  const los = s.setup.los;
  const t = montage.shotT;
  if (shot === 'establish') {
    // 42 yd off the ball on the offense's left sideline, 15 m up: the formation and both wideouts across the frame.
    const drift = Math.min(2, t) * 1.1;
    return { ex: los + 1 + drift, ey: 42, eh: 15, lx: los + 4 + drift, ly: 0, lh: 0, fov: 25 };
  }
  if (shot === 'play') return broadcast();
  if (shot === 'reaction') {
    const who = montage.staged?.who ?? -1;
    const a = cur.agents[who >= 0 ? who : s.qb] ?? cur.agents[s.qb]!;
    if (reaction.epoch !== montage.cutCount) {
      reaction.epoch = montage.cutCount;
      reaction.face = a.face;
      // From the side the camera was already on (the broadcast is behind the offense, looking upfield).
      reaction.side = a.y >= 0 ? -0.6 : 0.6;
    }
    const ang = reaction.face + reaction.side;
    const d = 8;
    return { ex: a.x + Math.cos(ang) * d, ey: a.y + Math.sin(ang) * d, eh: 1.55, lx: a.x, ly: a.y, lh: 1.15, fov: 26 };
  }
  // The board: from high over the south end zone, down the length of the bowl to the north stands and the board over them.
  return { ex: 6, ey: 4, eh: 30, lx: BOARD.x, ly: 0, lh: BOARD.h - 6, fov: 27 - Math.min(1, t / 2.6) * 3 };
}

/** Spring rates per shot (eye ×3, look ×3, fov): the wide drifts, the reaction tracks him tight, the board pushes slowly. */
export function montageRates(shot: ShotId): number[] | null {
  if (shot === 'establish') return [2, 2, 2, 3, 3, 3, 2];
  if (shot === 'reaction') return [5, 5, 5, 8, 8, 8, 4];
  if (shot === 'board') return [2, 2, 2, 3, 3, 3, 2];
  return null;
}

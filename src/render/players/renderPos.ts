import type { SimPlayer } from '@/sim';
import type { Position } from './variety';

/** The sim's positions to the render's body positions (variety.ts, contact.ts). */
export const RENDER_POS: Record<SimPlayer['pos'], Position> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', OL: 'OL', DE: 'DL', DT: 'DL', LB: 'LB', CB: 'CB', S: 'S' };

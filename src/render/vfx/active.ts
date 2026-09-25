// The live world's particle pool, for effects the play triggers (a big
// hit's dust). World owns it; the game scene only emits into it.
import type { ParticlePool } from './particles';

let pool: ParticlePool | null = null;
export const setActiveVfx = (p: ParticlePool | null): void => void (pool = p);
export const activeVfx = (): ParticlePool | null => pool;

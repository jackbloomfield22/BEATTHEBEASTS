import type { SimEvent } from '@/sim';

/** Sim events stepped this frame (GameScene fills it first; the camera and HUD read it). */
export const frameEvents: SimEvent[] = [];

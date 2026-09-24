import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { travelAt, type ClipMeta } from '@/anim/library';

// The transition clips as exported (tools/blender/build_anims.py).
const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { fps: number; clips: Record<string, ClipMeta & { gates: { pass: boolean } }> };
const transitions = Object.entries(json.clips).filter(([, m]) => m.kind === 'transition');

describe('transition clips', () => {
  it('cover the huddle break, every set, get-off and stop', () => {
    const names = transitions.map(([n]) => n);
    expect(names).toContain('huddle_break');
    for (const s of ['ol_3pt', 'dl_3pt', 'dl_4pt', 'wr_2pt', 'lb_ready', 'db_ready', 'rb_2pt']) {
      expect(names).toContain(`set_${s}`);
      expect(names).toContain(`getoff_${s}`);
    }
    for (const g of ['walk', 'jog', 'run', 'sprint']) expect(names).toContain(`stop_${g}`);
  });

  it('pass their gates and join clips that exist', () => {
    for (const [name, m] of transitions) {
      expect(m.gates.pass, name).toBe(true);
      expect(json.clips[m.from!], `${name} from`).toBeDefined();
      expect(json.clips[m.to!], `${name} to`).toBeDefined();
      expect(m.travel!.length, name).toBe(m.frames + 1);
    }
  });

  it('never travel backward, and hand over at the next clip speed', () => {
    for (const [name, m] of transitions) {
      const tr = m.travel!;
      for (let i = 1; i < tr.length; i++) expect(tr[i]! - tr[i - 1]!, `${name} frame ${i}`).toBeGreaterThanOrEqual(-1e-4);
      const endSpeed = (tr[tr.length - 1]! - tr[tr.length - 2]!) * json.fps;
      const to = json.clips[m.to!]!;
      // Within the last frame's worth of acceleration of the clip it hands to.
      expect(Math.abs(endSpeed - to.speed), name).toBeLessThan(0.25 * Math.max(1, to.speed));
    }
  });

  it('samples the travel curve between frames', () => {
    const m = { travel: [0, 1, 3] } as unknown as ClipMeta;
    expect(travelAt(m, 30, 0)).toBe(0);
    expect(travelAt(m, 30, 1.5 / 30)).toBeCloseTo(2);
    expect(travelAt(m, 30, 10)).toBe(3);
    expect(travelAt(m, 30, -1)).toBe(0);
  });
});

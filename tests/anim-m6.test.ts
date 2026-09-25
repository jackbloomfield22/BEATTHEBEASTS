import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClipMeta } from '@/anim/library';
import { PART } from '@/render/players/playerMaterial';
import { OFFICIAL_KIT, REFEREE_KIT } from '@/render/players/kits';

// The M6 clip set as exported (tools/blender/build_anims.py) and the
// official variant of the character (tools/blender/build_character.py).
type Meta = ClipMeta & { gates: { pass: boolean; loop_deg: number } };
const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { fps: number; clips: Record<string, Meta> };
const clips = json.clips;
const character = JSON.parse(readFileSync('public/assets/characters/player.json', 'utf8')) as {
  lods: { triangles: number }[];
  official: { triangles: number }[];
  parts: Record<string, number>;
};

const M6 = {
  ol: ['ol_kick_slide_r', 'ol_kick_slide_l', 'ol_anchor', 'ol_punch_mirror_l', 'ol_punch_mirror_r', 'ol_drive', 'ol_fire_drive', 'ol_pull_l', 'ol_pull_r', 'ol_settle'],
  dl: ['dl_swim_l', 'dl_swim_r', 'dl_rip_l', 'dl_rip_r', 'dl_club_l', 'dl_club_r', 'dl_spin_l', 'dl_spin_r', 'dl_bull_rush', 'dl_engage', 'dl_shed_l', 'dl_shed_r'],
  lb: ['lb_read_step', 'lb_shuffle_l', 'lb_shuffle_r', 'lb_fill', 'lb_scrape_l', 'lb_scrape_r', 'lb_drop_hook_l', 'lb_drop_hook_r', 'lb_take_on'],
  db: ['db_press_jam_l', 'db_press_jam_r', 'db_hip_flip_l', 'db_hip_flip_r', 'db_break'],
  kick: ['ks_long_snap', 'ks_hold', 'ks_place_kick', 'ks_punt'],
  ref: ['ref_idle', 'ref_run', 'ref_touchdown', 'ref_first_down_l', 'ref_first_down_r', 'ref_incomplete', 'ref_whistle'],
  sig: ['sig_qb', 'sig_wr', 'sig_rb', 'sig_te', 'sig_ol'],
};
const STANCES = ['stance_ol_pass', 'stance_ol_ready', 'stance_db_press', 'stance_ls', 'stance_holder', 'stance_holder_watch', 'stance_kicker', 'stance_punter', 'stance_ref'];

describe('M6 clips', () => {
  it('exist and pass their gates', () => {
    for (const n of [...Object.values(M6).flat(), ...STANCES]) {
      expect(clips[n], n).toBeDefined();
      expect(clips[n]!.gates.pass, n).toBe(true);
    }
  });

  it('carry the events the game syncs the ball and whistle to', () => {
    expect(clips.ks_long_snap!.events).toEqual({ release: 5 });
    expect(clips.ks_hold!.events).toEqual({ catch: 3, place: 11, kick: 21 });
    expect(clips.ks_place_kick!.events).toEqual({ contact: 20 });
    expect(clips.ks_punt!.events).toEqual({ catch: 3, drop: 34, contact: 42 });
    expect(clips.ref_whistle!.events?.whistle).toBe(8);
    expect(clips.ref_touchdown!.events?.signal).toBe(10);
    // NFL operation times: a punter gets it off ~1.25-1.35 s after the catch;
    // the holder's kick comes ~0.6 s after his catch.
    const fps = json.fps;
    const punt = clips.ks_punt!.events!;
    expect((punt.contact! - punt.catch!) / fps).toBeGreaterThan(1.2);
    expect((punt.contact! - punt.catch!) / fps).toBeLessThan(1.4);
    const hold = clips.ks_hold!.events!;
    expect((hold.kick! - hold.catch!) / fps).toBeCloseTo(0.6, 1);
  });

  it('turning clips say how far the body turns, and gait-born ones where they start', () => {
    expect(clips.ol_pull_l!.turn).toBe(90);
    expect(clips.ol_pull_r!.turn).toBe(-90);
    expect(clips.db_hip_flip_l!.turn).toBe(180);
    expect(clips.db_hip_flip_r!.turn).toBe(-180);
    expect(clips.db_hip_flip_l!.fromPhase).toBe(0.5);
    expect(clips.db_hip_flip_r!.fromPhase).toBe(0);
    for (const n of ['dl_swim_l', 'dl_rip_l', 'dl_club_l', 'dl_spin_l', 'dl_bull_rush', 'db_break']) expect(clips[n]!.fromPhase, n).toBe(0);
    // Pulls run down the line: their travel is sideways.
    const [dx, dz] = clips.ol_pull_l!.dir;
    expect(dx).toBe(1);
    expect(Math.abs(dz)).toBe(0);
  });

  it('loops close: the drive, the shuffle, the hand fight, the official, the signatures', () => {
    for (const n of ['ol_drive', 'lb_shuffle_l', 'lb_shuffle_r', 'dl_engage', 'ref_idle', 'ref_run', ...M6.sig]) {
      expect(clips[n]!.loop, n).toBe(true);
      expect(clips[n]!.gates.loop_deg, n).toBeLessThanOrEqual(1);
    }
  });

  it('signature clips play in place, 2-3.5 s each', () => {
    for (const n of M6.sig) {
      const m = clips[n]!;
      expect(m.kind, n).toBe('signature');
      expect(m.travel, n).toBeUndefined();
      expect(m.duration, n).toBeGreaterThanOrEqual(2);
      expect(m.duration, n).toBeLessThanOrEqual(3.5);
    }
  });
});

describe('the official variant', () => {
  it('ships three LODs no heavier than the player', () => {
    expect(character.official).toHaveLength(3);
    character.official.forEach((l, i) => expect(l.triangles).toBeLessThanOrEqual(character.lods[i]!.triangles));
  });

  it('has its shirt and cap parts, matching the material', () => {
    expect(character.parts.shirt).toBe(PART.shirt);
    expect(character.parts.cap).toBe(PART.cap);
    for (const [k, v] of Object.entries(character.parts)) expect(Object.values(PART), k).toContain(v);
  });

  it('wears black and white, with no lettering colors of its own', () => {
    for (const kit of [OFFICIAL_KIT, REFEREE_KIT]) {
      expect(kit.jersey.toLowerCase()).toMatch(/^#f/);
      expect(kit.trim.toLowerCase()).toMatch(/^#1/);
      expect(kit.stripeGlow).toBe(0);
    }
    expect(REFEREE_KIT.helmet).not.toBe(OFFICIAL_KIT.helmet);
  });
});

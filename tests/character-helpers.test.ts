import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ELBOW_SHARE, EPAULET_FROM, EPAULET_MAX, EPAULET_TO, HELPERS, epauletShare, swingShare } from '@/render/players/playerAsset';

// The helper bones (character pass round two, docs/characters/CHARACTERS2.md):
// the runtime must drive them as the build's skinning gate measured them
// (tools/blender/lib/helpers.py, recorded in player.json).
const manifest = JSON.parse(readFileSync('public/assets/characters/player.json', 'utf8')) as {
  helpers: Record<string, { parent: string; child: string; from?: number; to?: number; max?: number; share?: number }>;
};

describe('helper bones', () => {
  it('match the build', () => {
    const h = manifest.helpers;
    expect(Object.keys(h).sort()).toEqual(Object.keys(HELPERS).sort());
    for (const [k, v] of Object.entries(HELPERS)) {
      expect(h[k]!.parent).toBe(v.parent);
      expect(h[k]!.child).toBe(v.child);
    }
    expect(h.epaulet).toMatchObject({ from: EPAULET_FROM, to: EPAULET_TO, max: EPAULET_MAX });
    expect(h.elbow_helper!.share).toBe(ELBOW_SHARE);
  });

  it('the epaulet stays put through normal play and rises only with the arm overhead', () => {
    expect(epauletShare(45)).toBe(0); // the A-pose
    expect(epauletShare(90)).toBe(0); // a sprint's arm swing, a punch
    expect(epauletShare(130)).toBeGreaterThan(0.2);
    expect(epauletShare(175)).toBeCloseTo(EPAULET_MAX, 6);
  });

  it('takes a share of the swing and none of the twist', () => {
    const out = new THREE.Quaternion();
    // A pure twist about the bone's own axis (Y): the helper doesn't turn.
    const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2);
    expect(swingShare(twist, 0.5, out).angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    // A pure swing (a bend about X): half the angle.
    const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 2.0);
    expect(swingShare(bend, 0.5, out).angleTo(new THREE.Quaternion())).toBeCloseTo(1.0, 6);
    // Swing then twist: the swing's share, the bone's axis where half the swing puts it.
    const both = bend.clone().multiply(twist);
    swingShare(both, 0.5, out);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(out);
    const want = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.0));
    expect(axis.distanceTo(want)).toBeLessThan(1e-6);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPlay, defById, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '@/sim';
import { PASSING9 } from '@/game/clips';
import { capture, emptySnapshot } from '@/game/snapshot';
import { BroadcastCam, poseToWorld, Spring } from '@/render/game/broadcastCam';
import { worldX, worldZ } from '@/game/coords';

// Passing round 11 (docs/passing/PASSING11.md): the broadcast camera on a pass, stepped at 60 fps as a recording steps
// it (tools/sim/p11_cam.ts is the same measure, every recorded throw): the move starts with the windup, the slant's pan
// peaks under 35°/s (round ten's ~53), the QB is in the frame as he lets it go, and the catch is framed as tight.
// Passing round 12 (docs/passing/PASSING12.md): the slant's zoom under 45°/s of lens (round eleven's 67), the QB in the
// frame longer after the release (0.32 s, round eleven's 0.25) and the receiver at least as large at the catch.
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const W = 960;
const H = 540;

function measure(id: string) {
  const c = PASSING9.find((x) => x.id === id)!;
  const s: PlayState = createPlay({ seed: c.seed, offense: rosters.offense, defense: rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  const cur = capture(s, emptySnapshot(s.agents.length));
  const bc = new BroadcastCam();
  const cam = new THREE.PerspectiveCamera(52, W / H, 0.1, 500);
  const v = new THREE.Vector3();
  const drawn = (x: number, y: number) => {
    v.set(worldX(y), 0, worldZ(x)).project(cam);
    const fy = v.y;
    const inFeet = Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    v.set(worldX(y), 1.95, worldZ(x)).project(cam);
    return { h: ((v.y - fy) * H) / 2, in: inFeet && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  };
  let springs: Spring[] | null = null;
  let prev: THREE.Vector3 | null = null;
  let windup = -1;
  let release = -1;
  let target = -1;
  let movedAtRelease = 0;
  let dir0: THREE.Vector3 | null = null;
  const pans: number[] = [];
  const zooms: number[] = [];
  let fov0: number | null = null;
  let qbIn = -1;
  let qbOut = false;
  let qbAtRelease = { h: 0, in: false };
  let recAtCatch = 0;
  for (let k = 0; k < 900 && !s.result; k++) {
    if (windup < 0 && s.windup) windup = s.t;
    const t = poseToWorld(bc.pose(s, cur));
    springs ??= t.map((x) => new Spring(x));
    const w = bc.weights(s, cur);
    const p = springs.map((sp, i) => sp.step(t[i]!, w[i]!, 1 / 60));
    bc.camNow.eye.set(p[0]!, p[1]!, p[2]!);
    bc.camNow.ok = true;
    cam.position.set(p[0]!, p[1]!, p[2]!);
    cam.fov = p[6]!;
    cam.lookAt(p[3]!, p[4]!, p[5]!);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const dir = cam.getWorldDirection(new THREE.Vector3());
    if (windup >= 0 && !dir0) dir0 = dir.clone();
    if (prev && windup >= 0) pans.push((dir.angleTo(prev) * 180) / Math.PI / (1 / 60));
    if (fov0 !== null && windup >= 0) zooms.push(Math.abs(p[6]! - fov0) * 60);
    fov0 = p[6]!;
    if (release >= 0 && !qbOut) {
      if (drawn(cur.agents[s.qb]!.x, cur.agents[s.qb]!.y).in) qbIn = s.t - release;
      else qbOut = true;
    }
    prev = dir;
    if (release < 0 && s.ball.mode === 'air') {
      release = s.t;
      target = s.ball.target;
      qbAtRelease = drawn(cur.agents[s.qb]!.x, cur.agents[s.qb]!.y);
      movedAtRelease = (dir.angleTo(dir0!) * 180) / Math.PI;
    }
    if (release >= 0 && s.phase !== 'air' && !recAtCatch) {
      recAtCatch = drawn(cur.agents[target]!.x, cur.agents[target]!.y).h;
      break;
    }
    stepPlay(s, c.script(s));
    capture(s, cur);
  }
  const m3 = (xs: number[]) => xs.map((_, i) => (xs[Math.max(0, i - 1)]! + xs[i]! + xs[Math.min(xs.length - 1, i + 1)]!) / 3);
  return { windup, release, peakPan: Math.max(...m3(pans)), peakZoom: Math.max(...m3(zooms)), qbAtRelease, qbIn, recAtCatch, movedAtRelease };
}

describe('the broadcast camera on a pass (passing round 11)', () => {
  it('the slant: the move starts on the windup, pans under 35°/s, the QB in the shot as he lets it go, the catch framed tight', () => {
    const m = measure('p9-slant');
    expect(m.windup).toBeGreaterThan(0);
    expect(m.release - m.windup).toBeGreaterThan(0.2);
    // Moving by the release (round ten held still until the ball was out).
    expect(m.movedAtRelease).toBeGreaterThan(0.5);
    expect(m.peakPan).toBeLessThan(35);
    // (Round 12) The lens: 44°/s on this measure (round eleven's 67).
    expect(m.peakZoom).toBeLessThan(45.5);
    expect(m.qbAtRelease.in).toBe(true);
    // The push on the passer: ~1.2x round ten's 77 px (94 px).
    expect(m.qbAtRelease.h).toBeGreaterThan(90);
    // (Round 12) In the frame through the flick's finish: to 0.32 s after the release (round eleven's 0.25).
    expect(m.qbIn).toBeGreaterThan(0.3);
    // At least as large at the catch as round eleven (140 px on this measure; 148 now).
    expect(m.recAtCatch).toBeGreaterThan(140);
  });
  it("the out: the pan under round ten's (52°/s)", () => {
    const m = measure('p9-out');
    expect(m.peakPan).toBeLessThan(42);
    expect(m.peakZoom).toBeLessThan(45.5);
    expect(m.qbIn).toBeGreaterThan(0.4);
    expect(m.qbAtRelease.in).toBe(true);
    expect(m.recAtCatch).toBeGreaterThan(125);
  });
});

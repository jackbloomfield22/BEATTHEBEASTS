import * as THREE from 'three';
import type { AnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { FIELD_HALF_W, type PlayResult } from '@/sim';
import { worldX, worldZ, yawOf } from '@/game/coords';
import { createOfficial, type Player, type PlayerAsset } from '../players/playerAsset';

// The officiating crew (M6): four of the seven, the ones the broadcast
// camera sees. The referee (white cap) behind the offense on the QB's right
// at ~12 yd, the head linesman and line judge on the sidelines at the line
// of scrimmage, the back judge 20 yd deep in the middle (NFL mechanics).
// They set before the snap, turn with the ball during it, and after the
// whistle the nearest official signals the result: touchdown, first down
// (arm toward the offense's goal), incomplete, or the referee's whistle.
// Render-only: the sim never sees them.

interface Official {
  player: Player;
  anim: PlayerAnimator;
  /** Where he stands relative to the ball at the snap (x downfield, y left), yd. */
  spot: [number, number];
  role: 'R' | 'HL' | 'LJ' | 'BJ';
}

const SKINS = ['#8d5524', '#e0b48f', '#c08552', '#f2d6bd'];

export class Officials {
  readonly group = new THREE.Group();
  private crew: Official[];
  private signalled = false;

  constructor(asset: PlayerAsset, lib: AnimLibrary) {
    this.group.name = 'officials';
    const spots: [Official['role'], [number, number]][] = [
      ['R', [-12, -4.5]],
      ['HL', [0, -(FIELD_HALF_W + 1.2)]],
      ['LJ', [0, FIELD_HALF_W + 1.2]],
      ['BJ', [20, 0]],
    ];
    this.crew = spots.map(([role, spot], i) => {
      const player = createOfficial(asset, { skin: SKINS[i]!, referee: role === 'R' });
      const anim = new PlayerAnimator(player, lib);
      anim.setStance('stance_ref');
      anim.update(10, { speed: 0 });
      this.group.add(player.root);
      return { player, anim, spot, role };
    });
  }

  /** A new play: the crew sets around the ball. */
  place(los: number, ballY: number): void {
    this.signalled = false;
    for (const o of this.crew) {
      const x = los + o.spot[0];
      // Sideline officials stay on their sideline; the others shade with the ball.
      const y = o.role === 'HL' || o.role === 'LJ' ? o.spot[1] : Math.max(-FIELD_HALF_W + 3, Math.min(FIELD_HALF_W - 3, ballY + o.spot[1]));
      o.player.root.position.set(worldX(y), 0, worldZ(x));
      o.player.root.rotation.y = yawOf(o.role === 'BJ' ? Math.PI : o.role === 'R' ? 0 : o.spot[1] > 0 ? -Math.PI / 2 : Math.PI / 2);
      o.anim.reset();
      o.anim.setStance('stance_ref');
      o.anim.update(10, { speed: 0 });
    }
  }

  /** Each frame: face the ball; after the whistle, the call. */
  update(dt: number, ball: { x: number; y: number }, result: PlayResult | null, gained: number, toGo: number, camera: THREE.Camera, viewportPx: number): void {
    for (const o of this.crew) {
      const p = o.player.root.position;
      // Turn toward the ball (field frame → yaw).
      const bx = worldX(ball.y) - p.x;
      const bz = worldZ(ball.x) - p.z;
      const want = Math.atan2(bx, bz);
      let d = want - o.player.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      o.player.root.rotation.y += d * (1 - Math.exp(-dt * 3));
      o.anim.update(dt, { speed: 0 });
      o.player.updateLod(camera, viewportPx);
    }
    if (!result || this.signalled) return;
    this.signalled = true;
    const near = this.nearest(ball);
    const ref = this.crew[0]!;
    ref.anim.play('ref_whistle', { now: true });
    if (result.touchdown) {
      for (const o of this.crew) if (o.role === 'BJ' || o === near) o.anim.play('ref_touchdown', { now: true });
    } else if (result.reason === 'incomplete') near.anim.play('ref_incomplete', { now: true });
    else if (result.offenseBall && gained >= toGo) {
      // First down: the linesman points toward the goal the offense attacks.
      const hl = this.crew[1]!;
      hl.anim.play(hl.spot[1] < 0 ? 'ref_first_down_l' : 'ref_first_down_r', { now: true });
    }
  }

  private nearest(ball: { x: number; y: number }): Official {
    let best = this.crew[0]!;
    let bd = Infinity;
    for (const o of this.crew) {
      const p = o.player.root.position;
      const d = (p.x - worldX(ball.y)) ** 2 + (p.z - worldZ(ball.x)) ** 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
}

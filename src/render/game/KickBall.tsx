import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { urlFlags } from '@/app/platform';
import { worldX, worldY, worldZ, yawOf } from '@/game/coords';
import { loadAnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { createFootball } from './football';
import { kickView, KICK_CONTACT } from './kickView';
import { KITS } from '../players/kits';
import { loadPlayerAsset, Player } from '../players/playerAsset';
import { YARD } from '../world/constants';

// A field goal or PAT (M6): the long snapper at the line, the holder
// kneeling 7 yd back, the kicker set behind him. The strike plays the
// kicking game's clips (tools/blender: ks_long_snap releases at 0.17 s,
// the ball reaches the holder ~0.55 s later, ks_hold places it, and
// ks_place_kick meets it at KICK_CONTACT), then the ball flies the path
// src/game/kick.ts computed, end over end.

interface Man {
  player: Player;
  anim: PlayerAnimator;
  /** Field-frame spot relative to the spot of the kick (x toward the posts, y left), yd. */
  at: [number, number];
  stance: string;
  clip: string;
  /** Seconds after the strike his clip starts. */
  start: number;
  started: boolean;
}

/** The snap leaves the snapper's hands (ks_long_snap release frame 5 at 30 fps). */
const SNAP_RELEASE = 5 / 30;
/** ~13 yd/s snap over 7 yd, into the holder's hands. */
const SNAP_FLIGHT = 0.55;
/** The kicker's approach before contact (ks_place_kick contact frame 20 at 30 fps). */
const KICKER_LEAD = 20 / 30;
/** ks_place_kick's run-up covers 2.32 m. */
const KICKER_BACK = 2.32 / YARD;

export function KickBall() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const [ball] = useState(createFootball);
  const unit = useRef<{ group: THREE.Group; men: Man[] } | null>(null);
  /** The spot the unit last set at (null: not set for this kick). */
  const placed = useRef<number | null>(null);

  useEffect(() => {
    scene.add(ball);
    let alive = true;
    let group: THREE.Group | null = null;
    Promise.all([loadPlayerAsset(), loadAnimLibrary()]).then(([asset, lib]) => {
      if (!alive) return;
      group = new THREE.Group();
      group.name = 'kick-unit';
      const mk = (num: number, name: string, at: [number, number], stance: string, clip: string, start: number): Man => {
        const player = new Player(asset, { kit: KITS.blackoutLime!, skin: '#c08552', number: num, name, heightM: 1.88, weightKg: 100 });
        const anim = new PlayerAnimator(player, lib);
        anim.setStance(stance);
        anim.update(10, { speed: 0 });
        group!.add(player.root);
        return { player, anim, at, stance, clip, start, started: false };
      };
      unit.current = {
        group,
        men: [
          mk(48, 'SNAPPER', [7, 0], 'stance_ls', 'ks_long_snap', 0),
          mk(9, 'HOLDER', [0, 0.45], 'stance_holder', 'ks_hold', 0),
          mk(3, 'KICKER', [-KICKER_BACK, -0.35], 'stance_kicker', 'ks_place_kick', KICK_CONTACT - KICKER_LEAD),
        ],
      };
      group.visible = false;
      scene.add(group);
    });
    return () => {
      alive = false;
      scene.remove(ball);
      if (group) scene.remove(group);
    };
  }, [scene, ball]);

  useFrame((_, dt) => {
    const u = unit.current;
    ball.visible = kickView.active;
    if (u) u.group.visible = kickView.active;
    if (!kickView.active) {
      placed.current = null;
      return;
    }
    const step = urlFlags.video ? 1 / urlFlags.video : urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    const sx = kickView.spotX;
    const p = kickView.path;
    // A new kick: the unit sets at its spot (and again if the unit loads after the kick is up).
    if (u && placed.current !== sx) {
      placed.current = sx;
      for (const m of u.men) {
        m.started = false;
        m.anim.reset();
        m.anim.setStance(m.stance);
        m.anim.update(10, { speed: 0 });
        m.player.root.position.set(worldX(m.at[1]), 0, worldZ(sx + m.at[0]));
        m.player.root.rotation.y = yawOf(0);
      }
    }
    if (p) kickView.t += step;
    const t = p ? kickView.t : 0;
    if (u) {
      for (const m of u.men) {
        if (p && !m.started && t >= m.start) {
          m.started = true;
          m.anim.play(m.clip, { now: true });
        }
        m.anim.update(step, { speed: 0 });
        // The kicker's run-up is root motion along his facing (downfield).
        if (m.started && m.clip === 'ks_place_kick') m.player.root.position.z -= m.anim.rootMotion;
        m.player.updateLod(camera, gl.domElement.height);
      }
    }
    if (!p || t < SNAP_RELEASE) {
      // At the snapper's hands on the ground, laces up, pointing downfield.
      ball.position.set(worldX(0), worldY(0.1), worldZ(sx + 7));
      ball.rotation.set(0, Math.PI / 2, 0);
      return;
    }
    if (t < SNAP_RELEASE + SNAP_FLIGHT) {
      // The snap: a tight spiral back to the holder's hands (~0.4 yd up).
      const f = (t - SNAP_RELEASE) / SNAP_FLIGHT;
      ball.position.set(worldX(0.2 * f), worldY(0.35 + 0.25 * Math.sin(Math.PI * f)), worldZ(sx + 7 * (1 - f)));
      ball.rotation.set(t * 40, Math.PI / 2, 0);
      return;
    }
    if (t < KICK_CONTACT) {
      // Held on the spot, point down, laces toward the posts.
      ball.position.set(worldX(0), worldY(0.3), worldZ(sx));
      ball.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.2);
      return;
    }
    const ft = t - KICK_CONTACT;
    const k = Math.min(p.length - 1, ft * 30);
    const i = Math.floor(k);
    const a = p[i]!;
    const b = p[Math.min(p.length - 1, i + 1)]!;
    const w = k - i;
    const x = a[0] + (b[0] - a[0]) * w;
    const y = a[1] + (b[1] - a[1]) * w;
    const z = a[2] + (b[2] - a[2]) * w;
    ball.position.set(worldX(y), worldY(Math.max(0.15, z + 0.3)), worldZ(sx + x));
    // End over end, ~9 rev/s off a placekick.
    ball.rotation.set(-ft * Math.PI * 2 * 9, Math.PI / 2, 0);
  });
  return null;
}

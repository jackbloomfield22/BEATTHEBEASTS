import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { urlFlags, videoTime } from '@/app/platform';
import { worldX, worldY, worldZ, yawOf } from '@/game/coords';
import { PUNT_DEPTH } from '@/game/kick';
import { loadAnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { createFootball } from './football';
import { contactFor, kickView, KICK_CONTACT, PUNT_SNAP } from './kickView';
import { KITS } from '../players/kits';
import { loadPlayerAsset, Player } from '../players/playerAsset';
import { YARD } from '../world/constants';

// A field goal, PAT or punt (M6, M6.6). A place kick: the long snapper at
// the line, the holder kneeling 7 yd back, the kicker set behind him; the
// strike plays the kicking game's clips (tools/blender: ks_long_snap
// releases at 0.17 s, the ball reaches the holder ~0.55 s later, ks_hold
// places it, and ks_place_kick meets it at KICK_CONTACT). A punt: the snap
// goes 15 yd to the punter, who catches it (ks_punt frame 3), drops it
// (frame 34) and meets it (frame 42). Then the ball flies the path
// src/game/kick.ts computed, end over end off a place kick, a spiral off a
// punt.

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
  /** Which kicks he's in. */
  on: 'place' | 'punt' | 'both';
}

/** The snap leaves the snapper's hands (ks_long_snap release frame 5 at 30 fps). */
const SNAP_RELEASE = 5 / 30;
/** ~13 yd/s snap over 7 yd, into the holder's hands. */
const SNAP_FLIGHT = 0.55;
/** The kicker's approach before contact (ks_place_kick contact frame 20 at 30 fps). */
const KICKER_LEAD = 20 / 30;
/** ks_place_kick's run-up covers 2.32 m. */
const KICKER_BACK = 2.32 / YARD;
/** ks_punt's steps to contact cover 1.35 m. */
const PUNTER_BACK = 1.35 / YARD;
/** A punt's clip starts so its catch frame meets the snap. */
const PUNT_CLIP_AT = PUNT_SNAP.release + PUNT_SNAP.flight - PUNT_SNAP.clipLead;

export function KickBall() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const [ball] = useState(createFootball);
  const unit = useRef<{ group: THREE.Group; men: Man[] } | null>(null);
  /** The kick the unit last set for (null: not set for this kick). */
  const placed = useRef<string | null>(null);

  useEffect(() => {
    scene.add(ball);
    let alive = true;
    let group: THREE.Group | null = null;
    Promise.all([loadPlayerAsset(), loadAnimLibrary()]).then(([asset, lib]) => {
      if (!alive) return;
      group = new THREE.Group();
      group.name = 'kick-unit';
      // The specialists aren't drafted, so their backs carry numbers only.
      const mk = (num: number, at: [number, number], stance: string, clip: string, start: number, on: Man['on']): Man => {
        const player = new Player(asset, { kit: KITS.blackoutLime!, skin: '#c08552', number: num, heightM: 1.88, weightKg: 100 });
        const anim = new PlayerAnimator(player, lib);
        anim.setStance(stance);
        anim.update(10, { speed: 0 });
        group!.add(player.root);
        return { player, anim, at, stance, clip, start, started: false, on };
      };
      unit.current = {
        group,
        men: [
          mk(48, [7, 0], 'stance_ls', 'ks_long_snap', 0, 'place'),
          mk(9, [0, 0.45], 'stance_holder', 'ks_hold', 0, 'place'),
          mk(3, [-KICKER_BACK, -0.35], 'stance_kicker', 'ks_place_kick', KICK_CONTACT - KICKER_LEAD, 'place'),
          mk(48, [PUNT_DEPTH, 0], 'stance_ls', 'ks_long_snap', 0, 'punt'),
          mk(5, [-PUNTER_BACK, 0], 'stance_punter', 'ks_punt', PUNT_CLIP_AT, 'punt'),
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
    const step = urlFlags.video ? videoTime.step() : urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    const sx = kickView.spotX;
    const punt = kickView.kind === 'PUNT';
    const p = kickView.path;
    // A new kick: the unit sets at its spot (and again if the unit loads after the kick is up).
    const key = `${kickView.kind}:${sx}`;
    if (u && placed.current !== key) {
      placed.current = key;
      for (const m of u.men) {
        const on = m.on === 'both' || (m.on === 'punt') === punt;
        m.player.root.visible = on;
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
        if (!m.player.root.visible) continue;
        if (p && !m.started && t >= m.start) {
          m.started = true;
          m.anim.play(m.clip, { now: true });
        }
        m.anim.update(step, { speed: 0 });
        // The kicker's run-up and the punter's steps are root motion along his facing (downfield).
        if (m.started && (m.clip === 'ks_place_kick' || m.clip === 'ks_punt')) m.player.root.position.z -= m.anim.rootMotion;
        m.player.updateLod(camera, gl.domElement.height);
      }
    }
    const at = (x: number, y: number, z: number) => {
      ball.position.set(worldX(y), worldY(z), worldZ(sx + x));
      kickView.ball = [x, y, z];
    };
    const contact = contactFor(kickView.kind);
    if (punt) {
      const r = PUNT_SNAP.release;
      const caught = r + PUNT_SNAP.flight;
      const drop = PUNT_CLIP_AT + PUNT_SNAP.drop;
      if (!p || t < r) {
        at(PUNT_DEPTH, 0, 0.1);
        ball.rotation.set(0, Math.PI / 2, 0);
        return;
      }
      if (t < caught) {
        // The snap: a spiral 15 yd back to the punter's hands (chest high).
        const f = (t - r) / PUNT_SNAP.flight;
        at(PUNT_DEPTH - (PUNT_DEPTH + PUNTER_BACK) * f, 0.1 * f, 0.3 + 0.7 * f + 0.6 * Math.sin(Math.PI * f));
        ball.rotation.set(t * 40, Math.PI / 2, 0);
        return;
      }
      if (t < drop) {
        // Laces up over the right thigh as he steps into it.
        const f = (t - caught) / (drop - caught);
        at(-PUNTER_BACK * (1 - f * 0.8), -0.15, 0.95 - 0.05 * f);
        ball.rotation.set(0, Math.PI / 2, -0.3);
        return;
      }
      if (t < contact) {
        const f = (t - drop) / (contact - drop);
        at(-PUNTER_BACK * 0.2 * (1 - f), -0.15 * (1 - f), 0.9 - 0.45 * f * f);
        ball.rotation.set(0, Math.PI / 2, -0.3);
        return;
      }
    } else {
      if (!p || t < SNAP_RELEASE) {
        // At the snapper's hands on the ground, laces up, pointing downfield.
        at(7, 0, 0.1);
        ball.rotation.set(0, Math.PI / 2, 0);
        return;
      }
      if (t < SNAP_RELEASE + SNAP_FLIGHT) {
        // The snap: a tight spiral back to the holder's hands (~0.4 yd up).
        const f = (t - SNAP_RELEASE) / SNAP_FLIGHT;
        at(7 * (1 - f), 0.2 * f, 0.35 + 0.25 * Math.sin(Math.PI * f));
        ball.rotation.set(t * 40, Math.PI / 2, 0);
        return;
      }
      if (t < contact) {
        // Held on the spot, point down, laces toward the posts.
        at(0, 0, 0.3);
        ball.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.2);
        return;
      }
    }
    const ft = t - contact;
    const k = Math.min(p.length - 1, ft * 30);
    const i = Math.floor(k);
    const a = p[i]!;
    const b = p[Math.min(p.length - 1, i + 1)]!;
    const w = k - i;
    const x = a[0] + (b[0] - a[0]) * w;
    const y = a[1] + (b[1] - a[1]) * w;
    const z = a[2] + (b[2] - a[2]) * w;
    at(x, y, Math.max(0.12, z + (punt ? 0 : 0.3)));
    // A place kick tumbles end over end (~9 rev/s); a punt spirals, nose up then over.
    if (punt) ball.rotation.set(-0.9 + Math.min(1.8, (ft / Math.max(0.5, kickView.path!.length / 30)) * 1.8), Math.PI / 2, ft * Math.PI * 2 * 5);
    else ball.rotation.set(-ft * Math.PI * 2 * 9, Math.PI / 2, 0);
  });
  return null;
}

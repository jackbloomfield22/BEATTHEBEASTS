import { useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadAnimLibrary, type AnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { skinHexFor } from '@/app/characterization';
import { urlFlags } from '@/app/platform';
import { KITS, type Kit } from './kits';
import { bodyFromImperial } from './bodyShape';
import { jerseyName } from './glyphs';
import { playerVariety, type Position } from './variety';
import { loadPlayerAsset, Player, type PlayerAsset } from './playerAsset';
import { YARD } from '../world/constants';
import { prepareLate, shadowAttach } from '../lighting/shadows';

// The M4 exit check (TECH_PLAN §16): 22 players lined up at the line of
// scrimmage in the stadium, in their stances, for the broadcast camera
// (?lineup; shots in tools/shots/matrix.spec.ts). The field's long axis is Z;
// the offense faces -Z, the defense +Z, the ball on the north 35 (z = -15 yd).
// Rosters are the two teams of a classic matchup: the Beasts on defense and
// a 1980s offense in the Royal kit. Sizes are the players' listed heights
// and weights (in, lb).

interface Slot {
  name: string;
  pos: Position;
  num: number;
  h: number;
  w: number;
  stance: string;
  /** Yards across (x), and from the ball back to the player's front (helmet or hands). */
  x: number;
  off: number;
}

const OFFENSE: Slot[] = [
  { name: 'Fred Quillan', pos: 'OL', num: 56, h: 77, w: 260, stance: 'stance_ol_3pt', x: 0, off: 0.2 },
  { name: 'Randy Cross', pos: 'OL', num: 51, h: 75, w: 265, stance: 'stance_ol_3pt', x: 1.35, off: 0.25 },
  { name: 'John Ayers', pos: 'OL', num: 68, h: 77, w: 265, stance: 'stance_ol_3pt', x: -1.35, off: 0.25 },
  { name: 'Keith Fahnhorst', pos: 'OL', num: 71, h: 78, w: 273, stance: 'stance_ol_3pt', x: 2.7, off: 0.3 },
  { name: 'Bubba Paris', pos: 'OL', num: 77, h: 78, w: 306, stance: 'stance_ol_3pt', x: -2.7, off: 0.3 },
  { name: 'Russ Francis', pos: 'TE', num: 81, h: 78, w: 242, stance: 'stance_ol_3pt', x: 4.1, off: 0.3 },
  { name: 'Joe Montana', pos: 'QB', num: 16, h: 74, w: 200, stance: 'stance_qb_gun', x: 0, off: 4.8 },
  { name: 'Roger Craig', pos: 'RB', num: 33, h: 72, w: 222, stance: 'stance_rb_2pt', x: -1.3, off: 5 },
  { name: 'Jerry Rice', pos: 'WR', num: 80, h: 74, w: 200, stance: 'stance_wr_2pt', x: -14, off: 0.3 },
  { name: 'Dwight Clark', pos: 'WR', num: 87, h: 76, w: 212, stance: 'stance_wr_2pt', x: 13, off: 0.3 },
  { name: 'John Taylor', pos: 'WR', num: 82, h: 73, w: 185, stance: 'stance_wr_2pt', x: 8.5, off: 1.2 },
];

const DEFENSE: Slot[] = [
  { name: 'Reggie White', pos: 'DL', num: 92, h: 77, w: 291, stance: 'stance_dl_4pt', x: -3.2, off: 0.4 },
  { name: 'Bruce Smith', pos: 'DL', num: 78, h: 76, w: 262, stance: 'stance_dl_4pt', x: 3.2, off: 0.4 },
  { name: 'Joe Greene', pos: 'DL', num: 75, h: 76, w: 275, stance: 'stance_dl_4pt', x: -0.8, off: 0.35 },
  { name: 'Aaron Donald', pos: 'DL', num: 99, h: 73, w: 280, stance: 'stance_dl_4pt', x: 1.1, off: 0.35 },
  { name: 'Lawrence Taylor', pos: 'LB', num: 56, h: 75, w: 237, stance: 'stance_lb_ready', x: -5.4, off: 3.2 },
  { name: 'Mike Singletary', pos: 'LB', num: 50, h: 72, w: 230, stance: 'stance_lb_ready', x: 0, off: 4.8 },
  { name: 'Ray Lewis', pos: 'LB', num: 52, h: 73, w: 250, stance: 'stance_lb_ready', x: 3.2, off: 4.6 },
  { name: 'Deion Sanders', pos: 'CB', num: 21, h: 73, w: 185, stance: 'stance_db_ready', x: -13.5, off: 6 },
  { name: 'Darrelle Revis', pos: 'CB', num: 24, h: 71, w: 198, stance: 'stance_db_ready', x: 12.5, off: 5 },
  { name: 'Ronnie Lott', pos: 'S', num: 42, h: 72, w: 203, stance: 'stance_db_ready', x: -5, off: 12 },
  { name: 'Ed Reed', pos: 'S', num: 20, h: 71, w: 200, stance: 'stance_db_ready', x: 6, off: 11 },
];

/** Line of scrimmage, m along the field (the north 35: 15 yd from midfield). */
const LOS_Z = -15 * YARD;

// How far the helmet shell and fingers extend past the head and hand bones, m
// (tools/blender/lib/gear.py helmet radius; hand length from lib/body.py).
const FRONT = { head: 0.15, hand_l: 0.09, hand_r: 0.09 } as const;
const _p = new THREE.Vector3();

/** Distance from the feet (root) to the player's front along the facing direction, m. */
function reach(player: Player, side: 1 | -1): number {
  player.root.updateMatrixWorld(true);
  let front = 0;
  for (const [bone, pad] of Object.entries(FRONT)) {
    player.bones.get(bone)?.getWorldPosition(_p);
    front = Math.max(front, (_p.z - player.root.position.z) * -side + pad);
  }
  return front;
}

interface Placed {
  player: Player;
  animator: PlayerAnimator;
}

function place(slots: Slot[], kit: Kit, side: 1 | -1, asset: PlayerAsset, lib: AnimLibrary): Placed[] {
  return slots.map((s) => {
    const body = bodyFromImperial(s.h, s.w);
    const player = new Player(asset, {
      kit,
      skin: skinHexFor(s.name),
      number: s.num,
      name: jerseyName(s.name),
      variety: playerVariety(s.pos, body.heightM, body.weightKg, s.name),
      ...body,
    });
    // side +1 lines up on +Z and faces -Z (toward the defense).
    player.root.rotation.y = side > 0 ? Math.PI : 0;
    player.root.position.set(s.x * YARD, 0, 0);
    const animator = new PlayerAnimator(player, lib);
    animator.setStance(s.stance);
    // Start settled in the stance (no crossfade from idle on the first frame).
    animator.update(10, { speed: 0 });
    // Line up by the front of the player, not the feet: a lineman's helmet
    // and hands are up to a meter ahead of them, and the rules put the
    // helmet (not the feet) behind the ball.
    player.root.position.z = LOS_Z + side * (s.off * YARD + reach(player, side));
    player.root.updateMatrixWorld(true);
    animator.reset();
    animator.update(10, { speed: 0 });
    return { player, animator };
  });
}

export function Lineup() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [placed, setPlaced] = useState<Placed[]>([]);

  useEffect(() => {
    let alive = true;
    let group: THREE.Group | null = null;
    Promise.all([loadPlayerAsset(), loadAnimLibrary()]).then(async ([asset, lib]) => {
      if (!alive) return;
      const all = [...place(OFFENSE, KITS.royal!, 1, asset, lib), ...place(DEFENSE, KITS.beasts!, -1, asset, lib)];
      const g = new THREE.Group();
      g.name = 'lineup';
      for (const p of all) g.add(p.player.root);
      await prepareLate(g, gl, camera, scene);
      if (!alive) return;
      group = g;
      scene.add(group);
      shadowAttach.requested = true;
      setPlaced(all);
      (window as unknown as { __btbLineupReady?: boolean }).__btbLineupReady = true;
    }, console.error);
    return () => {
      alive = false;
      if (group) scene.remove(group);
    };
  }, [scene, gl, camera]);

  useFrame(({ camera, gl }, dt) => {
    const viewportPx = gl.domElement.height;
    // Screenshots step a fixed 1/60 s, like the rest of the scene.
    const step = urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    for (const p of placed) {
      p.animator.update(step, { speed: 0 });
      p.player.updateLod(camera, viewportPx);
    }
  });

  return null;
}

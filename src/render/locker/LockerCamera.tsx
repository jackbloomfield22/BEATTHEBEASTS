import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Slot } from '@data/legacy/types';
import { urlFlags } from '@/app/platform';
import { useDraft, type DraftPhase } from '@/app/draftStore';
import { view } from '../view';
import { ARC_R, DOOR, DOOR_ANGLE, LOCKER_OF, ROOM_R, WALL, WALL_ANGLE, onArc } from './layout';
import { TUNNEL_POSE } from './LockerRoom';

// The locker room's camera (M6): a slow, handheld-feeling broadcast camera
// that eases between shots (the row, the video wall, one stall) and, when
// the ninth stall is dressed, pulls back down the row and walks out through
// the tunnel into daylight, where it hands over to the stadium.

interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const SHOTS = {
  /** The row of nine across the frame: from behind the room's center, a band of lit ceiling above and the carpet's mark below. */
  home: { pos: v(0, 1.45, 3.4), look: v(0, 1.35, -8), fov: 36 },
  pullback: { pos: v(0, 1.8, 4.2), look: v(0, 1.35, -8), fov: 56 },
  wall: { pos: onArc(WALL_ANGLE + 0.2, ARC_R - 4.9, 1.62), look: onArc(WALL_ANGLE, ARC_R, WALL.base + WALL.height / 2), fov: 44 },
  /** Choosing: the wall on the left of frame, the row running away to the right (the pick panel sits right). */
  /** Down the tunnel from the room: the field at the far end. */
  door: { pos: onArc(DOOR_ANGLE - 0.02, ROOM_R - 3.6, 1.62), look: onArc(DOOR_ANGLE, ROOM_R + DOOR.depth, 1.4), fov: 46 },
  choose: { pos: onArc(WALL_ANGLE + 0.62, ARC_R - 6.2, 1.7), look: onArc(WALL_ANGLE + 0.36, ARC_R, WALL.base + WALL.height / 2 - 0.1), fov: 52 },
} satisfies Record<string, Pose>;

/**
 * A stall's shot: from ~5 m, low, looking a little up, so the stall sits in
 * the frame with its neighbors, the screens and the ceiling above, and the
 * bench and the carpet below (the room stays in the picture; a tight
 * close-up lost it). The stall sits right of center: the draft's stage
 * button holds the center of the screen, and the hologram stands at left.
 */
export function stallShot(slot: Slot): Pose {
  const l = LOCKER_OF[slot];
  const ol = slot === 'OL';
  return {
    pos: onArc(l.angle - (ol ? 1.2 : 0.8) / ARC_R, ARC_R - (ol ? 6.2 : 5.2), 1.35),
    look: onArc(l.angle - (ol ? 2.4 : 1.7) / ARC_R, ARC_R, 1.75),
    fov: ol ? 57 : 55,
  };
}

function shotFor(phase: DraftPhase, focus: Slot | null, wallBeasts: number | null): { key: string; pose: Pose; dur: number } {
  if (focus && (phase === 'dressing' || phase === 'viewing' || phase === 'ready')) return { key: `stall:${focus}`, pose: stallShot(focus), dur: 0.95 };
  if (phase === 'spinning') return { key: 'wall', pose: SHOTS.wall, dur: 1.1 };
  if (phase === 'choosing') return { key: 'choose', pose: SHOTS.choose, dur: 1.2 };
  if (phase === 'intro' || wallBeasts !== null) return { key: 'wall', pose: SHOTS.wall, dur: 1.6 };
  if (phase === 'complete') return { key: 'pullback', pose: SHOTS.pullback, dur: 2.2 };
  return { key: 'home', pose: SHOTS.home, dur: 1.4 };
}

/** The walk-out: down the row, through the door and along the tunnel to the light. */
function walkoutPath(): { pos: THREE.CatmullRomCurve3; look: THREE.CatmullRomCurve3 } {
  const door = new THREE.Matrix4().compose(onArc(DOOR_ANGLE, ROOM_R), new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), -DOOR_ANGLE), v(1, 1, 1));
  const inDoor = (x: number, y: number, z: number) => v(x, y, z).applyMatrix4(door);
  // Where the tunnel's far opening fills the frame at the stadium camera's fov (TUNNEL_POSE).
  const handoff = DOOR.height / 2 / Math.tan(THREE.MathUtils.degToRad(TUNNEL_POSE.fov / 2));
  const pos = new THREE.CatmullRomCurve3(
    [SHOTS.pullback.pos, onArc(DOOR_ANGLE * 0.55, ARC_R - 4.6, 1.75), onArc(DOOR_ANGLE - 0.05, ROOM_R - 2.6, 1.66), inDoor(0, 1.64, 0.3), inDoor(0, 1.63, -(DOOR.depth - handoff))],
    false,
    'centripetal',
  );
  const far = inDoor(0, DOOR.height / 2, -DOOR.depth);
  const look = new THREE.CatmullRomCurve3([SHOTS.pullback.look, onArc(DOOR_ANGLE * 0.8, ARC_R, 1.3), inDoor(0, 1.5, -2), far, far], false, 'centripetal');
  return { pos, look };
}

/** Screenshot harness: ?roomcam=home|pullback|wall|choose|<slot> holds a shot; ?cam= a fixed pose. */
const FORCED: Pose | null = (() => {
  if (typeof location === 'undefined') return null;
  const c = urlFlags.cam;
  if (c && c.length >= 6) return { pos: v(c[0]!, c[1]!, c[2]!), look: v(c[3]!, c[4]!, c[5]!), fov: c[6] ?? 45 };
  const n = new URLSearchParams(location.search).get('roomcam');
  if (!n) return null;
  if (n in SHOTS) return SHOTS[n as keyof typeof SHOTS];
  if (n in LOCKER_OF) return stallShot(n as Slot);
  return null;
})();

const WALK = { roomS: 6.2, whiteS: 0.7, fieldS: 2.6 };

export function LockerCamera({ fovOffset = 0, onWalkoutDone }: { fovOffset?: number; onWalkoutDone?: () => void }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const cur = useRef<Pose>({ pos: SHOTS.home.pos.clone(), look: SHOTS.home.look.clone(), fov: SHOTS.home.fov });
  const from = useRef<Pose>({ ...cur.current, pos: cur.current.pos.clone(), look: cur.current.look.clone() });
  const target = useRef<{ key: string; pose: Pose; dur: number }>({ key: 'home', pose: SHOTS.home, dur: 0 });
  const blend = useRef(1);
  const time = useRef(0);
  const walk = useRef<{ t: number; handed: boolean } | null>(null);
  const path = useMemo(() => walkoutPath(), []);

  useEffect(() => {
    const pick = () => {
      const st = useDraft.getState();
      if (st.phase === 'walkout') {
        if (!walk.current) walk.current = { t: 0, handed: false };
        return;
      }
      const next = shotFor(st.phase, st.focus, st.wallBeasts);
      if (next.key === target.current.key) return;
      from.current = { pos: cur.current.pos.clone(), look: cur.current.look.clone(), fov: cur.current.fov };
      target.current = next;
      blend.current = urlFlags.shot !== null && !urlFlags.video ? 1 : 0;
    };
    pick();
    blend.current = 1; // the first shot is a cut
    cur.current = { pos: target.current.pose.pos.clone(), look: target.current.pose.look.clone(), fov: target.current.pose.fov };
    return useDraft.subscribe(pick);
  }, []);

  useEffect(
    () => () => {
      view.exposureMul = 1;
      view.fade = 1;
    },
    [],
  );

  useFrame((_, delta) => {
    const dt = urlFlags.video ? 1 / urlFlags.video : urlFlags.shot !== null ? 1 / 60 : Math.min(delta, 0.1);
    time.current += dt;
    const c = cur.current;
    const w = walk.current;
    if (w) {
      w.t += dt;
      const total = WALK.roomS + WALK.whiteS;
      if (w.t < total) {
        // Slow start down the row, walking pace through the tunnel.
        const u = Math.min(1, w.t / total);
        const s = u < 0.35 ? 0.35 * easeInOut(u / 0.35) * 0.8 : 0.28 + 0.72 * ((u - 0.35) / 0.65);
        c.pos.copy(path.pos.getPoint(Math.min(1, s)));
        c.look.copy(path.look.getPoint(Math.min(1, s)));
        c.fov += (TUNNEL_POSE.fov - c.fov) * Math.min(1, dt * 1.5);
        // A walking bob once through the door.
        if (s > 0.62) c.pos.y += 0.018 * Math.sin(time.current * 11);
        const white = Math.max(0, (w.t - WALK.roomS) / WALK.whiteS);
        view.exposureMul = 1 + 7 * white * white;
      } else {
        if (!w.handed) {
          // Into daylight: the stadium takes over at the tunnel mouth.
          w.handed = true;
          view.room = null;
          view.grade = null;
          c.fov = TUNNEL_POSE.fov;
        }
        const f = Math.min(1, (w.t - total) / WALK.fieldS);
        view.exposureMul = 1 + 7 * Math.pow(1 - Math.min(1, f * 1.6), 2);
        c.pos.copy(TUNNEL_POSE.pos).add(v(0, 0.02 * Math.sin(time.current * 11) * (1 - f), 9 * easeInOut(f) * 0.5 + 4.5 * f));
        c.look.copy(TUNNEL_POSE.look);
        if (f >= 1 && onWalkoutDone) {
          walk.current = null;
          view.exposureMul = 1;
          onWalkoutDone();
        }
      }
    } else if (FORCED) {
      c.pos.copy(FORCED.pos);
      c.look.copy(FORCED.look);
      c.fov = FORCED.fov;
    } else {
      const t = target.current;
      blend.current = Math.min(1, blend.current + dt / Math.max(0.01, t.dur));
      const e = easeInOut(blend.current);
      c.pos.lerpVectors(from.current.pos, t.pose.pos, e);
      c.look.lerpVectors(from.current.look, t.pose.look, e);
      c.fov = from.current.fov + (t.pose.fov - from.current.fov) * e;
    }
    // Handheld: a slow, small drift (off in the screenshot harness).
    const still = urlFlags.shot !== null && !urlFlags.video;
    const tt = time.current;
    const dx = still ? 0 : 0.025 * Math.sin(tt * 0.31) + 0.012 * Math.sin(tt * 0.83 + 1);
    const dy = still ? 0 : 0.015 * Math.sin(tt * 0.47 + 2);
    camera.position.set(c.pos.x + dx, c.pos.y + dy, c.pos.z);
    camera.lookAt(c.look);
    const fov = c.fov + fovOffset * 0.5;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

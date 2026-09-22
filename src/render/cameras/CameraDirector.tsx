import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CameraShot } from '@/app/appStore';
import { urlFlags } from '@/app/platform';

// Cinematic cameras for the front end. Each shot is a pose (or a spline for
// the title flyover) plus slow drift; shot changes glide over ~2.4 s with an
// ease-in-out so menus feel like one continuous broadcast.

interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Signature shot: from the north upper deck down the field to the open end, sea and sun. */
const STATIC_SHOTS: Record<Exclude<CameraShot, 'title' | 'intro'>, { base: Pose; drift: THREE.Vector3; driftLook: THREE.Vector3; period: number }> = {
  menu: { base: { pos: v(10, 33, -96), look: v(-6, -6, 90), fov: 42 }, drift: v(6, 1.5, 3), driftLook: v(4, 1, 0), period: 38 },
  daily: { base: { pos: v(-4, 6, -8), look: v(0, 38, -80), fov: 44 }, drift: v(3, 0.8, 2), driftLook: v(1, 1, 0), period: 30 },
  practice: { base: { pos: v(-17, 2.2, 38), look: v(8, 1.2, -30), fov: 40 }, drift: v(2.5, 0.3, 3), driftLook: v(2, 0.3, 0), period: 26 },
  settings: { base: { pos: v(-150, 14, 140), look: v(-900, -30, 1400), fov: 38 }, drift: v(10, 2, 6), driftLook: v(20, 3, 0), period: 44 },
  history: { base: { pos: v(30, 5, 20), look: v(-40, 8, -25), fov: 42 }, drift: v(2, 0.6, 3), driftLook: v(2, 0.5, 0), period: 30 },
  characterization: { base: { pos: v(-28, 3.5, -10), look: v(20, 4, 10), fov: 40 }, drift: v(2, 0.4, 3), driftLook: v(1, 0.4, 0), period: 28 },
};

/** Title flyover: from the sea, along the cliff, around the open end, and back. */
function titleCurves() {
  const pos = new THREE.CatmullRomCurve3(
    [v(-330, -20, 290), v(-200, -4, 250), v(-60, 16, 190), v(30, 38, 150), v(60, 70, 40), v(10, 95, -60), v(-90, 60, 120), v(-140, 30, 330), v(-330, -5, 400)],
    true,
    'centripetal',
  );
  const look = new THREE.CatmullRomCurve3(
    [v(0, 10, 40), v(20, 0, 60), v(0, 5, 20), v(0, 2, -10), v(-10, 0, 20), v(-80, -10, 300), v(-600, -30, 1100), v(-700, -30, 1000), v(0, 15, 60)],
    true,
    'centripetal',
  );
  return { pos, look, duration: 150 };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function CameraDirector({ shot, fovOffset = 0 }: { shot: CameraShot; fovOffset?: number }) {
  const { camera } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const title = useMemo(() => titleCurves(), []);
  const from = useRef<Pose>({ pos: cam.position.clone(), look: new THREE.Vector3(), fov: cam.fov });
  const blend = useRef(1);
  const current = useRef<Pose>({ pos: v(-420, -8, 520), look: v(0, 20, 0), fov: 40 });
  const shotStart = useRef(0);
  const clockRef = useRef(0);

  useEffect(() => {
    from.current = { pos: current.current.pos.clone(), look: current.current.look.clone(), fov: current.current.fov };
    // Screenshot harness: cut straight to the shot instead of gliding.
    blend.current = urlFlags.shot ? 1 : 0;
    shotStart.current = clockRef.current;
  }, [shot]);

  const target = (t: number): Pose => {
    if (shot === 'title' || shot === 'intro') {
      const u = ((t / title.duration) % 1 + 1) % 1;
      return { pos: title.pos.getPoint(u), look: title.look.getPoint(u), fov: 40 };
    }
    const s = STATIC_SHOTS[shot];
    const ph = (t / s.period) * Math.PI * 2;
    return {
      pos: s.base.pos.clone().add(new THREE.Vector3(Math.sin(ph) * s.drift.x, Math.sin(ph * 0.7) * s.drift.y, Math.cos(ph) * s.drift.z)),
      look: s.base.look.clone().add(new THREE.Vector3(Math.sin(ph * 0.8) * s.driftLook.x, Math.sin(ph * 0.5) * s.driftLook.y, 0)),
      fov: s.base.fov,
    };
  };

  useFrame((_, dt) => {
    clockRef.current = urlFlags.shotTime !== null ? urlFlags.shotTime : clockRef.current + Math.min(dt, 0.1);
    const t = clockRef.current;
    const goal = target(t);
    let pose = goal;
    if (blend.current < 1) {
      blend.current = Math.min(1, blend.current + Math.min(dt, 0.05) / 2.4);
      const k = ease(blend.current);
      pose = {
        pos: from.current.pos.clone().lerp(goal.pos, k),
        look: from.current.look.clone().lerp(goal.look, k),
        fov: THREE.MathUtils.lerp(from.current.fov, goal.fov, k),
      };
    }
    current.current = pose;
    cam.position.copy(pose.pos);
    cam.lookAt(pose.look);
    const fov = pose.fov + fovOffset * 0.5;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });

  return null;
}

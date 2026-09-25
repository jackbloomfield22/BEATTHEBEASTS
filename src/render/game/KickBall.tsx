import { useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { urlFlags } from '@/app/platform';
import { worldX, worldY, worldZ } from '@/game/coords';
import { createFootball } from './football';
import { kickView } from './kickView';

/** The kicked ball: on its tee at the spot, then along the computed flight, end over end. */
export function KickBall() {
  const scene = useThree((s) => s.scene);
  const [ball] = useState(createFootball);
  useEffect(() => {
    scene.add(ball);
    return () => void scene.remove(ball);
  }, [scene, ball]);
  useFrame((_, dt) => {
    ball.visible = kickView.active;
    if (!kickView.active) return;
    const step = urlFlags.video ? 1 / urlFlags.video : urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    const p = kickView.path;
    if (!p) {
      // Upright on the tee, laces toward the posts.
      ball.position.set(worldX(0), worldY(0.3), worldZ(kickView.spotX));
      ball.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.2);
      return;
    }
    kickView.t += step;
    const f = Math.min(p.length - 1, kickView.t * 30);
    const i = Math.floor(f);
    const a = p[i]!;
    const b = p[Math.min(p.length - 1, i + 1)]!;
    const u = f - i;
    const x = a[0] + (b[0] - a[0]) * u;
    const y = a[1] + (b[1] - a[1]) * u;
    const z = a[2] + (b[2] - a[2]) * u;
    ball.position.set(worldX(y), worldY(Math.max(0.15, z + 0.15)), worldZ(kickView.spotX + x));
    // End over end, ~9 rev/s off a placekick.
    ball.rotation.set(-kickView.t * Math.PI * 2 * 9, Math.PI / 2, 0);
  });
  return null;
}

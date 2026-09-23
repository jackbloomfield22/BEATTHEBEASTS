import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Free flythrough camera for looking around the world (dev flag ?fly).
// WASD / arrows move, Q/E down/up, drag to look, Shift ×4, wheel = speed.
// P prints the pose as a ?cam= string for the screenshot harness.

export function FlyCamera() {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: 0, pitch: 0, dragging: false, x: 0, y: 0 });
  const speed = useRef(20); // m/s

  useEffect(() => {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    look.current.yaw = e.y;
    look.current.pitch = e.x;
    const el = gl.domElement;
    const down = (ev: KeyboardEvent) => {
      keys.current.add(ev.code);
      if (ev.code === 'KeyP') {
        const d = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(50).add(camera.position);
        const f = (v: number) => v.toFixed(1);
        console.info(`cam=${[camera.position.x, camera.position.y, camera.position.z, d.x, d.y, d.z].map(f).join(',')},${(camera as THREE.PerspectiveCamera).fov}`);
      }
    };
    const up = (ev: KeyboardEvent) => keys.current.delete(ev.code);
    const md = (ev: PointerEvent) => Object.assign(look.current, { dragging: true, x: ev.clientX, y: ev.clientY });
    const mu = () => (look.current.dragging = false);
    const mm = (ev: PointerEvent) => {
      const l = look.current;
      if (!l.dragging) return;
      l.yaw -= (ev.clientX - l.x) * 0.004;
      l.pitch = THREE.MathUtils.clamp(l.pitch - (ev.clientY - l.y) * 0.004, -1.5, 1.5);
      l.x = ev.clientX;
      l.y = ev.clientY;
    };
    const wheel = (ev: WheelEvent) => (speed.current = THREE.MathUtils.clamp(speed.current * (ev.deltaY < 0 ? 1.25 : 0.8), 1, 400));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    el.addEventListener('pointerdown', md);
    window.addEventListener('pointerup', mu);
    window.addEventListener('pointermove', mm);
    el.addEventListener('wheel', wheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      el.removeEventListener('pointerdown', md);
      window.removeEventListener('pointerup', mu);
      window.removeEventListener('pointermove', mm);
      el.removeEventListener('wheel', wheel);
    };
  }, [camera, gl]);

  useFrame((_, dt) => {
    const k = keys.current;
    const l = look.current;
    camera.quaternion.setFromEuler(new THREE.Euler(l.pitch, l.yaw, 0, 'YXZ'));
    const v = new THREE.Vector3(
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0),
      (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0),
    );
    if (v.lengthSq() === 0) return;
    v.normalize().applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(v, speed.current * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1) * Math.min(dt, 0.1));
  });
  return null;
}

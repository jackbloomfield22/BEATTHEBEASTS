import { useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { urlFlags } from '@/app/platform';
import { worldX, worldY, worldZ } from '@/game/coords';
import { CROSSBAR } from '@/game/kick';
import { kickView } from './kickView';
import { YARD } from '../world/constants';

// The kick's aim on the field (M6.6, Playtest 2): while you line it up, a
// dashed lime line runs from the ball along your aim, to the posts on a
// field goal (with a ring hanging in the goal mouth where the line meets
// them) or ~45 yd downfield on a punt (a landing ring), and pale blue
// chevrons drift across the turf the way the wind blows, one to three by
// its strength. The line is where you aim, not where the ball will go: the
// wind is yours to read. Unlit and drawn over the grass like the line of
// scrimmage (fieldMarks.ts). Gone at the strike.

const LIME = 0xaaff00;
const WIND = 0x7fc4ec;
/** A punt's line: about where a good punt comes down. */
const PUNT_LINE = 45;

/** A dashed strip's texture: 1.2 yd of paint, 0.8 yd of gap. */
function dashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 20;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 4, 12);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

const flat = (color: number, opacity: number, map?: THREE.Texture) =>
  new THREE.MeshBasicMaterial({ color, map: map ?? null, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, side: THREE.DoubleSide });

/** A chevron pointing along local −Z (downfield when the group isn't turned), yd scaled. */
function chevronGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.55);
  s.lineTo(-0.6, -0.05);
  s.lineTo(-0.6, -0.4);
  s.lineTo(0, 0.2);
  s.lineTo(0.6, -0.4);
  s.lineTo(0.6, -0.05);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.scale(YARD, YARD, 1);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

interface Aim {
  group: THREE.Group;
  line: THREE.Mesh;
  lineTex: THREE.Texture;
  ring: THREE.Mesh;
  land: THREE.Mesh;
  wind: THREE.Group;
  chevrons: THREE.Mesh[];
}

function createAim(): Aim {
  const group = new THREE.Group();
  group.name = 'kick-aim';
  const lineTex = dashTexture();
  // A unit-long strip along local −Z from the ball, scaled to the kick's length each frame.
  const lineGeo = new THREE.PlaneGeometry(0.3 * YARD, 1);
  lineGeo.rotateX(-Math.PI / 2);
  lineGeo.translate(0, 0, -0.5);
  const line = new THREE.Mesh(lineGeo, flat(LIME, 0.9, lineTex));
  line.renderOrder = 3;
  line.position.y = 0.07;
  // The goal-mouth ring (a field goal) and the landing ring (a punt).
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62 * YARD, 0.8 * YARD, 40), flat(LIME, 0.95));
  ring.renderOrder = 3;
  const land = new THREE.Mesh(new THREE.RingGeometry(1.6 * YARD, 2 * YARD, 48).rotateX(-Math.PI / 2), flat(LIME, 0.85));
  land.renderOrder = 3;
  land.position.y = 0.08;
  const wind = new THREE.Group();
  const chevGeo = chevronGeometry();
  const chevrons = [0, 1, 2].map(() => {
    const c = new THREE.Mesh(chevGeo, flat(WIND, 0.85));
    c.renderOrder = 3;
    wind.add(c);
    return c;
  });
  wind.position.y = 0.09;
  group.add(line, ring, land, wind);
  group.visible = false;
  return { group, line, lineTex, ring, land, wind, chevrons };
}

export function KickAim() {
  const scene = useThree((s) => s.scene);
  const [aim] = useState(createAim);
  useEffect(() => {
    scene.add(aim.group);
    return () => void scene.remove(aim.group);
  }, [scene, aim]);

  useFrame(({ clock }) => {
    const on = kickView.active && kickView.aiming;
    aim.group.visible = on;
    if (!on) return;
    const sx = kickView.spotX;
    const a = kickView.aim;
    const punt = kickView.kind === 'PUNT';
    const len = punt ? PUNT_LINE : kickView.distance;
    // The line: from the ball, turned by the aim (+ = left, which is a turn toward world −X about +Y).
    aim.line.position.set(worldX(0), 0.07, worldZ(sx));
    aim.line.rotation.y = a;
    const lenM = (len / Math.cos(a)) * YARD;
    aim.line.scale.set(1, 1, lenM);
    aim.lineTex.repeat.set(1, lenM / (2 * YARD));
    // A slow crawl toward the target so the line reads as "that way".
    aim.lineTex.offset.y = urlFlags.shot !== null ? 0 : -(clock.elapsedTime * 0.8) % 1;
    const lat = Math.tan(a) * len;
    aim.ring.visible = !punt;
    aim.land.visible = punt;
    if (!punt) {
      // In the goal mouth, a couple of yards over the bar: where a good kick passes.
      aim.ring.position.set(worldX(lat), worldY(CROSSBAR + 2), worldZ(sx + len));
    } else aim.land.position.set(worldX(lat), 0.08, worldZ(sx + len));
    // The wind: chevrons drifting downwind over the far half of the line, by its strength.
    const w = kickView.wind;
    const n = w.mph <= 4 ? 1 : w.mph <= 8 ? 2 : 3;
    aim.wind.visible = w.mph > 0;
    aim.wind.position.set(worldX(lat * 0.65), 0.09, worldZ(sx + len * 0.65));
    aim.wind.rotation.y = w.dir;
    const drift = urlFlags.shot !== null ? 0.5 : (clock.elapsedTime * (0.25 + w.mph * 0.05)) % 1;
    aim.chevrons.forEach((c, i) => {
      c.visible = i < n;
      // Spaced 1.6 yd along the wind, gliding one space per cycle, fading in and out at the ends.
      const u = (i + drift) / n;
      c.position.set(0, 0, -(u - 0.5) * 1.6 * n * YARD);
      (c.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.sin(Math.PI * u);
    });
  });
  return null;
}

import { useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { SKIN_TONES } from '@data/legacy';
import { KITS } from '@/render/players/kits';
import { loadPlayerAsset, Player, type PlayerAsset } from '@/render/players/playerAsset';
import { bodyFromImperial } from '@/render/players/bodyShape';
import './anim.css';

// Animation Lab (TECH_PLAN §9.3), #/dev/anim. M4 first cut: the geared
// player at every body type, kit and skin tone, with LOD switching. Clip
// playback, scrubbing, onion skin, side-by-side compare and foot-contact
// readouts arrive with the clips.
//
// Hash query: kit, skin (0..4), lod (auto|0|1|2), cam=x,y,z,tx,ty,tz.

/** Roster extremes to middle (height in, weight lb). */
const LINEUP: { label: string; h: number; w: number }[] = [
  { label: 'CB 5\'10" 185', h: 70, w: 185 },
  { label: 'WR 6\'1" 200', h: 73, w: 200 },
  { label: 'QB 6\'3" 225', h: 75, w: 225 },
  { label: 'LB 6\'3" 245', h: 75, w: 245 },
  { label: 'TE 6\'5" 260', h: 77, w: 260 },
  { label: 'OT 6\'6" 320', h: 78, w: 320 },
  { label: 'DT 6\'3" 335', h: 75, w: 335 },
];

function params(): URLSearchParams {
  const q = location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q);
}

function Lineup({ asset, kit, skin, lod }: { asset: PlayerAsset; kit: string; skin: number; lod: string }) {
  const players = useMemo(
    () =>
      LINEUP.map((b, i) => {
        const p = new Player(asset, { kit: KITS[kit]!, skin: SKIN_TONES[skin]!.hex, ...bodyFromImperial(b.h, b.w) });
        p.root.position.set((i - (LINEUP.length - 1) / 2) * 1.1, 0, 0);
        return p;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset],
  );
  useEffect(() => {
    for (const p of players) p.setLook({ kit: KITS[kit]!, skin: SKIN_TONES[skin]!.hex });
  }, [players, kit, skin]);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    for (const p of players) {
      if (lod === 'auto') p.updateLod(camera.position);
      else p.setLod(Number(lod));
    }
  });
  return (
    <group>
      {players.map((p, i) => (
        <primitive key={i} object={p.root} />
      ))}
    </group>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <>
      <hemisphereLight args={[0xbfd4ff, 0x3a3228, 0.9]} />
      <directionalLight position={[4, 8, 6]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={4} shadow-camera-bottom={-1} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#2f4a2a" roughness={0.95} />
      </mesh>
      {children}
    </>
  );
}

export function AnimLab() {
  const q = params();
  const [asset, setAsset] = useState<PlayerAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kit, setKit] = useState(q.get('kit') ?? 'beasts');
  const [skin, setSkin] = useState(Number(q.get('skin') ?? 2));
  const [lod, setLod] = useState(q.get('lod') ?? 'auto');
  const cam = (q.get('cam') ?? '0,1.6,7.5,0,1.05,0').split(',').map(Number);

  useEffect(() => {
    loadPlayerAsset().then(setAsset, (e: unknown) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (asset) (window as unknown as { __labReady?: boolean }).__labReady = true;
  }, [asset]);

  return (
    <div className="lab">
      <aside className="lab-panel">
        <h1>Animation Lab</h1>
        <label>
          Kit
          <select value={kit} onChange={(e) => setKit(e.target.value)}>
            {Object.values(KITS).map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Skin tone
          <select value={skin} onChange={(e) => setSkin(Number(e.target.value))}>
            {SKIN_TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          LOD
          <select value={lod} onChange={(e) => setLod(e.target.value)}>
            <option value="auto">Auto (distance)</option>
            <option value="0">High</option>
            <option value="1">Medium</option>
            <option value="2">Low</option>
          </select>
        </label>
        <p className="lab-note">Lineup, left to right: {LINEUP.map((b) => b.label).join(' · ')}.</p>
        {error ? <p className="lab-error">{error}</p> : null}
      </aside>
      <div className="lab-view">
        <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ fov: 35, position: [cam[0]!, cam[1]!, cam[2]!] }} onCreated={({ gl }) => (gl.toneMapping = THREE.ACESFilmicToneMapping)}>
          <color attach="background" args={['#9aa3ad']} />
          <Stage>{asset ? <Lineup asset={asset} kit={kit} skin={skin} lod={lod} /> : null}</Stage>
          <OrbitControls target={[cam[3]!, cam[4]!, cam[5]!]} makeDefault />
        </Canvas>
      </div>
    </div>
  );
}

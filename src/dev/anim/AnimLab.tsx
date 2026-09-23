import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { SKIN_TONES } from '@data/legacy';
import { KITS } from '@/render/players/kits';
import { loadPlayerAsset, Player, type PlayerAsset } from '@/render/players/playerAsset';
import { bodyFromImperial } from '@/render/players/bodyShape';
import { loadAnimLibrary, planted, type AnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import './anim.css';

// Animation Lab (TECH_PLAN §9.3), #/dev/anim.
//   Lineup: one clip on every roster body type (tall/short, lean/heavy).
//   Single: one player; any clip raw, or "blend" (locomotion driven by a
//   speed through the runtime animator: stride matching + foot lock).
// The floor is a treadmill: it scrolls at the clip's ground speed, so a
// planted foot visibly sticks to the grid (or slides). Contact markers turn
// green on planted frames.
//
// Hash query: mode=lineup|single, clip, speed, t (freeze at time, s), rate
// (playback rate), lock=0|1, kit, skin, lod, cam=x,y,z,tx,ty,tz.

const LINEUP: { label: string; h: number; w: number }[] = [
  { label: 'CB 5\'10" 185', h: 70, w: 185 },
  { label: 'WR 6\'1" 200', h: 73, w: 200 },
  { label: 'QB 6\'3" 225', h: 75, w: 225 },
  { label: 'LB 6\'3" 245', h: 75, w: 245 },
  { label: 'TE 6\'5" 260', h: 77, w: 260 },
  { label: 'OT 6\'6" 320', h: 78, w: 320 },
  { label: 'DT 6\'3" 335', h: 75, w: 335 },
];

const params = () => new URLSearchParams(location.hash.split('?')[1] ?? '');

interface LabState {
  mode: 'lineup' | 'single';
  clip: string; // clip name or 'blend'
  speed: number;
  rate: number;
  paused: boolean;
  lock: boolean;
  kit: string;
  skin: number;
  lod: string;
  freezeT: number | null;
}

interface Readout {
  phase: number;
  time: number;
  planted: { l: boolean; r: boolean };
  correction: { l: number; r: number };
}

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f4a2a';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#8fbf7a';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#4f7446';
  g.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, 256);
    g.moveTo(0, i * 64);
    g.lineTo(256, i * 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 40); // 1 m squares on a 40 m floor
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ground speed and direction (character frame: +z forward) for a clip. */
function travel(lib: AnimLibrary, s: LabState): { speed: number; dir: [number, number] } {
  if (s.clip === 'blend') return { speed: s.speed, dir: [0, 1] };
  const m = lib.meta[s.clip];
  return m ? { speed: m.speed, dir: m.dir } : { speed: 0, dir: [0, 1] };
}

function Scene({ asset, lib, s, onReadout }: { asset: PlayerAsset; lib: AnimLibrary; s: LabState; onReadout: (r: Readout) => void }) {
  const camera = useThree((st) => st.camera);
  const bodies = s.mode === 'lineup' ? LINEUP : [LINEUP[2]!];
  const players = useMemo(
    () =>
      bodies.map((b, i) => {
        const p = new Player(asset, { kit: KITS[s.kit]!, skin: SKIN_TONES[s.skin]!.hex, ...bodyFromImperial(b.h, b.w) });
        p.root.position.set((i - (bodies.length - 1) / 2) * 1.2, 0, 0);
        return p;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset, s.mode],
  );
  const animators = useMemo(() => players.map((p) => new PlayerAnimator(p, lib)), [players, lib]);
  const raw = useMemo(
    () =>
      players.map((p) => {
        const mixer = new THREE.AnimationMixer(p.root);
        return mixer;
      }),
    [players],
  );
  useEffect(() => {
    for (const p of players) p.setLook({ kit: KITS[s.kit]!, skin: SKIN_TONES[s.skin]!.hex });
  }, [players, s.kit, s.skin]);

  // Raw clip playback (everything except "blend").
  useEffect(() => {
    raw.forEach((m) => m.stopAllAction());
    if (s.clip === 'blend') return;
    const clip = lib.clips.get(s.clip);
    if (!clip) return;
    raw.forEach((m) => m.clipAction(clip).reset().play());
  }, [raw, lib, s.clip]);

  const floor = useMemo(() => gridTexture(), []);
  const markers = useRef<THREE.Mesh[]>([]);
  const clock = useRef(0);
  const ground = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dtReal) => {
    const dt = s.paused || s.freezeT !== null ? 0 : Math.min(dtReal, 0.05) * s.rate;
    clock.current = s.freezeT ?? clock.current + dt;
    const { speed, dir } = travel(lib, s);
    // Treadmill: the floor moves backward under the runner.
    // (the floor's +v axis is world -Z; one texture tile is 1 m).
    floor.offset.set(dir[0] * speed * clock.current, -dir[1] * speed * clock.current);
    ground.set(-dir[0] * speed, 0, -dir[1] * speed);
    let readout: Readout | null = null;
    players.forEach((p, i) => {
      if (s.clip === 'blend') {
        const an = animators[i]!;
        an.footLock = s.lock;
        an.setStance('stance_idle');
        if (s.freezeT !== null) {
          // Deterministic: re-run from a clean start to the frozen time.
          an.reset();
          const steps = Math.round(s.freezeT * 60);
          for (let k = 0; k < steps; k++) an.update(1 / 60, { speed, groundVelocity: ground });
          an.update(0, { speed, groundVelocity: ground });
        } else {
          an.update(dt, { speed, groundVelocity: ground });
        }
        if (i === 0) readout = { phase: an.phase, time: clock.current, planted: { l: false, r: false }, correction: { ...an.correction } };
      } else {
        const m = raw[i]!;
        if (s.freezeT !== null) m.setTime(s.freezeT);
        else m.update(dt);
        const meta = lib.meta[s.clip];
        if (i === 0 && meta) {
          const ph = ((clock.current / meta.duration) % 1 + 1) % 1;
          readout = { phase: ph, time: clock.current, planted: { l: planted(meta, 'l', ph), r: planted(meta, 'r', ph) }, correction: { l: 0, r: 0 } };
        }
      }
      if (s.lod === 'auto') p.updateLod(camera.position);
      else p.setLod(Number(s.lod));
    });
    // Contact markers on the first player's feet.
    const p0 = players[0]!;
    (['l', 'r'] as const).forEach((f, k) => {
      const m = markers.current[k];
      const b = p0.bones.get(`foot_${f}`);
      if (!m || !b) return;
      b.getWorldPosition(m.position);
      m.position.y = 0.01;
      const on = readout?.planted[f] ?? false;
      (m.material as THREE.MeshBasicMaterial).color.set(on ? '#3bff6a' : '#ff5a4a');
    });
    if (readout) onReadout(readout);
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial map={floor} roughness={0.95} />
      </mesh>
      {players.map((p, i) => (
        <primitive key={i} object={p.root} />
      ))}
      {[0, 1].map((k) => (
        <mesh key={k} ref={(m) => void (m && (markers.current[k] = m))} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.05, 16]} />
          <meshBasicMaterial color="#ff5a4a" />
        </mesh>
      ))}
    </group>
  );
}

export function AnimLab() {
  const q = params();
  const [asset, setAsset] = useState<PlayerAsset | null>(null);
  const [lib, setLib] = useState<AnimLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<LabState>({
    mode: (q.get('mode') as LabState['mode']) ?? 'single',
    clip: q.get('clip') ?? 'blend',
    speed: Number(q.get('speed') ?? 3.5),
    rate: Number(q.get('rate') ?? 1),
    paused: false,
    lock: q.get('lock') !== '0',
    kit: q.get('kit') ?? 'beasts',
    skin: Number(q.get('skin') ?? 2),
    lod: q.get('lod') ?? '0',
    freezeT: q.has('t') ? Number(q.get('t')) : null,
  });
  const [readout, setReadout] = useState<Readout | null>(null);
  const cam = (q.get('cam') ?? '3.6,1.3,0.4,0,0.95,0').split(',').map(Number);
  const set = (patch: Partial<LabState>) => setS((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    Promise.all([loadPlayerAsset(), loadAnimLibrary()]).then(
      ([a, l]) => {
        setAsset(a);
        setLib(l);
      },
      (e: unknown) => setError(String(e)),
    );
  }, []);
  useEffect(() => {
    if (asset && lib) (window as unknown as { __labReady?: boolean }).__labReady = true;
  }, [asset, lib]);

  const clipNames = lib ? [...lib.clips.keys()].sort() : [];
  const meta = lib && s.clip !== 'blend' ? lib.meta[s.clip] : null;
  const gates = meta ? (meta as unknown as { gates?: Record<string, unknown> }).gates : null;

  return (
    <div className="lab">
      <aside className="lab-panel">
        <h1>Animation Lab</h1>
        <label>
          View
          <select value={s.mode} onChange={(e) => set({ mode: e.target.value as LabState['mode'] })}>
            <option value="single">Single player</option>
            <option value="lineup">Lineup (every body type)</option>
          </select>
        </label>
        <label>
          Motion
          <select value={s.clip} onChange={(e) => set({ clip: e.target.value })}>
            <option value="blend">Locomotion blend (speed)</option>
            {clipNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {s.clip === 'blend' ? (
          <label>
            Speed {s.speed.toFixed(1)} m/s
            <input type="range" min={0} max={9.5} step={0.1} value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })} />
          </label>
        ) : null}
        <label>
          Playback {s.rate}×
          <input type="range" min={0.1} max={1} step={0.05} value={s.rate} onChange={(e) => set({ rate: Number(e.target.value) })} />
        </label>
        <div className="lab-row">
          <button onClick={() => set({ paused: !s.paused })}>{s.paused ? 'Play' : 'Pause'}</button>
          <label className="lab-check">
            <input type="checkbox" checked={s.lock} onChange={(e) => set({ lock: e.target.checked })} /> Foot lock
          </label>
        </div>
        <label>
          Kit
          <select value={s.kit} onChange={(e) => set({ kit: e.target.value })}>
            {Object.values(KITS).map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Skin tone
          <select value={s.skin} onChange={(e) => set({ skin: Number(e.target.value) })}>
            {SKIN_TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          LOD
          <select value={s.lod} onChange={(e) => set({ lod: e.target.value })}>
            <option value="auto">Auto (distance)</option>
            <option value="0">High</option>
            <option value="1">Medium</option>
            <option value="2">Low</option>
          </select>
        </label>
        {readout ? (
          <dl className="lab-readout">
            <dt>Phase</dt>
            <dd>{readout.phase.toFixed(3)}</dd>
            <dt>Planted</dt>
            <dd>
              L {readout.planted.l ? '●' : '○'} R {readout.planted.r ? '●' : '○'}
            </dd>
            {s.clip === 'blend' ? (
              <>
                <dt>Foot-lock fix</dt>
                <dd>
                  L {(readout.correction.l * 100).toFixed(1)} cm · R {(readout.correction.r * 100).toFixed(1)} cm
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {gates ? <p className="lab-note">Gates: {JSON.stringify(gates)}</p> : null}
        {error ? <p className="lab-error">{error}</p> : null}
      </aside>
      <div className="lab-view">
        <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ fov: 35, position: [cam[0]!, cam[1]!, cam[2]!] }} onCreated={({ gl }) => (gl.toneMapping = THREE.ACESFilmicToneMapping)}>
          <color attach="background" args={['#9aa3ad']} />
          <hemisphereLight args={[0xbfd4ff, 0x3a3228, 0.9]} />
          <directionalLight position={[4, 8, 6]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={4} shadow-camera-bottom={-1} />
          {asset && lib ? <Scene key={s.mode} asset={asset} lib={lib} s={s} onReadout={setReadout} /> : null}
          <OrbitControls target={[cam[3]!, cam[4]!, cam[5]!]} makeDefault />
        </Canvas>
      </div>
    </div>
  );
}

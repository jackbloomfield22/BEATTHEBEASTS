import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { SKIN_TONES } from '@data/legacy';
import { KITS, OFFICIAL_KIT, REFEREE_KIT, type Kit } from '@/render/players/kits';
import { loadPlayerAsset, Player, type PlayerAsset } from '@/render/players/playerAsset';
import { bodyFromImperial } from '@/render/players/bodyShape';
import { loadAnimLibrary, planted, travelAt, type AnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { playerVariety, type Position, type Variety } from '@/render/players/variety';
import { SEQUENCE_STANCES, SequenceDirector, sequenceSteps, type SequenceStance } from './sequence';
import './anim.css';

// Animation Lab (TECH_PLAN §9.3), #/dev/anim.
//   Lineup: one clip on every roster body type (tall/short, lean/heavy).
//   Single: one player; any clip raw, or "blend" (locomotion driven by a
//   speed through the runtime animator: stride matching + foot lock).
//   Compare: two clips side by side (clip, clip2), in step.
//   Onion: the clip with ghosts a few frames either side of now.
//   Sheet: a contact sheet, eight evenly spaced moments of one cycle in a
//   row (Playwright captures these: tools/shots/contact.spec.ts).
//   Sequence: a play's worth of movement through the runtime animator,
//   transitions and all (sequence.ts), for one position.
// The floor is a treadmill: it scrolls at the clip's ground speed, so a
// planted foot visibly sticks to the grid (or slides). Contact markers turn
// green on planted frames.
//
// Hash query: mode=lineup|single|compare|onion|sheet|sequence, pos (sequence stance), clip, speed, t (freeze at time, s), rate
// (playback rate), lock=0|1, kit, skin, lod, num, name, seed, clip2, yaw, look=1,
// carry=space|traffic|drive|press (blend: the ball carrier's gaits, M6.5 #11),
// dip=l|r (blend: the dip before contact), cam=x,y,z,tx,ty,tz.

// Numbers and names exercise the lettering: one and two digits, short,
// long (squeezed) and accented names.
const LINEUP: { label: string; pos: Position; h: number; w: number; num: number; name: string }[] = [
  { label: 'CB 5\'10" 185', pos: 'CB', h: 70, w: 185, num: 2, name: 'Lott' },
  { label: 'WR 6\'1" 200', pos: 'WR', h: 73, w: 200, num: 81, name: 'Houshmandzadeh' },
  { label: 'QB 6\'3" 225', pos: 'QB', h: 75, w: 225, num: 16, name: 'Montana' },
  { label: 'LB 6\'3" 245', pos: 'LB', h: 75, w: 245, num: 52, name: 'St. Brown' },
  { label: 'TE 6\'5" 260', pos: 'TE', h: 77, w: 260, num: 87, name: 'Gronkowski' },
  { label: 'OT 6\'6" 320', pos: 'OL', h: 78, w: 320, num: 75, name: 'Muñoz' },
  { label: 'DT 6\'3" 335', pos: 'DL', h: 75, w: 335, num: 90, name: 'White' },
];

/** Blend mode's overlay: first played this far in (s), then again after its length plus a gap. */
const OVL_START = 0.6;
const OVL_GAP = 0.6;

const params = () => new URLSearchParams(location.hash.split('?')[1] ?? '');

interface LabState {
  mode: 'lineup' | 'single' | 'compare' | 'onion' | 'sheet' | 'sequence';
  /** Sequence mode's position (its stance). */
  pos: SequenceStance;
  clip: string; // clip name or 'blend'
  clip2: string; // compare mode's second clip
  speed: number;
  rate: number;
  paused: boolean;
  lock: boolean;
  kit: string;
  skin: number;
  lod: string;
  freezeT: number | null;
  /** Blend mode: turn rate (rad/s, + = left) for the lean, and head tracking of the camera. */
  yaw: number;
  look: boolean;
  /** Blend mode: an overlay clip laid over the gait, replayed (a catch at speed). */
  ovl: string;
  /** Blend mode: the ball carrier's gaits (M6.5 #11), and the dip before contact. */
  carry: '' | 'space' | 'traffic' | 'drive' | 'press';
  dip: '' | 'l' | 'r';
  /** Re-rolls every player's gear and proportions (variety.ts). */
  seed: string;
  /** Single mode's jersey number and name (lineup players carry their own). */
  num: number;
  name: string;
}

interface Readout {
  phase: number;
  time: number;
  planted: { l: boolean; r: boolean };
  correction: { l: number; r: number };
  step?: string;
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

// The officials (M6) dress the official variant of the asset: kit=official or kit=referee.
const OFFICIAL_KITS: Record<string, Kit> = { official: OFFICIAL_KIT, referee: REFEREE_KIT };
const kitOf = (s: LabState): Kit => KITS[s.kit] ?? OFFICIAL_KITS[s.kit] ?? KITS.beasts!;
const officialOf = (s: LabState): boolean => s.kit in OFFICIAL_KITS;

/** The look for one Lab player: officials carry no number, name or gear variety. */
function lookOf(s: LabState, b: (typeof LINEUP)[number]) {
  const base = { kit: kitOf(s), skin: SKIN_TONES[s.skin]!.hex };
  return officialOf(s) ? base : { ...base, ...lettering(s, b) };
}

function lettering(s: LabState, b: (typeof LINEUP)[number]): { number: number; name: string; variety: Variety } {
  const { heightM, weightKg } = bodyFromImperial(b.h, b.w);
  const who = s.mode === 'lineup' ? { number: b.num, name: b.name } : { number: s.num, name: s.name };
  return { ...who, variety: playerVariety(b.pos, heightM, weightKg, `${who.name}${s.seed}`) };
}

/** One figure on the lab floor. */
interface Actor {
  body: (typeof LINEUP)[number];
  x: number;
  /** Along the travel direction (the sheet lays its frames out this way, for a side view). */
  z?: number;
  /** Which of the lab's clips it plays (compare mode's second figure plays clip2). */
  second?: boolean;
  /** Time offset from the lab clock, s (onion ghosts), or share of the cycle (sheet). */
  offset: number;
  offsetIsPhase?: boolean;
  /** Ghost opacity (onion skin); undefined for a solid figure. */
  ghost?: number;
}

const SHEET_FRAMES = 8;
const ONION_STEP = 0.1; // s between ghosts
const ONION_GHOSTS = 2; // each side

/** The lineup body that plays a sequence stance. */
function bodyFor(pos: SequenceStance): (typeof LINEUP)[number] {
  const want: Position = pos.startsWith('ol') ? 'OL' : pos.startsWith('dl') ? 'DL' : pos.startsWith('wr') ? 'WR' : pos.startsWith('lb') ? 'LB' : pos.startsWith('db') ? 'CB' : pos.startsWith('rb') ? 'CB' : 'QB';
  return LINEUP.find((b) => b.pos === want) ?? LINEUP[2]!;
}

function actorsFor(mode: LabState['mode'], pos: SequenceStance): Actor[] {
  const qb = LINEUP[2]!;
  switch (mode) {
    case 'sequence':
      return [{ body: bodyFor(pos), x: 0, offset: 0 }];
    case 'lineup':
      return LINEUP.map((body, i) => ({ body, x: (i - (LINEUP.length - 1) / 2) * 1.2, offset: 0 }));
    case 'compare':
      return [
        { body: qb, x: 0.75, offset: 0 },
        { body: qb, x: -0.75, offset: 0, second: true },
      ];
    case 'onion': {
      const ghosts: Actor[] = [];
      for (let k = -ONION_GHOSTS; k <= ONION_GHOSTS; k++) {
        if (k !== 0) ghosts.push({ body: qb, x: 0, offset: k * ONION_STEP, ghost: 0.22 });
      }
      return [{ body: qb, x: 0, offset: 0 }, ...ghosts];
    }
    case 'sheet':
      return Array.from({ length: SHEET_FRAMES }, (_, k) => ({ body: qb, x: 0, z: (k - (SHEET_FRAMES - 1) / 2) * 1.1, offset: k / SHEET_FRAMES, offsetIsPhase: true }));
    default:
      return [{ body: qb, x: 0, offset: 0 }];
  }
}

/** The clip a figure plays; the runtime blend only runs in single and lineup views. */
function clipOf(s: LabState, a: Actor): string {
  const c = a.second ? s.clip2 : s.clip;
  return c === 'blend' && (s.mode === 'single' || s.mode === 'lineup') ? 'blend' : c === 'blend' ? 'loco_run' : c;
}

/** Ground speed and direction (character frame: +z forward) for a clip. */
function travel(lib: AnimLibrary, s: LabState): { speed: number; dir: [number, number] } {
  if (s.clip === 'blend') return { speed: s.speed, dir: [0, 1] };
  const m = lib.meta[s.clip];
  return m ? { speed: m.speed, dir: m.dir } : { speed: 0, dir: [0, 1] };
}

function Scene({ asset, lib, s, onReadout }: { asset: PlayerAsset; lib: AnimLibrary; s: LabState; onReadout: (r: Readout) => void }) {
  const camera = useThree((st) => st.camera);
  const gl = useThree((st) => st.gl);
  const actors = useMemo(() => actorsFor(s.mode, s.pos), [s.mode, s.pos]);
  const official = officialOf(s);
  const bodies = actors.map((a) => a.body);
  const players = useMemo(
    () =>
      actors.map((a) => {
        const p = new Player(asset, { ...lookOf(s, a.body), ...bodyFromImperial(a.body.h, a.body.w), variant: officialOf(s) ? 'official' : 'player' });
        p.root.position.set(a.x, 0, a.z ?? 0);
        if (a.ghost !== undefined) {
          p.material.transparent = true;
          p.material.opacity = a.ghost;
          p.material.depthWrite = false;
          p.root.traverse((o) => (o.castShadow = false));
        }
        return p;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset, s.mode, s.pos, official],
  );
  const animators = useMemo(() => players.map((p) => new PlayerAnimator(p, lib)), [players, lib]);
  // Dev console access: __labAnimators[0].player.bones.get(...)
  (window as unknown as { __labAnimators?: PlayerAnimator[] }).__labAnimators = animators;
  const raw = useMemo(
    () =>
      players.map((p) => {
        const mixer = new THREE.AnimationMixer(p.root);
        return mixer;
      }),
    [players],
  );
  useEffect(() => {
    players.forEach((p, i) => p.setLook(lookOf(s, bodies[i]!)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, s.kit, s.skin, s.num, s.name, s.seed]);

  // Raw clip playback (everything except "blend").
  useEffect(() => {
    raw.forEach((m, i) => {
      m.stopAllAction();
      const clip = lib.clips.get(clipOf(s, actors[i]!));
      if (clip) m.clipAction(clip).reset().play();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, lib, actors, s.clip, s.clip2]);

  const director = useMemo(() => new SequenceDirector(sequenceSteps(s.pos, (c) => lib.clips.has(c))), [s.pos, lib]);
  const walked = useRef(0);
  const ovlClock = useRef(0);
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
    const tm = s.clip !== 'blend' ? lib.meta[s.clip] : undefined;
    const dist = tm?.travel ? travelAt(tm, lib.fps, clock.current % tm.duration) : speed * clock.current;
    floor.offset.set(dir[0] * dist, -dir[1] * dist);
    ground.set(-dir[0] * speed, 0, -dir[1] * speed);
    let readout: Readout | null = null;
    players.forEach((p, i) => {
      const actor = actors[i]!;
      const clipName = clipOf(s, actor);
      if (s.mode === 'sequence') {
        const an = animators[i]!;
        an.footLock = s.lock;
        // Treadmill at the body's speed: the loops' ground speed, or the
        // active transition's root motion.
        const tick = (h: number) => {
          const speed = director.step(an, h);
          const v = an.busy && !an.waiting ? an.transitionSpeed() : speed;
          ground.set(0, 0, -v);
          an.update(h, { speed, groundVelocity: ground, lookAt: s.look ? camera.position : null });
          walked.current += v * h;
        };
        if (s.freezeT !== null) {
          // Deterministic: replay the chain from the start at 60 Hz.
          an.reset();
          director.reset();
          walked.current = 0;
          const steps = Math.round(s.freezeT * 60);
          for (let k = 0; k < steps; k++) tick(1 / 60);
        } else if (dt > 0) tick(dt);
        floor.offset.set(0, -walked.current);
        readout = { phase: an.phase, time: clock.current, planted: { l: false, r: false }, correction: { ...an.correction }, step: director.label };
      } else if (clipName === 'blend') {
        const an = animators[i]!;
        const c = s.carry;
        const input = {
          speed,
          groundVelocity: ground,
          yawRate: s.yaw,
          lookAt: s.look ? camera.position : null,
          carry: c ? 1 : 0,
          traffic: c === 'traffic' ? 1 : c === 'press' ? 0.5 : 0,
          drive: c === 'drive' ? 1 : 0,
          press: c === 'press' ? 1 : 0,
          dip: s.dip === 'l' ? 1 : s.dip === 'r' ? -1 : 0,
        };
        an.footLock = s.lock;
        an.setStance('stance_idle');
        // A carrier has the ball tucked (as the game lays it over the right arm).
        an.setHold(c ? 'ovl_carry_r' : null);
        // An upper-body overlay over the gait (a catch at speed), replayed
        // every so often: first at OVL_START, then once per its length + a gap.
        const ovl = s.ovl && lib.meta[s.ovl]?.kind === 'overlay' ? s.ovl : null;
        const period = ovl ? lib.meta[ovl]!.duration + OVL_GAP : 0;
        const due = (t: number) => (t < OVL_START ? -1 : Math.floor((t - OVL_START) / period));
        const step = (t0: number, h: number) => {
          if (ovl && due(t0 + h) !== due(t0)) an.playOverlay(ovl);
          an.update(h, input);
        };
        if (s.freezeT !== null) {
          // Deterministic: re-run from a clean start to the frozen time.
          an.reset();
          const steps = Math.round(s.freezeT * 60);
          for (let k = 0; k < steps; k++) step(k / 60, 1 / 60);
          an.update(0, input);
        } else {
          step(ovlClock.current, dt);
          ovlClock.current += dt;
        }
        if (i === 0) readout = { phase: an.phase, time: clock.current, planted: { l: false, r: false }, correction: { ...an.correction } };
      } else {
        const m = raw[i]!;
        const meta = lib.meta[clipName];
        const offset = actor.offsetIsPhase ? actor.offset * (meta?.duration ?? 1) : actor.offset;
        m.setTime(Math.max(0, clock.current + offset));
        if (i === 0 && meta) {
          const ph = ((clock.current / meta.duration) % 1 + 1) % 1;
          readout = { phase: ph, time: clock.current, planted: { l: planted(meta, 'l', ph), r: planted(meta, 'r', ph) }, correction: { l: 0, r: 0 } };
        }
      }
      if (s.lod === 'auto') p.updateLod(camera, gl.domElement.height);
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
    pos: (q.get('pos') as SequenceStance) ?? 'ol_3pt',
    clip: q.get('clip') ?? 'blend',
    clip2: q.get('clip2') ?? 'loco_jog',
    speed: Number(q.get('speed') ?? 3.5),
    rate: Number(q.get('rate') ?? 1),
    paused: false,
    lock: q.get('lock') !== '0',
    kit: q.get('kit') ?? 'beasts',
    skin: Number(q.get('skin') ?? 2),
    lod: q.get('lod') ?? '0',
    freezeT: q.has('t') ? Number(q.get('t')) : null,
    yaw: Number(q.get('yaw') ?? 0),
    look: q.get('look') === '1',
    ovl: q.get('ovl') ?? '',
    carry: (q.get('carry') as LabState['carry']) ?? '',
    dip: (q.get('dip') as LabState['dip']) ?? '',
    seed: q.get('seed') ?? '',
    num: Number(q.get('num') ?? 16),
    name: q.get('name') ?? 'Montana',
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
            <option value="compare">Compare two clips</option>
            <option value="onion">Onion skin</option>
            <option value="sheet">Contact sheet</option>
            <option value="sequence">Sequence (huddle to stop)</option>
          </select>
        </label>
        {s.mode === 'sequence' ? (
          <label>
            Position
            <select value={s.pos} onChange={(e) => set({ pos: e.target.value as SequenceStance })}>
              {SEQUENCE_STANCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
        {s.mode === 'compare' ? (
          <label>
            Compare with
            <select value={s.clip2} onChange={(e) => set({ clip2: e.target.value })}>
              {clipNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {s.clip === 'blend' ? (
          <label>
            Speed {s.speed.toFixed(1)} m/s
            <input type="range" min={0} max={9.5} step={0.1} value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })} />
          </label>
        ) : null}
        {s.clip === 'blend' ? (
          <>
            <label>
              Turn rate {s.yaw.toFixed(1)} rad/s (lean)
              <input type="range" min={-2} max={2} step={0.1} value={s.yaw} onChange={(e) => set({ yaw: Number(e.target.value) })} />
            </label>
            <label className="lab-check">
              <input type="checkbox" checked={s.look} onChange={(e) => set({ look: e.target.checked })} /> Look at the camera
            </label>
            <label>
              Ball carrier
              <select value={s.carry} onChange={(e) => set({ carry: e.target.value as LabState['carry'] })}>
                <option value="">No (receiver's gaits)</option>
                <option value="space">In space</option>
                <option value="traffic">In traffic</option>
                <option value="drive">Burst (drive)</option>
                <option value="press">Pressing the hole</option>
              </select>
            </label>
            <label>
              Dip before contact
              <select value={s.dip} onChange={(e) => set({ dip: e.target.value as LabState['dip'] })}>
                <option value="">None</option>
                <option value="l">Tackler on his left</option>
                <option value="r">Tackler on his right</option>
              </select>
            </label>
            <label>
              Overlay (replayed)
              <select value={s.ovl} onChange={(e) => set({ ovl: e.target.value })}>
                <option value="">None</option>
                {clipNames
                  .filter((n) => lib?.meta[n]?.kind === 'overlay')
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            </label>
          </>
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
            {[...Object.values(KITS), ...Object.values(OFFICIAL_KITS)].map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {s.mode === 'single' ? (
          <div className="lab-row">
            <label>
              Number
              <input type="number" min={0} max={99} value={s.num} onChange={(e) => set({ num: Number(e.target.value) })} />
            </label>
            <label>
              Name
              <input value={s.name} maxLength={20} onChange={(e) => set({ name: e.target.value })} />
            </label>
          </div>
        ) : null}
        <label>
          Variety seed
          <input value={s.seed} maxLength={12} onChange={(e) => set({ seed: e.target.value })} />
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
            {readout.step ? (
              <>
                <dt>Step</dt>
                <dd>{readout.step}</dd>
              </>
            ) : null}
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
          <directionalLight position={[4, 8, 6]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={4} shadow-camera-bottom={-1} />
          {asset && lib ? <Scene key={`${s.mode}-${s.pos}`} asset={asset} lib={lib} s={s} onReadout={setReadout} /> : null}
          <OrbitControls target={[cam[3]!, cam[4]!, cam[5]!]} makeDefault />
        </Canvas>
      </div>
    </div>
  );
}

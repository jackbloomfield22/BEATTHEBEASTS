import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PLAYERS } from '@data/legacy/players';
import { DECADES } from '@data/legacy/constants';
import type { Slot } from '@data/legacy/types';
import { traitInfo } from '@/engine/ratings/traits';
import { threatTier } from '@/engine';
import { loadAnimLibrary } from '@/anim/library';
import { urlFlags } from '@/app/platform';
import { useDraft } from '@/app/draftStore';
import type { DraftPick } from '@/game/draft';
import { jerseyName } from '../players/glyphs';
import { loadPlayerAsset } from '../players/playerAsset';
import type { LightingPreset } from '../lighting/presets';
import { view } from '../view';
import { DOOR, frontOf, LOCKER_OF, ARC_R } from './layout';
import { updateLockerLights } from './lockerLights';
import { POS_OF_SLOT, type LockerOccupant } from './locker';
import { Hologram, type SigPos } from './hologram';
import { MOODS, Room, type RoomMood } from './room';
import { whenFontReady } from './textures';
import type { WallBeast } from './videoWall';

// The locker room in the one canvas (M6). The room is its own THREE.Scene;
// while the draft screen is up the composer draws it instead of the stadium
// (render/view.ts), with the room's own grade. The stadium stays built, so
// the walk-out lands in it without a load.

/** The live room (for the camera and the dev handles). */
export const lockerRoom: { room: Room | null; mood: RoomMood; holoAt: THREE.Vector3 | null } = { room: null, mood: 'pregame', holoAt: null };

/** Seconds from a pick until its locker starts dressing (the camera's move there). */
export const DRESS_DELAY = 0.85;

const TEAMS = [...new Set(PLAYERS.map((p) => p.t))].sort();

export function moodFor(preset: LightingPreset): RoomMood {
  const flag = new URLSearchParams(location.search).get('room');
  if (flag === 'pregame' || flag === 'lightsdown') return flag;
  return preset.moon ? 'lightsdown' : 'pregame';
}

export function occupantOf(p: DraftPick, allPro: Record<string, number>): LockerOccupant {
  const men = p.linemen ? p.linemen.map((l) => ({ name: l.name, jerseyName: jerseyName(l.name), num: l.num })) : [{ name: p.name, jerseyName: jerseyName(p.name), num: p.num }];
  const ap = p.linemen ? p.linemen.reduce((s, l) => s + (allPro[l.id] ?? 0), 0) : (allPro[p.id] ?? 0);
  const traits = p.traits
    .map((t) => traitInfo(t.id))
    .filter((t) => t && t.polarity !== 'negative')
    .slice(0, 2)
    .map((t) => t!.label);
  return { men, stickers: { tag: { team: p.team, decade: p.decade }, traits, allPro: ap, pos: POS_OF_SLOT[p.slot], posColor: '' } };
}

export function LockerRoom({ active, mainScene, preset }: { active: boolean; mainScene: THREE.Scene; preset: LightingPreset }) {
  const gl = useThree((s) => s.gl);
  const room = useMemo(() => new Room(), []);
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl]);
  const holo = useRef<Hologram | null>(null);
  const pending = useRef<{ slot: Slot; pick: DraftPick; at: number } | null>(null);
  const clock = useRef(0);
  const dressed = useRef<Partial<Record<Slot, string | null>>>({});
  const handledSeq = useRef(0);
  const handledInstant = useRef(-1);
  const wallKey = useRef('');
  const rt = useMemo(() => new THREE.WebGLRenderTarget(512, 640, { type: THREE.HalfFloatType }), []);
  const captured = useRef(-1);
  const mood = moodFor(preset);

  useEffect(() => {
    lockerRoom.room = room;
    room.fieldView.map = rt.texture;
    room.fieldView.needsUpdate = true;
    whenFontReady().then(() => {
      for (const l of room.lockers) l.redraw();
      room.wall.redraw();
    });
    if (import.meta.env.DEV) Object.assign(window, { __btbRoom: room });
    let cancelled = false;
    Promise.all([loadPlayerAsset(), loadAnimLibrary()]).then(([asset, lib]) => {
      if (cancelled) return;
      holo.current = new Hologram(asset, lib);
      room.scene.add(holo.current.root);
    });
    return () => {
      cancelled = true;
    };
  }, [room, rt]);

  useEffect(() => {
    room.applyMood(mood, pmrem);
    lockerRoom.mood = mood;
    captured.current = -1;
  }, [room, mood, pmrem]);

  // Compile the room's programs off the frame once, so the first view of it doesn't stall.
  useEffect(() => {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    gl.compileAsync(room.scene, cam).catch(() => undefined);
  }, [gl, room]);

  useEffect(() => {
    view.room = active ? room.scene : null;
    const m = MOODS[mood];
    view.grade = active ? { grade: m.grade, exposure: m.exposure, bloom: m.bloom, threshold: m.threshold } : null;
    if (active) captured.current = -1;
  }, [active, room, mood]);
  useEffect(
    () => () => {
      view.room = null;
      view.grade = null;
    },
    [],
  );

  const sync = () => {
    const st = useDraft.getState();
    const d = st.draft;
    const instant = st.instantSeq !== handledInstant.current;
    handledInstant.current = st.instantSeq;
    const fresh = st.lastPick && st.lastPick.seq !== handledSeq.current ? st.lastPick : null;
    if (fresh) handledSeq.current = fresh.seq;
    for (const l of room.lockers) {
      const slot = l.place.slot;
      const p = d?.roster[slot] ?? null;
      const key = p ? p.id : null;
      if (key === (dressed.current[slot] ?? null) && !instant) continue;
      if (key === (dressed.current[slot] ?? null) && instant && p && l.occupant) continue;
      dressed.current[slot] = key;
      if (!p) l.clear();
      else if (fresh && fresh.pick.slot === slot && !instant) pending.current = { slot, pick: p, at: clock.current + DRESS_DELAY };
      else l.dress(occupantOf(p, st.allPro), true);
    }
    syncWall();
  };

  const syncWall = () => {
    const st = useDraft.getState();
    const d = st.draft;
    const round = d ? Math.min(9, Object.keys(d.roster).length + (st.phase === 'dressing' ? 0 : 1)) : 0;
    const film = st.mode === 'film';
    if (st.wallBeasts !== null && st.beasts) {
      const key = `beasts|${st.wallBeasts}|${film}`;
      if (key === wallKey.current) return;
      wallKey.current = key;
      const r = st.beasts.rating;
      // Tiers are on legacy's scale; the OVR-fed rating maps onto it as legacy ≈ 1.518·new − 53.01 (src/game/daily.ts).
      const tier = threatTier(Math.round(1.518 * r.rating - 53.01));
      const beasts: WallBeast[] = st.beasts.beasts.map((b) => ({ pos: b.p, name: b.n, team: b.t, decade: b.d, ovr: b.imp }));
      room.wall.set({ kind: 'beasts', beasts, page: st.wallBeasts, showOvr: !film, rating: film ? null : r.rating, tier });
      return;
    }
    if ((st.phase === 'spinning' || st.phase === 'choosing') && d?.pair) {
      const key = `slot|${d.sequence.length}|${d.pair.t}|${d.pair.d}|${d.teamSkipUsed}|${d.eraSkipUsed}`;
      if (key === wallKey.current) return;
      wallKey.current = key;
      const decades = DECADES.filter((x) => x !== '1970s' || !Object.values(d.roster).some((p) => p?.decade === '1970s') || d.pair!.d === '1970s');
      room.wall.set({ kind: 'slot', teams: TEAMS, decades: [...decades], final: d.pair, startedAt: room.wall.now, duration: st.phase === 'choosing' && urlFlags.shot ? 0 : 2.4, round });
      if (st.phase === 'choosing' && urlFlags.shot) room.wall.now += 3;
      return;
    }
    if (st.phase === 'dressing' && st.lastPick) {
      const p = st.lastPick.pick;
      const key = `pick|${st.lastPick.seq}|${film}`;
      if (key === wallKey.current) return;
      wallKey.current = key;
      room.wall.set({ kind: 'pick', name: p.name, pos: POS_OF_SLOT[p.slot], num: p.linemen ? p.linemen.length : p.num, team: p.team, decade: p.decade, ovr: film ? null : p.ovr, round: p.round + 1 });
      return;
    }
    const done = d ? Object.keys(d.roster).length === 9 : false;
    const key = `idle|${round}|${done}|${st.phase}`;
    if (key === wallKey.current) return;
    wallKey.current = key;
    room.wall.set({ kind: 'idle', round: done ? 0 : round, title: done ? 'Contenders' : st.phase === 'loading' ? 'Loading' : 'The Draft', sub: done ? 'The roster is set' : d ? `Round ${round} of 9` : '' });
  };

  useEffect(() => {
    sync();
    return useDraft.subscribe(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useFrame(({ camera }, delta) => {
    if (!active) return;
    const dt = urlFlags.video ? 1 / urlFlags.video : urlFlags.shot !== null ? 1 / 60 : Math.min(delta, 0.1);
    clock.current += dt;
    // A pick's dressing starts once the camera has arrived.
    const pd = pending.current;
    if (pd && clock.current >= pd.at) {
      pending.current = null;
      const st = useDraft.getState();
      const l = room.lockers.find((x) => x.place.slot === pd.slot)!;
      l.dress(occupantOf(pd.pick, st.allPro));
      const h = holo.current;
      const cat = st.cat;
      if (h && cat) {
        const id = pd.pick.linemen ? [...pd.pick.linemen].sort((a, b) => b.ovr - a.ovr)[0]!.id : pd.pick.id;
        const e = cat.entry.get(id);
        const lp = LOCKER_OF[pd.slot];
        // Stands on a projector in front of the stall, to the left of the camera's line.
        const at = frontOf({ angle: lp.angle - 0.95 / ARC_R }, 1.55, 0);
        h.root.position.copy(at);
        h.root.rotation.y = Math.atan2(-at.x, -at.z) + 0.35;
        lockerRoom.holoAt = at;
        const man = pd.pick.linemen ? pd.pick.linemen.find((x) => x.id === id)! : pd.pick;
        h.play({ name: man.name, pos: POS_OF_SLOT[pd.slot] as SigPos, num: man.num, heightIn: e?.heightIn ?? 74, weightLb: e?.weightLb ?? 220 }, l.posColor);
      }
    }
    for (const l of room.lockers) l.update(dt);
    holo.current?.update(dt);
    room.wall.update(dt);
    updateLockerLights(camera);
    // The field down the tunnel: a still of the stadium from the tunnel
    // mouth under the north stands, rendered a couple of frames after entry.
    if (captured.current < 0) captured.current = 0;
    else if (captured.current < 3 && ++captured.current === 3) captureField(gl, mainScene, rt, preset.exposure / MOODS[mood].exposure, room);
  });

  return null;
}

/** The stadium seen from the Contenders' tunnel mouth (north end, facing the field). */
export const TUNNEL_POSE = { pos: new THREE.Vector3(0, 1.72, -69.2), look: new THREE.Vector3(0, 1.3, 0), fov: 50 };

function captureField(gl: THREE.WebGLRenderer, scene: THREE.Scene, rt: THREE.WebGLRenderTarget, gain: number, room: Room): void {
  const cam = new THREE.PerspectiveCamera(TUNNEL_POSE.fov, DOOR.width / DOOR.height, 0.3, 16000);
  cam.position.copy(TUNNEL_POSE.pos);
  cam.lookAt(TUNNEL_POSE.look);
  cam.updateMatrixWorld();
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.render(scene, cam);
  gl.setRenderTarget(prev);
  room.fieldView.color.setScalar(gain);
}

// Passing round 12 (docs/passing/PASSING12.md): the contested ball's post-up against the broadcast camera, in Node on
// the game's own code (the sim, src/render/game/broadcastCam.ts stepped at 60 fps, choreo.ts catchClip). For the last
// second before the ball: where the man he boxes out is against the camera's line to the receiver (0° = straight beyond
// him, 180° = between him and the camera, ±90° = side by side, the bar in profile), which side the box clip puts the
// bar on, and on which side of him on screen the man is.
//   node tools/run-ts.mjs tools/sim/p12_box.ts [--ids=p9-contested]
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING9, withSwap, type Clip } from '../../src/game/clips.ts';
import { capture, emptySnapshot } from '../../src/game/snapshot.ts';
import { BroadcastCam, poseToWorld, Spring } from '../../src/render/game/broadcastCam.ts';
import { catchClip } from '../../src/render/game/choreo.ts';
import { contactAt } from '../../src/sim/catchstyle.ts';
import { worldX, worldZ } from '../../src/game/coords.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const ids = process.argv.find((a) => a.startsWith('--ids='))?.slice(6).split(',') ?? ['p9-contested'];
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

for (const c of PASSING9.filter((x: Clip) => ids.includes(x.id))) {
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s: PlayState = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  const cur = capture(s, emptySnapshot(s.agents.length));
  const bc = new BroadcastCam();
  let springs: Spring[] | null = null;
  for (let k = 0; k < 1500 && !s.result; k++) {
    bc.stepBreakaway(s, cur, 0, 1 / 60, false);
    const t = poseToWorld(bc.pose(s, cur));
    springs ??= t.map((x) => new Spring(x));
    const w = bc.weights(s, cur);
    const p = springs.map((sp, i) => sp.step(t[i]!, w[i]!, 1 / 60));
    bc.camNow.eye.set(p[0]!, p[1]!, p[2]!);
    bc.camNow.aspect = 16 / 9;
    bc.camNow.ok = true;
    const T = s.ball.arrive - s.t;
    if (s.phase === 'air' && T <= 1.0 && k % 3 === 0 && s.ball.target >= 0) {
      const a = s.agents[s.ball.target]!;
      const d = contactAt(s, a);
      if (d) {
        // World (x right, z toward the camera): the camera, the receiver, the man.
        const cx = p[0]!, cz = p[2]!;
        const rx = worldX(a.pos.y), rz = worldZ(a.pos.x);
        const dx = worldX(d.pos.y), dz = worldZ(d.pos.x);
        const view = Math.atan2(rx - cx, -(rz - cz));
        const pair = Math.atan2(dx - rx, -(dz - rz));
        const rel = deg(wrap(pair - view));
        // The man's bearing off the receiver's facing (sim frame), and the clip.
        const bearing = deg(wrap(Math.atan2(d.pos.y - a.pos.y, d.pos.x - a.pos.x) - a.face));
        const clip = catchClip(s, a.i, 'contested');
        console.log(`${c.id} T-${T.toFixed(2)} s: man at ${rel.toFixed(0)}° off the camera's line (${rel > 0 ? 'right' : 'left'} of him on screen), ${Math.hypot(d.pos.x - a.pos.x, d.pos.y - a.pos.y).toFixed(2)} yd, ${bearing.toFixed(0)}° off his facing; clip ${clip}; eye ${(p[1]!).toFixed(1)} m up, ${Math.hypot(rx - cx, rz - cz).toFixed(1)} m back`);
      }
    }
    stepPlay(s, c.script(s));
    capture(s, cur);
  }
}

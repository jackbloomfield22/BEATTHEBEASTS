// A real game record for the results and box-score screenshots (M6.6).
// Plays a whole six-round game in Node through the same pieces the game
// screen uses: the Beasts' possessions (match.ts), every snap run through the
// sim with the AI at the controls (the coordinator's first suggestion, the
// Beasts' defensive call, the depth chart's backfield rotation), the box
// score (stats.ts), fourth downs, tries and kicks, then buildRecord. Writes
// tools/shots/fixtures/record.json; m66.spec.ts puts it in History before the
// page loads.
//
//   node tools/run-ts.mjs tools/shots/record-fixture.ts [seed]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { callDefense, createPlay, defenseFor, emptyTendencies, input, offenseFor, playById, practiceRosters, runToWhistle, suggestPlays, type SnapshotLike } from '@/sim';
import { deriveStream } from '@/engine/rng';
import { applyBeastsDrive, applyKick, applyPlay, beastsPossession, chooseFourth, chooseTry, createMatch, fgDistance, fgMakePct, KICKER_RANGE } from '@/game/match';
import { buildRecord, type RecordMeta } from '@/game/record';
import { describe } from '@/game/describe';
import { squadFor } from '@/game/rotation';
import { emptyGameBox, pickPlayOfGame, tallySnap, type PlayLog } from '@/game/stats';

const ROOT = new URL('../..', import.meta.url).pathname;
const seed = Number(process.argv[2] ?? 11);
const snap = JSON.parse(readFileSync(`${ROOT}data/ratings/ratings.v1.json`, 'utf8')) as SnapshotLike;
const R = practiceRosters(snap);
const team = R.team;
const m = createMatch({ drives: 6, seed, beastsRating: 93, diffAdj: 0, kickerRange: KICKER_RANGE.pro });
const box = emptyGameBox(team.QB.name);
const dc = deriveStream(seed, 'beasts-dc');
const plays: PlayLog[] = [];
let n = 0;
for (let guard = 0; m.phase !== 'final' && guard < 400; guard++) {
  if (m.phase === 'meanwhile') {
    applyBeastsDrive(m, beastsPossession(m));
    continue;
  }
  if (m.phase === 'fourth') {
    const d = fgDistance(m.sit.los);
    chooseFourth(m, m.sit.toGo <= 2 && m.sit.los >= 45 ? 'go' : fgMakePct(m, d) > 0.5 ? 'fg' : 'punt');
    continue;
  }
  if (m.phase === 'try') {
    chooseTry(m, false);
    continue;
  }
  if (m.phase === 'kick') {
    applyKick(m, fgMakePct(m, m.kick!.distance) >= 0.5);
    continue;
  }
  const sit = m.sit;
  const id = suggestPlays({ down: sit.down, toGo: sit.toGo, los: sit.los, scoreDiff: m.score.user - m.score.beasts }, team)[n % 3]!;
  const play = playById(id);
  const def = callDefense({ down: sit.down, toGo: sit.toGo, los: sit.los, scoreDiff: m.score.user - m.score.beasts }, 'pro', emptyTendencies(), dc);
  const squad = squadFor(team, play, sit, (m.drive?.plays ?? 0) + 1);
  const s = createPlay({ seed: seed * 7919 + n++, offense: offenseFor(play, squad), defense: defenseFor(def, R.beasts), play, def, los: sit.los, ballY: sit.ballY, toGo: sit.toGo, down: sit.down, user: false });
  runToWhistle(s, () => input({}));
  const r = s.result!;
  const before = { ...sit };
  const at = { drive: m.userDrives.length, n: (m.drive?.plays ?? 0) + 1, round: m.round, ot: m.ot, score: { ...m.score } };
  tallySnap(box, s, r, before, team.QB.name, { round: m.round, ot: m.ot });
  const out = applyPlay(m, r, s.carrier >= 0 ? s.agents[s.carrier]!.pos.y : s.ball.pos.y, Math.max(0, s.whistleT - s.snapT));
  if (out.kind === 'firstDown' || (out.kind === 'touchdown' && r.offenseBall)) box.firstDowns++;
  const card = describe(s);
  plays.push({ ...at, down: before.down, toGo: before.toGo, los: before.los, playId: id, playName: play.name, headline: card.headline, detail: card.detail, yards: r.offenseBall ? r.spot - before.los : 0, touchdown: r.touchdown && r.offenseBall, turnover: !r.offenseBall, pickSix: r.touchdown && !r.offenseBall, late: at.ot > 0 || at.round >= 6 });
}
const person = (slot: string, p: { id: string; name: string; num: number; pos: string }) => ({ slot, id: p.id, name: p.name, num: p.num, pos: p.pos });
const b = R.beasts.base;
const meta: RecordMeta = {
  id: `fixture-${seed}`,
  finishedAt: Date.UTC(2026, 8, 27, 19, 42),
  mode: 'classic',
  dailyKey: null,
  difficulty: 'pro',
  end: 'final',
  offense: [person('QB', team.QB), person('RB', team.RB), person('RB2', team.RB2), person('WR1', team.WR1), person('WR2', team.WR2), person('WR3', team.WR3), person('TE', team.TE), person('TE2', team.TE2), ...(['LT', 'LG', 'C', 'RG', 'RT'] as const).map((k, i) => person(k, team.OL[i]!))],
  beasts: (['LE', 'LDT', 'RDT', 'RE', 'WLB', 'MLB', 'SLB', 'LCB', 'FS', 'SS', 'RCB'] as const).map((k) => person(k, b[k])),
  matchups: [],
  perfect: null,
};
const idx = pickPlayOfGame(plays);
const rec = buildRecord(m, box, meta, plays, idx >= 0 ? { index: idx, capsule: null } : null);
mkdirSync(`${ROOT}tools/shots/fixtures`, { recursive: true });
writeFileSync(`${ROOT}tools/shots/fixtures/record.json`, JSON.stringify(rec));
console.log(`fixture: ${rec.score.user}–${rec.score.beasts} ${rec.clock}, ${box.plays} snaps, grade ${rec.grade?.grade}`);

// Animation round 18 (docs/anim/BREAK18.md): the pop meter's logs (tools/shots/video.spec.ts BTB_MEASURE, one
// <play>.pops.json per play) of two trees side by side, as rounds 15-17's tables: the steps by unit, the planted spans
// drifting over 2 cm, the one-frame jumps over 5 and 2 cm, the largest drift, the pop meter, the cost per body, the
// back seven's steps by what they were playing, and every break played (animator.ts breakClip).
//   node tools/run-ts.mjs tools/sim/b18_measure.ts <before dir> <after dir> [play,...]
import { readFileSync, existsSync } from 'node:fs';

type Slide = { spans: number; over2cm: number; jumps: number; jumps5: number; max: number; steps: number };
type Pops = { worst: number; p99: number; spikes: { bone: string; slot: string }[]; slide: Record<string, Slide>; cost?: { msPerBody: number }; stepLog?: (string | number)[][]; breaks?: (string | number)[][] };
const [bDir, aDir, list] = process.argv.slice(2);
const plays = (list ?? 'p9-slant,p9-go,cut-run,p9-screen,p9-contested,sack,p9-curl,tackle-hurdle').split(',');
const units = ['qb', 'ol', 'dl', 'lb', 'db', 'wr', 'rb'];
const load = (d: string, p: string): Pops | null => (existsSync(`${d}/${p}.pops.json`) ? (JSON.parse(readFileSync(`${d}/${p}.pops.json`, 'utf8')) as Pops) : null);
const B = plays.map((p) => load(bDir!, p));
const A = plays.map((p) => load(aDir!, p));
const row = (name: string, f: (x: Pops) => number | string, total?: (xs: (number | string)[]) => string) => {
  const cells = plays.map((_, k) => (B[k] && A[k] ? `${f(B[k]!)} → **${f(A[k]!)}**` : '–'));
  const tb = B.filter(Boolean).map((x) => f(x!));
  const ta = A.filter(Boolean).map((x) => f(x!));
  const tot = total ? `${total(tb)} → **${total(ta)}**` : '';
  console.log(`| ${name} | ${cells.join(' | ')} |${total ? ` ${tot} |` : ''}`);
};
const sum = (xs: (number | string)[]) => String(xs.reduce<number>((s, x) => s + Number(x), 0));
const header = (t: string, tot = true) => {
  console.log(`\n#### ${t}\n\n| Unit | ${plays.join(' | ')} |${tot ? ' All |' : ''}\n|${'---|'.repeat(plays.length + (tot ? 2 : 1))}`);
};
header('Steps taken by feet that could not stay planted (before → after)');
for (const u of units) row(u.toUpperCase(), (x) => x.slide[u]?.steps ?? 0, sum);
row('**All units**', (x) => units.reduce((s, u) => s + (x.slide[u]?.steps ?? 0), 0), sum);
header('Planted spans drifting over 2 cm (before → after)');
for (const u of units) row(u.toUpperCase(), (x) => `${x.slide[u]?.over2cm ?? 0}/${x.slide[u]?.spans ?? 0}`);
header('One-frame jumps of a planted foot over 5 cm / over 2 cm (before → after)');
for (const u of units) row(u.toUpperCase(), (x) => `${x.slide[u]?.jumps5 ?? 0}/${x.slide[u]?.jumps ?? 0}`);
header('The largest drift of a planted span (m)', false);
for (const u of units) row(u.toUpperCase(), (x) => (x.slide[u]?.max ?? 0).toFixed(3));
header('The pop meter', false);
row('Worst (rad/s)', (x) => x.worst);
row('p99 (rad/s)', (x) => x.p99);
row('Spikes', (x) => x.spikes.length);
row('Leg spikes', (x) => x.spikes.filter((s) => /thigh|calf/.test(s.bone)).length);
row('Back-seven spikes', (x) => x.spikes.filter((s) => /LB|CB|^S$|FS|SS/.test(s.slot)).length);
row('Cost (ms/body)', (x) => x.cost?.msPerBody.toFixed(3) ?? '–');
// The back seven's steps by what they played.
const why = (x: Pops | null) => {
  const m = new Map<string, number>();
  for (const s of x?.stepLog ?? []) {
    if (!/LB|CB|^S$|FS|SS/.test(String(s[1]))) continue;
    const k = `${String(s[3]).split(':')[0]}:${s[4]}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};
console.log('\n#### The back seven\'s steps by what was playing (all plays, before → after)\n');
const wb = new Map<string, number>();
const wa = new Map<string, number>();
for (let k = 0; k < plays.length; k++) {
  for (const [kk, v] of why(B[k] ?? null)) wb.set(kk, (wb.get(kk) ?? 0) + v);
  for (const [kk, v] of why(A[k] ?? null)) wa.set(kk, (wa.get(kk) ?? 0) + v);
}
for (const k of [...new Set([...wb.keys(), ...wa.keys()])].sort((x, y) => (wa.get(y) ?? 0) + (wb.get(y) ?? 0) - (wa.get(x) ?? 0) - (wb.get(x) ?? 0))) console.log(`- ${k}: ${wb.get(k) ?? 0} → ${wa.get(k) ?? 0}`);
console.log('\n#### The breaks played (after)\n');
plays.forEach((p, k) => {
  const br = A[k]?.breaks ?? [];
  if (br.length) console.log(`- ${p}: ${br.map((b) => `f${b[0]} ${b[1]} ${b[2]} ${b[3]} ${b.slice(4).join(' ')}`).join('; ')}`);
});

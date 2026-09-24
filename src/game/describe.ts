// The result card's words for a finished play, from its result and events.

import type { PlayState } from '@/sim';
import { spotLabel } from './situation';

export interface ResultCard {
  headline: string;
  detail: string;
  /** Tone for the banner: good for the offense, bad, or neutral. */
  tone: 'good' | 'bad' | 'neutral';
  yards: number;
}

const last = (name: string): string => name.split(' ').slice(-1)[0] ?? name;
const yds = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))} yd${Math.abs(Math.round(n)) === 1 ? '' : 's'}`;

export function describe(s: PlayState): ResultCard {
  const r = s.result!;
  const who = (i: number | undefined) => (i !== undefined && i >= 0 ? s.agents[i]!.p.name : '');
  const ev = (type: string) => [...s.events].reverse().find((e) => e.type === type);
  const tackler = () => {
    const t = ev('tackle') ?? ev('sack');
    return t ? last(who(t.who?.[0])) : '';
  };
  const y = r.yards;
  if (!r.offenseBall) {
    const pick = ev('interception');
    const rec = ev('recovery');
    const by = pick ? who(pick.who?.[0]) : rec ? who(rec.who?.[0]) : '';
    return {
      headline: pick ? `Intercepted by ${by}` : `Fumble, recovered by ${by}`,
      detail: r.touchdown ? 'Returned for a touchdown.' : r.reason === 'touchback' ? 'Out the back of the end zone: a touchback.' : `Down at the ${spotLabel(r.spot)}.`,
      tone: 'bad',
      yards: 0,
    };
  }
  if (r.touchdown) {
    const c = s.carrier >= 0 ? who(s.carrier) : '';
    const caught = ev('catch');
    return { headline: 'Touchdown', detail: caught ? `${c}, ${Math.round(100 - s.setup.los)} yards out, from ${last(who(s.qb))}.` : `${c} takes it in.`, tone: 'good', yards: y };
  }
  if (r.reason === 'safety') return { headline: 'Safety', detail: 'Tackled in the end zone.', tone: 'bad', yards: y };
  if (r.sack) return { headline: `Sacked ${yds(y)}`, detail: tackler() ? `${tackler()} gets home.` : 'Brought down in the backfield.', tone: 'bad', yards: y };
  if (r.reason === 'incomplete') {
    const drop = ev('drop');
    const defl = ev('deflection');
    const thr = ev('throw');
    const tgt = thr ? last(who(thr.who?.[1])) : '';
    const outCatch = ev('catchOutOfBounds');
    const detail = s.ball.target === -3 ? 'Thrown away.' : outCatch ? `${last(who(outCatch.who?.[0]))} caught it out of bounds.` : drop ? `Dropped by ${last(who(drop.who?.[0]))}.` : defl ? `Broken up by ${who(defl.who?.[0])}.` : tgt ? `Intended for ${tgt}.` : '';
    return { headline: 'Incomplete', detail, tone: 'neutral', yards: 0 };
  }
  const caught = ev('catch');
  const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
  const verb = caught ? `Complete to ${c ? c.p.name : ''}` : c && c.slot === 'QB' ? `${c.p.name} scrambles` : `${c ? c.p.name : 'Run'}`;
  // Out of bounds: pushed if a defender was on him, else he stepped out.
  const oob = ev('outOfBounds');
  const pushed = oob && c ? s.def.some((i) => Math.hypot(s.agents[i]!.pos.x - c.pos.x, s.agents[i]!.pos.y - c.pos.y) < 1.6) : false;
  const how = r.reason === 'outOfBounds' ? (pushed ? 'Pushed out of bounds' : 'Out of bounds') : tackler() ? `Tackled by ${tackler()}` : 'Down';
  return { headline: `${verb}, ${yds(y)}`, detail: `${how} at the ${spotLabel(r.spot)}.`, tone: y > 0 ? 'good' : 'neutral', yards: y };
}

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

/** The card's words for why a catchable ball went down, and why a throw was off. */
const DROP_WHY: Record<string, string> = { contact: ', hit as it arrived', behind: ', thrown behind him', bullet: ', a fastball from close in', reach: ', at full stretch', hands: '' };
const THROW_WHY: Record<string, string> = { pressure: ' under pressure', 'on the run': ' on the run', 'feet not set': ' with his feet not set', 'long throw': '', clean: '' };

const lastName = (name: string): string => name.split(' ').slice(-1)[0] ?? name;
const yds = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))} yd${Math.abs(Math.round(n)) === 1 ? '' : 's'}`;

export function describe(s: PlayState): ResultCard {
  // A last name, or the full name when two men on the field share it (Bruce and Aaron Smith).
  const last = (name: string): string => {
    const l = lastName(name);
    return s.agents.filter((a) => lastName(a.p.name) === l).length > 1 ? name : l;
  };
  const r = s.result!;
  const who = (i: number | undefined) => (i !== undefined && i >= 0 ? s.agents[i]!.p.name : '');
  const ev = (type: string) => [...s.events].reverse().find((e) => e.type === type);
  const tackler = () => {
    const t = ev('tackle') ?? ev('sack');
    return t ? last(who(t.who?.[0])) : '';
  };
  const y = r.yards;
  // A strip sack (the ball out as he's brought down): the man who stripped him, whoever fell on it.
  const strip = s.events.find((e) => e.type === 'fumble' && e.data?.sack);
  const stripper = (strip ? last(who(strip.who?.[1])) : '') || 'the defense';
  if (!r.offenseBall) {
    const pick = ev('interception');
    const rec = ev('recovery');
    // (A man the sim can't name reads as the defense, never an empty slot: legacy L8's "Intercepted by null!".)
    const by = (pick ? who(pick.who?.[0]) : rec ? who(rec.who?.[0]) : '') || 'the defense';
    return {
      headline: pick ? `Intercepted by ${by}` : strip ? `Strip sack by ${stripper}, recovered by ${by}` : `Fumble, recovered by ${by}`,
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
  // The sack is credited to the man who got the sack (not whoever made the last tackle on a strip-sack recovery).
  const sacker = (() => {
    const e = [...s.events].find((x) => x.type === 'sack');
    return e ? last(who(e.who?.[0])) : tackler();
  })();
  if (r.sack) {
    const rec = ev('recovery');
    const detail = r.bigHit
      ? `${last(who(r.bigHit.by))} lays him out.`
      : strip
        ? `${stripper} strips him; ${rec ? last(who(rec.who?.[0])) : 'the offense'} falls on it.`
        : sacker
          ? `${sacker} gets home.`
          : 'Brought down in the backfield.';
    return { headline: `Sacked ${yds(y)}`, detail, tone: 'bad', yards: y };
  }
  if (r.reason === 'incomplete') {
    const drop = ev('drop');
    const defl = ev('deflection');
    const thr = ev('throw');
    const tgt = thr ? last(who(thr.who?.[1])) : '';
    const outCatch = ev('catchOutOfBounds');
    // Why (M6.5 #1, #3): a drop says what made it hard; a ball nobody touched says why it was off.
    const dropWhy = DROP_WHY[String(drop?.data?.why ?? '')] ?? '';
    const throwWhy = THROW_WHY[String(thr?.data?.why ?? '')] ?? '';
    const offTarget = thr && !defl && !drop ? (thr.data?.mech === 'sail' ? 'Sailed on him' : thr.data?.mech === 'short' ? 'Short-hopped' : Number(thr.data?.off ?? 0) > 1.5 ? 'Off target' : '') : '';
    const detail =
      s.ball.target === -3
        ? 'Thrown away.'
        : outCatch
          ? `${last(who(outCatch.who?.[0]))} caught it out of bounds.`
          : drop
            ? `Dropped by ${last(who(drop.who?.[0]))}${dropWhy}.`
            : defl
              ? defl.data?.batted
                ? `Batted down at the line by ${last(who(defl.who?.[0]))}.`
                : `Broken up by ${who(defl.who?.[0])}.`
              : offTarget
                ? `${offTarget}${throwWhy}, intended for ${tgt}.`
                : tgt
                  ? `Intended for ${tgt}.`
                  : '';
    return { headline: 'Incomplete', detail, tone: 'neutral', yards: 0 };
  }
  const caught = ev('catch');
  const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
  const verb = caught ? `Complete to ${c ? c.p.name : ''}` : c && c.slot === 'QB' ? `${c.p.name} scrambles` : `${c ? c.p.name : 'Run'}`;
  // Out of bounds: pushed if a defender was on him, else he stepped out.
  const oob = ev('outOfBounds');
  const pushed = oob && c ? s.def.some((i) => Math.hypot(s.agents[i]!.pos.x - c.pos.x, s.agents[i]!.pos.y - c.pos.y) < 1.6) : false;
  const big = r.bigHit ? last(who(r.bigHit.by)) : '';
  const how = r.reason === 'outOfBounds' ? (pushed ? 'Pushed out of bounds' : 'Out of bounds') : big ? `Big hit by ${big}, down` : tackler() ? `Tackled by ${tackler()}` : 'Down';
  return { headline: `${verb}, ${yds(y)}`, detail: `${how} at the ${spotLabel(r.spot)}.`, tone: y > 0 ? 'good' : 'neutral', yards: y };
}

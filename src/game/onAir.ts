// What the broadcast overlay has on air (M7, GDD §11.4 and §11.7): the
// caption bar's line and a big play's lower third. The game session calls in
// at events (a whistle, a Beasts possession, a kick, the clock, a new
// situation), the commentator picks the line (commentary.ts, seeded by the
// game), and React reads this small store, which changes on events only.
// Nothing here runs per frame.

import { create } from 'zustand';
import { TRAIT_LABELS } from '@/engine/ratings/traits';
import type { SimPlayer } from '@/sim';
import { Commentator, type CallKind, type Said } from './commentary';
import type { Call, Team } from './broadcast';

export interface CaptionUi {
  /** Bumped per line (the bar animates a new one in). */
  key: number;
  text: string;
  team: Team | null;
  kind: CallKind;
  /** A line before the snap (it goes when the ball is snapped). */
  pre: boolean;
}

export interface LowerUi {
  key: number;
  name: string;
  num: number;
  pos: string;
  /** "SF · 1980s" (team and decade labels are fine in the UI; no marks). */
  stint: string | null;
  /** The trait badge: the one the line was picked for, else his headline trait. */
  trait: string | null;
  /** The tag over the name ("34-yd TD catch", "Sack · −7 yd"). */
  tag: string;
  team: Team;
  /** The play's line (the caption, inside the lower third). */
  line: string | null;
  /** A touchdown's: it waits for the celebration prompt to be answered. */
  td: boolean;
}

export interface OnAirUi {
  caption: CaptionUi | null;
  lower: LowerUi | null;
  /** The Beasts possession's line (the Meanwhile and montage lower thirds carry it). */
  drive: string | null;
}

export const useOnAir = create<OnAirUi>(() => ({ caption: null, lower: null, drive: null }));

/** A player's stint and shown traits, from the game's catalog (team, decade, trait ids in display order). */
export type StintOf = (id: string) => { team: string; decade: string; traits: string[] } | null;

class OnAir {
  private com: Commentator | null = null;
  private key = 0;
  private stintOf: StintOf = () => null;
  /** Situation lines said this drive (each once a drive). */
  readonly saidThisDrive = new Set<CallKind>();

  /** A new game: a commentator on its seed, and the catalog lookup for lower thirds. */
  start(seed: number, stintOf: StintOf): void {
    this.com = new Commentator(seed);
    this.stintOf = stintOf;
    this.saidThisDrive.clear();
    useOnAir.setState({ caption: null, lower: null, drive: null });
  }

  stop(): void {
    this.com = null;
    useOnAir.setState({ caption: null, lower: null, drive: null });
  }

  /** A new drive: the situation lines can be said again. */
  newDrive(): void {
    this.saidThisDrive.clear();
  }

  private say(c: Call): Said | null {
    if (!this.com) return null;
    const s = this.com.say(c.kind, c.slots, c.tags);
    return s.text ? s : null;
  }

  /** A snap's whistle: the line, and a big play's lower third. */
  snap(c: Call, td: boolean): void {
    const s = this.say(c);
    const key = ++this.key;
    useOnAir.setState({
      caption: s ? { key, text: s.text, team: c.team, kind: c.kind, pre: false } : null,
      lower: c.hero ? this.lowerFor(key, c.hero.player, c.hero.team, c.hero.tag, c.hero.role, s, td) : null,
    });
  }

  /** A line with no lower third: a kick, a punt, the clock. */
  line(c: Call): void {
    const s = this.say(c);
    if (s) useOnAir.setState({ caption: { key: ++this.key, text: s.text, team: c.team, kind: c.kind, pre: false } });
  }

  /** Before the snap: a situation worth a line (broadcast.ts callForSituation decides). */
  situation(c: Call | null): void {
    if (!c) return;
    this.saidThisDrive.add(c.kind);
    const s = this.say(c);
    if (s) useOnAir.setState({ caption: { key: ++this.key, text: s.text, team: c.team, kind: c.kind, pre: true }, lower: null });
  }

  /** A Beasts possession: its line goes in the Meanwhile lower third. */
  beasts(c: Call): void {
    const s = this.say(c);
    useOnAir.setState({ drive: s?.text ?? null, caption: null, lower: null });
  }

  /** Off the air: the snap (a situation line goes), a replay, a new screen. */
  clearPre(): void {
    const c = useOnAir.getState().caption;
    if (c?.pre) useOnAir.setState({ caption: null });
  }

  private lowerFor(key: number, p: SimPlayer, team: Team, tag: string, role: string, said: Said | null, td: boolean): LowerUi {
    const st = this.stintOf(p.id);
    const traitId = said?.trait && said.trait.role === role ? said.trait.id : (st?.traits[0] ?? null);
    return {
      key,
      name: p.name,
      num: p.num,
      pos: p.pos,
      stint: st ? `${st.team} · ${st.decade}` : null,
      trait: traitId ? (TRAIT_LABELS[traitId] ?? null) : null,
      tag,
      team,
      line: said?.text ?? null,
      td,
    };
  }
}

export const onAir = new OnAir();

if (import.meta.env.DEV) Object.assign(globalThis, { __btbOnAir: onAir, __btbOnAirUi: useOnAir });

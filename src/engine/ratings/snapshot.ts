import type { RatingRun } from './engine';
import type { RatedPos, TraitId, TraitResult } from './types';

// The compact ratings file the game ships (TECH_PLAN §7 "Versioning"). Values
// are rounded to integers for display and play; the explorer recomputes the
// full contribution breakdown from data/ratings/inputs.vN.json.

export interface SnapshotEntry {
  id: string;
  personId: string;
  name: string;
  pos: RatedPos;
  team: string;
  decade: string;
  ovr: number;
  /** OVR confidence: h(igh) / m(edium) / l(ow). */
  conf: 'h' | 'm' | 'l';
  attrs: Record<string, number>;
  /** Shown traits (at most four), with the one-line reason he earned each. */
  traits: SnapshotTrait[];
  heightIn: number;
  weightLb: number;
  /** Era-translated weight used for contact physics. */
  weightEq: number;
}

export interface SnapshotTrait {
  id: TraitId;
  why: string;
  /** Combination traits: the two parts. */
  combo?: [string, string];
}

const traitOut = (t: TraitResult): SnapshotTrait => ({ id: t.id, why: t.why, ...(t.combo ? { combo: t.combo } : {}) });

export interface RatingsSnapshot {
  version: number;
  entries: SnapshotEntry[];
  /** OL units: the five linemen, the unit OVR (mean of the five), block aggregates and unit traits. */
  units: { id: string; ovr: number; linemen: string[]; passBlock: number; runBlock: number; traits: SnapshotTrait[] }[];
}

export function snapshot(run: RatingRun, version: number): RatingsSnapshot {
  const entries: SnapshotEntry[] = run.entries.map((e) => {
    const attrs: Record<string, number> = {};
    for (const [k, a] of Object.entries(e.attrs)) attrs[k] = Math.round(a.value);
    const body = run.bodies[e.id]!;
    return {
      id: e.id,
      personId: e.personId,
      name: e.name,
      pos: e.pos,
      team: e.team,
      decade: e.decade,
      ovr: Math.round(e.ovr.value),
      conf: e.ovr.conf === 'high' ? 'h' : e.ovr.conf === 'medium' ? 'm' : 'l',
      attrs,
      traits: e.traits.map(traitOut),
      heightIn: Math.round(body.heightIn),
      weightLb: Math.round(body.weightLb),
      weightEq: Math.round(body.weightEq),
    };
  });
  const units = new Map<string, { sum: number; ids: string[] }>();
  for (const e of run.entries) {
    const u = e.inputs.olUnit;
    if (!u) continue;
    const x = units.get(u.unitId) ?? { sum: 0, ids: [] };
    x.sum += e.ovr.value;
    x.ids.push(e.id);
    units.set(u.unitId, x);
  }
  return {
    version,
    entries,
    units: [...units].map(([id, x]) => {
      const u = run.olUnits[id];
      return { id, ovr: Math.round(x.sum / x.ids.length), linemen: x.ids, passBlock: Math.round(u?.attrs.passBlock ?? 0), runBlock: Math.round(u?.attrs.runBlock ?? 0), traits: (u?.traits ?? []).map(traitOut) };
    }),
  };
}

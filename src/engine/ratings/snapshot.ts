import type { RatingRun } from './engine';
import type { RatedPos, TraitId } from './types';

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
  traits: TraitId[];
  heightIn: number;
  weightLb: number;
  /** Era-translated weight used for contact physics. */
  weightEq: number;
}

export interface RatingsSnapshot {
  version: number;
  entries: SnapshotEntry[];
  /** OL units: the five linemen and the unit OVR (mean of the five). */
  units: { id: string; ovr: number; linemen: string[] }[];
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
      traits: e.traits.map((t) => t.id),
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
    units: [...units].map(([id, x]) => ({ id, ovr: Math.round(x.sum / x.ids.length), linemen: x.ids })),
  };
}

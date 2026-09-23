import { useState } from 'react';
import { attrLabel } from '@/engine/ratings/attributes';
import { CARD_ATTRS } from '@/engine/ratings/ovrWeights';
import { TRAIT_LABELS } from '@/engine/ratings/traits';
import type { RatedEntry } from '@/engine/ratings/types';
import { ContributionBars } from './ContributionBars';

// The in-game Scouting panel (BRIEF "Draft screen display"): OVR, the 4–6
// attributes that matter most for the position, traits, and how each rating
// was derived from the player's real stats. A trimmed Ratings Explorer card:
// only contributions of half a point or more, no source ids. Film Room hides
// the numbers (`hideNumbers`), as legacy did.

export function ScoutingPanel({ e, hideNumbers = false }: { e: RatedEntry; hideNumbers?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const keys = CARD_ATTRS[e.pos];
  return (
    <div className="scout">
      <div className="scout-head">
        <div>
          <div className="scout-kicker">
            {e.pos} · {e.team} · {e.decade}
          </div>
          <div className="scout-name">{e.name}</div>
        </div>
        {!hideNumbers && (
          <div className="scout-ovr" title={`${e.ovr.conf} confidence`}>
            {Math.round(e.ovr.value)}
          </div>
        )}
      </div>
      <div className="scout-traits">
        {e.traits.map((t) => (
          <span key={t.id} className="scout-trait" title={t.reasons.join('\n')}>
            {TRAIT_LABELS[t.id]}
          </span>
        ))}
      </div>
      {!hideNumbers &&
        keys.map((k) => {
          const a = e.attrs[k];
          if (!a) return null;
          return (
            <div key={k} className="scout-attr">
              <button className="scout-attr-row" onClick={() => setOpen(open === k ? null : k)}>
                <span>{attrLabel(e.pos, k)}</span>
                <span className="scout-bar">
                  <span style={{ width: `${a.value}%` }} />
                </span>
                <span className="scout-val">{Math.round(a.value)}</span>
              </button>
              {open === k && <ContributionBars result={a} compact />}
            </div>
          );
        })}
    </div>
  );
}

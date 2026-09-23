import type { AttributeResult, Contribution } from '@/engine/ratings/types';

// Contribution waterfall for one attribute: how each input moved the value
// from the position average. Shared by the Ratings Explorer and the in-game
// Scouting panel (trimmed there).

const KIND_COLOR: Record<Contribution['kind'], string> = {
  base: 'var(--rx-base)',
  stat: 'var(--rx-stat)',
  accolade: 'var(--rx-acc)',
  scouting: 'var(--rx-scout)',
  reputation: 'var(--rx-rep)',
  physical: 'var(--rx-phys)',
  body: 'var(--rx-body)',
  aging: 'var(--rx-aging)',
  prior: 'var(--rx-prior)',
  unit: 'var(--rx-unit)',
};

export const CONF_LABEL: Record<string, string> = {
  verified: 'verified',
  reference: 'reference',
  legacy: 'legacy',
  estimated: 'estimated',
  prior: 'prior',
};

export function ContributionBars({ result, compact = false }: { result: AttributeResult; compact?: boolean }) {
  const base = result.contributions.find((c) => c.kind === 'base');
  const rest = result.contributions.filter((c) => c !== base && Math.abs(c.delta) >= (compact ? 0.5 : 0.05));
  const maxAbs = Math.max(4, ...rest.map((c) => Math.abs(c.delta)));
  return (
    <div className={`rx-contrib${compact ? ' is-compact' : ''}`}>
      {base && (
        <div className="rx-contrib-row is-base">
          <span className="rx-contrib-label">{base.label}</span>
          <span className="rx-contrib-val">{base.delta.toFixed(1)}</span>
        </div>
      )}
      {rest
        .slice()
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .map((c, i) => (
          <div className="rx-contrib-row" key={i} title={c.src ? `${c.src}${c.conf ? ` (${c.conf})` : ''}` : undefined}>
            <span className="rx-contrib-label">
              {c.label}
              {c.input && <span className="rx-contrib-input"> {c.input}</span>}
              {!compact && c.conf && <span className={`rx-conf rx-conf-${c.conf}`}>{CONF_LABEL[c.conf]}</span>}
            </span>
            <span className="rx-contrib-bar">
              <span
                className="rx-contrib-fill"
                style={{
                  background: KIND_COLOR[c.kind],
                  left: c.delta >= 0 ? '50%' : `${50 - (Math.abs(c.delta) / maxAbs) * 50}%`,
                  width: `${(Math.abs(c.delta) / maxAbs) * 50}%`,
                }}
              />
            </span>
            <span className={`rx-contrib-val ${c.delta >= 0 ? 'is-pos' : 'is-neg'}`}>
              {c.delta >= 0 ? '+' : ''}
              {c.delta.toFixed(1)}
            </span>
          </div>
        ))}
      <div className="rx-contrib-row is-total">
        <span className="rx-contrib-label">Rating</span>
        <span className="rx-contrib-val">{result.value.toFixed(1)}</span>
      </div>
    </div>
  );
}

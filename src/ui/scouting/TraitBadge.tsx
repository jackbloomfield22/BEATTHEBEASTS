import { traitInfo, type SynergyHit } from '@/engine/ratings/traits';
import type { TraitResult } from '@/engine/ratings/types';
import { TraitIcon } from './traitIcons';
import './traits.css';

// Reusable trait and synergy badges (Scouting panel, Ratings Explorer, and
// from M7 the draft cards, matchup preview and pre-game). The badge color says
// what kind of trait it is: elite (lime), standard (gold), combination (cyan),
// negative (red). The tooltip carries the gameplay effect; the why line is
// the player's own numbers.

type TraitLike = Pick<TraitResult, 'id' | 'why'> & Partial<Pick<TraitResult, 'combo'>>;

function tone(id: string): string {
  const t = traitInfo(id);
  if (!t) return 'is-standard';
  if (t.polarity === 'negative') return 'is-negative';
  if (t.parts) return 'is-combo';
  return t.tier === 'elite' ? 'is-elite' : 'is-standard';
}

export function TraitBadge({ trait, size = 'md' }: { trait: TraitLike; size?: 'sm' | 'md' }) {
  const info = traitInfo(trait.id);
  const label = info?.label ?? trait.id;
  const parts = info?.parts?.map((p) => traitInfo(p)?.label ?? p).join(' + ');
  const tip = [label + (parts ? ` (${parts})` : ''), info?.effect, trait.why ? `Why: ${trait.why}` : ''].filter(Boolean).join('\n');
  return (
    <span className={`trait-badge ${tone(trait.id)} is-${size}`} title={tip}>
      <TraitIcon id={info?.icon ?? 'star'} size={size === 'sm' ? 12 : 14} />
      <span className="trait-badge-label">{label}</span>
    </span>
  );
}

/** Badges with the one-line "why he earned it" under each. */
export function TraitList({ traits, showWhy = true, size = 'md', empty = 'No traits' }: { traits: readonly TraitLike[]; showWhy?: boolean; size?: 'sm' | 'md'; empty?: string }) {
  if (!traits.length) return <div className="trait-empty">{empty}</div>;
  if (!showWhy)
    return (
      <div className="trait-row">
        {traits.map((t) => (
          <TraitBadge key={t.id} trait={t} size={size} />
        ))}
      </div>
    );
  return (
    <ul className="trait-list">
      {traits.map((t) => (
        <li key={t.id}>
          <TraitBadge trait={t} size={size} />
          <span className="trait-why">{t.why}</span>
        </li>
      ))}
    </ul>
  );
}

/** A roster synergy: the pairing, the traits that make it, and its effect. */
export function SynergyBadge({ hit, nameOf }: { hit: SynergyHit; nameOf: (id: string, unit?: boolean) => string }) {
  const s = hit.synergy;
  const a = traitInfo(hit.a.trait)?.label ?? hit.a.trait;
  const b = traitInfo(hit.b.trait)?.label ?? hit.b.trait;
  return (
    <div className={`synergy-badge ${s.polarity === 'negative' ? 'is-negative' : ''}`} title={`${s.effect.text} (sim key ${s.effect.key}, ${s.effect.value > 0 ? '+' : ''}${s.effect.value} ${s.effect.unit})`}>
      <span className="synergy-icon">
        <TraitIcon id={s.icon} size={18} />
      </span>
      <span className="synergy-body">
        <span className="synergy-label">{s.label}</span>
        <span className="synergy-pair">
          {nameOf(hit.a.id)} ({a}) + {nameOf(hit.b.id, hit.b.unit)} ({b})
        </span>
        <span className="synergy-effect">{s.effect.text}</span>
      </span>
    </div>
  );
}

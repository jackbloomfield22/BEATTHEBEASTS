import { Audio } from '@/audio/audio';
import { CELEB_BY_ID, CHOOSE_SECS, celebration, useCelebration } from '@/game/celebration';
import { useActionGlyph } from '../components/Glyph';
import '../styles/celebrate.css';

// The touchdown celebration's prompt (M7, Playtest 1 #7): three choices with
// their keys (1, 2, 3 or A, B, X, drawn by the prompt system), clickable; a
// bar that runs out over the two seconds before the first plays by itself;
// and the skip. While it plays, only the skip stays up, in the corner.
// React renders on phase changes only; the bar is a CSS animation.

const PICKS = ['celebrate.pick1', 'celebrate.pick2', 'celebrate.pick3'];

export function CelebrationPrompt() {
  const ui = useCelebration();
  const glyph = useActionGlyph();
  if (ui.phase === 'play')
    return (
      <div className="celeb-skip">
        <button className="cue" onClick={() => celebration.skip()} tabIndex={-1}>
          {glyph('celebrate.skip')}
          <span className="cue-w">Skip</span>
        </button>
      </div>
    );
  if (ui.phase !== 'choose') return null;
  const pick = (n: number) => {
    Audio.uiSelect();
    celebration.choose(n, false);
  };
  return (
    <div className="celeb-prompt" role="dialog" aria-label="Touchdown celebration">
      <div className="celeb-head">
        <span className="celeb-td">Touchdown</span>
        <span className="celeb-who">{ui.scorer}</span>
      </div>
      <div className="celeb-choices">
        {ui.choices.map((id, n) => (
          <button key={id} className={`celeb-choice${n === 0 ? ' first' : ''}`} onClick={() => pick(n)} onMouseEnter={() => Audio.uiHover()} tabIndex={-1} data-celeb={id}>
            {glyph(PICKS[n]!)}
            <span className="celeb-name">{CELEB_BY_ID.get(id)!.label}</span>
          </button>
        ))}
      </div>
      <div className="celeb-foot">
        <div className="celeb-clock" style={{ animationDuration: `${CHOOSE_SECS}s` }} />
        <button className="cue celeb-skip-cue" onClick={() => celebration.skip()} tabIndex={-1}>
          {glyph('celebrate.skip')}
          <span className="cue-w">Skip</span>
        </button>
      </div>
    </div>
  );
}

/** The result card waits while the prompt or the celebration is on. */
export function useCelebrating(): boolean {
  return useCelebration((s) => s.phase === 'choose' || s.phase === 'play');
}

import { useEffect } from 'react';
import { urlFlags } from '@/app/platform';
import { reveal, useReveal } from '@/game/tunnelReveal';
import { useMenuNav } from '../nav';
import { ActionGlyph } from '../components/Glyph';
import '../styles/tunnel.css';

// The tunnel reveal's graphics (M7, src/game/tunnelReveal.ts), a broadcast
// open's, changing on the shots and their beats only:
//   tunnel   the LIVE bug as they come out; then "The Contenders take the
//            field" with who leads them out;
//   beasts   the Beasts' card (defense rating, threat word), then the best
//            man's lower third (name, position, team and decade, OVR, his
//            headline trait);
//   faceoff  the matchup across the middle: Contenders vs The Beasts.
// Confirm or back (Enter / Esc, A / B; Start too) skips it at any moment,
// and so does a click on Skip. Film Room shows no numbers.

export function TunnelHud() {
  const shot = useReveal((s) => s.shot);
  const beat = useReveal((s) => s.beat);
  const info = useReveal((s) => s.info);
  const skip = () => reveal.skip();
  useMenuNav({ count: 1, focus: 0, setFocus: () => undefined, onConfirm: skip, onBack: skip });
  // The capture harness's stills and the browser tests step frames by hand: the reveal gets out of their way.
  useEffect(() => {
    if (urlFlags.shot === null || urlFlags.video) return;
    const t = setTimeout(() => reveal.skip(), 400);
    return () => clearTimeout(t);
  }, []);
  if (!info || !shot) return null;
  const s = info.star;
  return (
    <div className={`tunnel-hud shot-${shot}`}>
      {shot === 'tunnel' || shot === 'hold' ? (
        <div className="tn-bug" key="bug">
          <span className="tn-live">Live</span>
          <span className="tn-where">Blackcliff</span>
        </div>
      ) : null}
      {shot === 'tunnel' && beat >= 1 ? (
        <div className="tn-lower us" key="us">
          <div className="tn-k">Take the field</div>
          <div className="tn-name">The Contenders</div>
          {info.qb ? <div className="tn-meta">{info.qb} leads them out</div> : null}
        </div>
      ) : null}
      {shot === 'beasts' && beat === 1 ? (
        <div className="tn-lower them" key="team">
          <div className="tn-k">The home side</div>
          <div className="tn-name">The Beasts</div>
          <div className="tn-meta">
            {info.rating !== null ? (
              <>
                Defense <b>{info.rating}</b> ·{' '}
              </>
            ) : null}
            <span className="tn-threat">{info.threat}</span>
          </div>
        </div>
      ) : null}
      {shot === 'beasts' && beat >= 2 ? (
        <div className="tn-lower them star" key="star">
          <div className="tn-k">
            {s.pos} · {s.team} {s.decade}
          </div>
          <div className="tn-name">
            {s.name}
            {s.ovr !== null ? <span className="tn-ovr">{s.ovr}</span> : null}
          </div>
          {s.trait ? <div className="tn-trait">{s.trait}</div> : null}
        </div>
      ) : null}
      {shot === 'faceoff' && beat >= 1 ? (
        <div className="tn-match" key="match">
          <span className="tn-side us">Contenders</span>
          <span className="tn-vs">vs</span>
          <span className="tn-side them">The Beasts</span>
        </div>
      ) : null}
      <button className="tn-skip" tabIndex={-1} onClick={skip}>
        <ActionGlyph action="menu.confirm" />
        <span>Skip</span>
      </button>
    </div>
  );
}

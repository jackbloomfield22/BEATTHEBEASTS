import type { ComboDef } from './types';

// Combination traits: when a player earns both parts, the combination shows
// as its own badge instead of the pair (and counts as one of his four). Its
// effect is both parts' effects plus the line below. Order matters only when
// a trait could join two combinations: the first listed wins.

export const COMBOS: readonly ComboDef[] = [
  // QB
  { id: 'bomb-squad', label: 'Bomb Squad', pos: ['QB'], parts: ['cannon', 'deep-ball-artist'], kind: 'technical', icon: 'bomb', effect: 'Both parts, and deep balls can be thrown from the far hash to the far sideline without losing accuracy.' },
  { id: 'backyard-ball', label: 'Backyard Ball', pos: ['QB'], parts: ['escape-artist', 'off-platform'], kind: 'technical', icon: 'house', effect: 'Both parts, and receivers convert to scramble-drill routes the moment he leaves the pocket.' },
  { id: 'riverboat-gambler', label: 'Riverboat Gambler', pos: ['QB'], parts: ['gunslinger', 'turnover-machine'], kind: 'production', icon: 'dice', effect: 'Both parts: the tightest windows in the game, and the most interceptions.' },
  { id: 'maestro', label: 'Maestro', pos: ['QB'], parts: ['surgeon', 'field-general'], kind: 'technical', icon: 'baton', effect: 'Both parts, and his hot-route changes also adjust the protection.' },
  { id: 'unflappable', label: 'Unflappable', pos: ['QB'], parts: ['quick-trigger', 'ice-veins'], kind: 'technical', icon: 'snowflake', effect: 'Both parts: the blitz gets home a beat late and changes nothing about his throw.' },
  { id: 'run-pass-nightmare', label: 'Run-Pass Nightmare', pos: ['QB'], parts: ['dual-threat', 'designed-runner'], kind: 'physical', icon: 'dual', effect: 'Both parts, and read-option keepers freeze the edge defender 0.1 s longer.' },
  { id: 'air-raid', label: 'Air Raid', pos: ['QB'], parts: ['volume-passer', 'red-zone-sniper'], kind: 'production', icon: 'stack', effect: 'Both parts, and no-huddle snaps keep the Beasts in their base personnel.' },
  // RB
  { id: 'short-yardage-nightmare', label: 'Short-Yardage Nightmare', pos: ['RB'], parts: ['battering-ram', 'goal-line-hammer'], kind: 'technical', icon: 'ram', effect: 'Both parts: on 3rd/4th and 1 he converts unless met in the backfield.' },
  { id: 'human-joystick', label: 'Human Joystick', pos: ['RB'], parts: ['ankle-breaker', 'jump-cut'], kind: 'technical', icon: 'zigzag', effect: 'Both parts, and moves can be chained with no recovery time.' },
  { id: 'bell-cow', label: 'Bell Cow', pos: ['RB'], parts: ['workhorse', 'tackle-breaker'], kind: 'production', icon: 'battery', effect: 'Both parts: gets stronger late in drives (Break Tackle +2 after his tenth carry).' },
  { id: 'swiss-army-knife', label: 'Swiss Army Knife', pos: ['RB'], parts: ['receiving-back', 'big-play-back'], kind: 'production', icon: 'combo', effect: 'Both parts: a threat from the backfield, the slot or the flat on every snap.' },
  { id: 'lightning', label: 'Lightning in a Bottle', pos: ['RB'], parts: ['burst', 'home-run-hitter'], kind: 'physical', icon: 'burst', effect: 'Both parts: through the hole at full speed, gone at the second level.' },
  // WR / TE
  { id: 'human-highlight', label: 'Human Highlight', pos: ['WR'], parts: ['burner', 'highlight-reel'], kind: 'physical', icon: 'sparkle', effect: 'Both parts, and a catch beyond 30 air yards triggers the slow-mo replay.' },
  { id: 'jump-ball-king', label: 'Jump Ball King', pos: ['WR'], parts: ['skyscraper', 'contested-catch-king'], kind: 'physical', icon: 'crown', effect: 'Both parts: an underthrown or overthrown ball in his radius is his.' },
    { id: 'go-to-guy', label: 'Go-To Guy', pos: ['WR'], parts: ['alpha', 'glue-hands'], kind: 'production', icon: 'alpha', effect: 'Both parts: first read on third down and in the red zone, and he catches it.' },
  { id: 'metronome', label: 'Mr. Reliable', pos: ['WR'], parts: ['route-technician', 'glue-hands'], kind: 'technical', icon: 'glove', effect: 'Both parts: on-time throws to him are never dropped.' },
  { id: 'vertical-nightmare', label: 'Vertical Nightmare', pos: ['WR'], parts: ['deep-threat', 'big-play'], kind: 'production', icon: 'arrowUp', effect: 'Both parts: a single-high safety must choose between him and everyone else.' },
  { id: 'open-field-menace', label: 'Open-Field Menace', pos: ['WR'], parts: ['yac-monster', 'twitch'], kind: 'physical', icon: 'yac', effect: 'Both parts: every catch in space is a potential touchdown.' },
  { id: 'matchup-nightmare', label: 'Matchup Nightmare', pos: ['TE'], parts: ['seam-stretcher', 'mismatch'], kind: 'physical', icon: 'tower', effect: 'Both parts: too fast for linebackers, too big for safeties.' },
  { id: 'dual-threat-te', label: 'Dual-Threat TE', pos: ['TE'], parts: ['sixth-lineman', 'sure-hands'], kind: 'technical', icon: 'combo', effect: 'Both parts: every-down tight end, no tells in his alignment.' },
  // Defense
  { id: 'blindside-assassin', label: 'Blindside Assassin', pos: ['DE', 'LB'], parts: ['speed-rusher', 'sack-artist'], kind: 'production', icon: 'claw', effect: 'Both parts: from the blind side his wins are sacks.' },
  { id: 'no-fly-zone', label: 'No-Fly Zone', pos: ['CB'], parts: ['shutdown-corner', 'zone-reader'], kind: 'technical', icon: 'lock', effect: 'Both parts: man or zone, the coordinator AI never suggests a throw into his area.' },
  { id: 'wrecking-ball', label: 'Wrecking Ball', pos: ['DE', 'DT'], parts: ['power-rusher', 'run-stuffer'], kind: 'technical', icon: 'boulder', effect: 'Both parts: wins against the run and the pass from the same bull rush.' },
  { id: 'bone-crusher', label: 'Bone Crusher', pos: ['S', 'LB'], parts: ['enforcer', 'ball-punch'], kind: 'production', icon: 'fist', effect: 'Both parts: his big hits force a fumble 10% more often.' },
  { id: 'every-down-backer', label: 'Every-Down Backer', pos: ['LB'], parts: ['run-stuffer', 'coverage-linebacker'], kind: 'technical', icon: 'rail', effect: 'Both parts: never subbed out; the Beasts keep base personnel against spread sets.' },
];

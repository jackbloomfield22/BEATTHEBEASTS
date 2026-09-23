import type { RatedPos } from '../types';

// Facets of a player's game, per position (the user's groupings in the
// follow-up spec). A player's shown traits take the best trait of each facet
// first, then fill the rest by strength, so a star reads as a specific kind of
// star (his arm, his pocket game, his mind, his style) rather than four
// variations of "great". Every trait and combination at a position has a
// facet (tested).

export const TRAIT_GROUPS: Partial<Record<RatedPos, Record<string, readonly string[]>>> = {
  QB: {
    Arm: ['cannon', 'deep-ball-artist', 'laser', 'quick-trigger', 'noodle-arm', 'bomb-squad'],
    'Pocket and legs': ['escape-artist', 'dual-threat', 'off-platform', 'climber', 'designed-runner', 'statue', 'sack-magnet', 'happy-feet', 'backyard-ball', 'run-pass-nightmare'],
    Mind: ['surgeon', 'field-general', 'game-manager', 'ice-veins', 'pre-snap-wizard', 'checkdown-charlie', 'maestro', 'unflappable'],
    Style: ['gunslinger', 'volume-passer', 'efficiency-king', 'red-zone-sniper', 'turnover-machine', 'riverboat-gambler', 'air-raid'],
  },
  RB: {
    Speed: ['home-run-hitter', 'burst', 'big-play-back', 'freight-train', 'straight-line', 'lightning'],
    Power: ['battering-ram', 'stiff-arm-king', 'tackle-breaker', 'low-center', 'goal-line-hammer', 'grinder', 'short-yardage-nightmare'],
    Moves: ['ankle-breaker', 'spin-cycle', 'hurdler', 'jump-cut', 'one-cut', 'patient-runner', 'dancer', 'human-joystick'],
    Role: ['workhorse', 'committee-back', 'receiving-back', 'third-down-back', 'scatback', 'fumble-risk', 'liability-protection', 'bell-cow', 'swiss-army-knife'],
  },
  WR: {
    'Speed and body': ['burner', 'long-strider', 'skyscraper', 'big-body', 'twitch', 'blocking-wr', 'one-speed', 'human-highlight'],
    'Route and release': ['route-technician', 'release-artist', 'slot-weapon', 'deep-threat', 'head-fake', 'metronome'],
    Hands: ['glue-hands', 'sideline-toe-tap', 'highlight-reel', 'contested-catch-king', 'mismatch', 'drops', 'body-catcher', 'alligator-arms', 'jump-ball-king'],
    Production: ['yac-monster', 'chain-mover', 'red-zone-threat', 'alpha', 'big-play', 'home-run-threat', 'go-to-guy', 'vertical-nightmare', 'open-field-menace'],
  },
  TE: {
    Receiving: ['seam-stretcher', 'move-te', 'big-slot', 'yac-monster', 'volume-te', 'red-zone-threat', 'matchup-nightmare'],
    Hands: ['sure-hands', 'safety-blanket', 'mismatch', 'drops'],
    Blocking: ['sixth-lineman', 'complete-te', 'pass-pro-te', 'lead-blocker', 'h-back', 'liability-blocker', 'dual-threat-te'],
    Body: ['basketball-body', 'bruiser-te', 'athlete-te', 'stone-feet'],
  },
  DE: {
    'Pass rush': ['speed-rusher', 'power-rusher', 'edge-bender', 'sack-artist', 'strip-sack', 'motor', 'blindside-assassin'],
    'Run defense': ['run-stuffer', 'undersized', 'wrecking-ball'],
    Hitting: ['ball-punch'],
  },
  DT: {
    'Pass rush': ['power-rusher', 'interior-wrecker', 'sack-artist', 'strip-sack', 'motor'],
    'Run defense': ['run-stuffer', 'space-eater', 'undersized', 'wrecking-ball'],
    Hitting: ['ball-punch'],
  },
  LB: {
    'Pass rush': ['speed-rusher', 'sack-artist', 'strip-sack', 'blindside-assassin'],
    Coverage: ['ballhawk', 'pick-six', 'coverage-linebacker', 'liability-space'],
    'Run defense': ['run-stuffer', 'sideline-to-sideline', 'tackling-machine', 'every-down-backer'],
    Hitting: ['enforcer', 'thumper', 'ball-punch', 'bone-crusher'],
  },
  CB: {
    Coverage: ['ballhawk', 'pick-six', 'shutdown-corner', 'jam-artist', 'zone-reader', 'pbu-machine', 'gambler', 'stiff-hips', 'no-fly-zone'],
    Speed: ['track-speed'],
    Hitting: ['missile', 'arm-tackler', 'ball-punch'],
  },
  S: {
    Coverage: ['ballhawk', 'pick-six', 'zone-reader', 'pbu-machine', 'center-fielder', 'gambler', 'stiff-hips'],
    'Run defense': ['sideline-to-sideline', 'tackling-machine'],
    Hitting: ['enforcer', 'missile', 'arm-tackler', 'ball-punch', 'bone-crusher'],
  },
  OL: {
    'Run blocking': ['road-graders', 'athletic-line', 'ground-and-pound'],
    'Pass protection': ['pass-pro-wall', 'smart-line', 'turnstile', 'sack-prone'],
  },
};

const LOOKUP = new Map<string, string>();
for (const [pos, groups] of Object.entries(TRAIT_GROUPS)) for (const [g, ids] of Object.entries(groups!)) for (const id of ids) LOOKUP.set(`${pos}|${id}`, g);

/** The facet a trait belongs to at a position (undefined if it has none there). */
export function groupOf(pos: RatedPos, id: string): string | undefined {
  return LOOKUP.get(`${pos}|${id}`);
}

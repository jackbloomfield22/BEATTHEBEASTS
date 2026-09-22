# Beat the Beasts 3D: working rules

Read `docs/BRIEF.md`, `docs/GDD.md` and `docs/TECH_PLAN.md` before large changes. `docs/PROGRESS.md` says where things stand.

## Non-negotiables

1. **Legacy data is never edited in place.** `legacy/beat-the-beasts.jsx` is untouched forever. Generated data in `data/legacy/` is only ever produced by `npm run extract`. Every fix goes through `data/corrections.json` (id, field, old, new, reason, source), and the loader rejects a correction whose `old` doesn't match.
2. **Every rating is traceable.** Each attribute function returns its value, its confidence and a list of contributions. `imp` is at most 20% of any attribute. No magic numbers without a comment saying where they came from.
3. **Reuse legacy logic instead of rewriting it.** `src/engine/legacy` is a line-for-line port, proven by the differential tests against the original file. Build on it; don't fork it.
4. **The sim is pure and deterministic.** `src/engine` and `src/sim` have no React, three, DOM, `Math.random`, `Date` or `performance.now` (ESLint enforces this). Use the seeded streams in `src/engine/rng` and `src/engine/math/detmath` for transcendental functions. The sim runs at a fixed 60 Hz; render interpolates. React never drives per-frame logic.
5. **A PC game, not a web app.** Full-screen menus over the live 3D scene, no page scroll, no browser-default controls, and everything navigable by mouse, keyboard and gamepad. Desktop only.
6. **Every animation is authored in-house.** No downloaded, mocap or third-party motion, and nothing generated from third-party motion. Base clips are keyed by us in `tools/blender`. Variants may be built in code from our own clips. Technique clips (drops, route breaks, kick-slide, pass-rush moves, backpedal and hip flip, form tackles) can never be cut.
7. **No NFL logos, wordmarks or team names** on uniforms, helmets, the field or the stadium. Player names and team+decade labels in the UI are fine.
8. **Quality over scope.** Cut scope before cutting quality; the cut order is in GDD §16.
9. **Verify visually.** Capture screenshots (`npm run shots`), look at them and compare them to `docs/reference/`, and write an honest critique in `docs/PROGRESS.md`. A visual milestone is never declared done from code alone.
10. **Licenses:** CC0 or properly licensed assets only. Every third-party asset, dataset and library-bundled asset goes in `CREDITS.md`.

## Workflow

- Develop on the session branch and open **one PR to `main` per milestone**. The user reviews and merges. Never push to `main`.
- Commit in small, meaningful steps. `npm run check` (typecheck + lint + tests) must pass before every push.
- Update `docs/PROGRESS.md` at the end of every work session.
- Known legacy bugs are listed in `docs/PROGRESS.md`. Don't rebuild them.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (also enables saving the skin-tone editor straight to `data/characterization.json`) |
| `npm run check` | Typecheck, lint and unit tests |
| `npm run extract` | Regenerate `data/legacy/` from the legacy file (ids are frozen) |
| `npm run shots` | Playwright screenshot matrix into `tools/shots/out/` |
| `npm run build` | Production build |

Dev-only URL flags: `?dev` (debug panels), `?perf` (perf screen), `?seed=N` (fixed scene seed).

# Contact and tackling: bodies, the hit, the hold, the fall

M6.5 #12, the sim side (Playtest 1, "Tackling and physics": *a tackle attempt starts on contact, then a resolution over several frames where the carrier keeps moving (drive, drag, spin off, break) and the spot is where the ball is when a knee is down. Being touched is not being tackled*). The body side (the drawn model, skinning, the render's contact) is `docs/m65/BODIES.md`.

Code: `src/sim/bodies.ts` (bodies standing and on the ground), `src/sim/tackle.ts` (the hit, the hold, the fall, bodies in the carrier's path), `src/sim/play.ts contactStep` (who reaches him and what the roll gives), `src/render/game/choreo.ts` (the clips and the ragdoll on the sim's moments). Harness: `tools/sim/tackling.ts`. Clip finder: `tools/sim/findtackles.ts`. Tests: `tests/tackle.test.ts`.

__NUMBERS__

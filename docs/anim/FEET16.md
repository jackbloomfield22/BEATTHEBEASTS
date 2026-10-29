# Animation round 16: footwork

Round 15 (`docs/anim/FEET15.md`) made a planted foot hold or step: no drag and no re-plant pops. It left four things for this round:

1. **794 procedural steps over six plays** (OL 259, LB 170, DL 136, DB 114, WR/TE 59, RB 31, QB 25). Each step is a place where the sim's motion and the clips disagree. From the broadcast camera the steps read as quick foot resets, but close up they look plain: the foot stays flat, with no toe-off and no heel strike.
2. **Lateral movement played a forward gait turned 55°**, which reads as a crossover run, not a shuffle. The keyed `lb_shuffle_l/r` was in the library and unused.
3. **The kick-slide couldn't keep up with the sim's 3–4 m/s vertical sets.** After the clip ended, a retreating lineman played the DB backpedal.
4. **The animator cost ~9% more per body** than round 14 (0.436 → 0.474 ms on the contested ball, headless).

Branch `wip/anim16`, from `96fa09f` (the tip of `claude/m66-polish`: rounds 1–14 plus round 15). Nothing in `src/sim` or `src/engine` changed. Every change is in one of these places:
- the animator (`src/anim/animator.ts`, `ik.ts`, `blend.ts`, `library.ts`);
- the render (`src/render/game/choreo.ts`, `GameScene.tsx`, `GameCamera.tsx`);
- the clips (`tools/blender/lib/actions_a16.py`: ten new clips, all keyed in-house);
- the instruments:
  - `src/render/game/popMeter.ts`;
  - `tools/shots/video.spec.ts` (`BTB_FEET_DIR`, `BTB_PROFILE`, `BTB_POSEDUMP`);
  - `tools/sim/a16_*.ts` (the harness copies, a headless bench of the animator `a16_animbench.ts`, and a clip comparison `a16_clipcmp.ts`).

<!--BODY-->

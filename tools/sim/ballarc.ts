// The ball's flight by arm, distance and throw type (docs/passing/PASSING.md):
// launch speed and angle, the apex, the speed and angle it arrives at, and
// the release time by rating, against the NFL's numbers (Next Gen Stats ball
// speeds ~45–60 mph at release; a spiral at ~600 rpm).
//   node tools/run-ts.mjs tools/sim/ballarc.ts
import { driveTime, touchStretch } from '../../src/sim/passing.ts';
import { solveLaunch, flightTime, stepFlight } from '../../src/sim/ball.ts';
import { maxThrowSpeed, releaseTime } from '../../src/sim/effects.ts';

const MPH = 1760 / 3600;
for (const power of [75, 95]) {
  for (const loft of [0, 0.5, 1]) {
    for (const d of [8, 15, 25, 40, 55]) {
      const from = { x: 0, y: 0, z: 2.15 };
      const to = { x: d, y: 0, z: 1.25 };
      const vmax = maxThrowSpeed(power);
      let T = Math.max(driveTime(d, power) * (loft > 0 ? touchStretch(loft) : 1), flightTime(from, to, vmax, 0).T);
      let v = solveLaunch(from, to, T);
      // (planThrow: never faster than his arm.)
      for (let k = 0; k < 12 && Math.hypot(v.x, v.y, v.z) > vmax; k++) {
        T *= 1.04;
        v = solveLaunch(from, to, T);
      }
      const sp = Math.hypot(v.x, v.y, v.z);
      const p = { ...from };
      const vv = { ...v };
      let apex = 0;
      for (let t = 0; t < T - 1e-9; t += 1 / 60) {
        stepFlight(p, vv);
        apex = Math.max(apex, p.z);
      }
      const asp = Math.hypot(vv.x, vv.y, vv.z);
      console.log(
        `arm ${power} ${loft ? `touch ${loft}` : 'driven '} ${String(d).padStart(2)} yd: ${T.toFixed(2)} s, launch ${(sp / MPH).toFixed(1)} mph at ${((Math.atan2(v.z, v.x) * 180) / Math.PI).toFixed(1)}°, apex ${(apex * 0.9144).toFixed(1)} m, ` +
          `arrives ${(asp / MPH).toFixed(1)} mph falling ${((Math.atan2(-vv.z, vv.x) * 180) / Math.PI).toFixed(1)}° (arm max ${(vmax / MPH).toFixed(0)} mph)`,
      );
    }
  }
}
for (const r of [60, 70, 75, 85, 95, 99]) console.log(`release ${r}: ${releaseTime(r).toFixed(3)} s`);

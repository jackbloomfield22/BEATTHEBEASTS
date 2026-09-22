// Deterministic math: pure-TS ports of fdlibm 5.3 (Sun Microsystems,
// freely redistributable; see the notice below) for the transcendental
// functions the sim needs. `+ - * /` and Math.sqrt are IEEE-754 exact in every
// JS engine; Math.sin/cos/exp/log/pow/atan2 are not required to be, and V8 and
// JavaScriptCore differ in the last bits. Using these instead gives the same
// bits on every engine (TECH_PLAN §4.4).
//
// Only integer ops, IEEE +,-,*,/, Math.floor/Math.abs (exact) and bit
// access to doubles are used.
//
// ====================================================
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================

// ---------------------------------------------------------------------------
// Bit access (fdlibm __HI / __LO)
// ---------------------------------------------------------------------------

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const LITTLE_ENDIAN = ((): boolean => { F64[0] = 1; return U32[1] === 0x3ff00000; })();
const HI = LITTLE_ENDIAN ? 1 : 0;
const LO = LITTLE_ENDIAN ? 0 : 1;

/** High 32 bits of x as a signed int32 (fdlibm __HI). */
function hiWord(x: number): number {
  F64[0] = x;
  return U32[HI]! | 0;
}

/** Low 32 bits of x as an unsigned int (fdlibm __LO). */
function loWord(x: number): number {
  F64[0] = x;
  return U32[LO]!;
}

function fromWords(hi: number, lo: number): number {
  U32[HI] = hi >>> 0;
  U32[LO] = lo >>> 0;
  return F64[0]!;
}

function withHi(x: number, hi: number): number {
  F64[0] = x;
  U32[HI] = hi >>> 0;
  return F64[0]!;
}

function withLo(x: number, lo: number): number {
  F64[0] = x;
  U32[LO] = lo >>> 0;
  return F64[0]!;
}

/** Truncating double → int32 conversion, as C's (int) cast for in-range values. */
const toInt = (x: number): number => x | 0;

const one = 1.0;
const zero = 0.0;
const huge = 1.0e300;
const tiny = 1.0e-300;
const two54 = 1.80143985094819840000e+16;
const twom54 = 5.55111512312578270212e-17;

function copysign(x: number, y: number): number {
  return withHi(x, (hiWord(x) & 0x7fffffff) | (hiWord(y) & 0x80000000));
}

/** x * 2^n, computed exactly by exponent manipulation (fdlibm s_scalbn.c). */
export function scalbn(x: number, n: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = (hx & 0x7ff00000) >> 20;
  if (k === 0) {                               /* 0 or subnormal x */
    if ((lx | (hx & 0x7fffffff)) === 0) return x; /* +-0 */
    x *= two54;
    hx = hiWord(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
    if (n < -50000) return tiny * x;           /* underflow */
  }
  if (k === 0x7ff) return x + x;               /* NaN or Inf */
  k = k + n;
  if (k > 0x7fe) return huge * copysign(huge, x); /* overflow */
  if (k > 0) return withHi(x, (hx & 0x800fffff) | (k << 20)); /* normal result */
  if (k <= -54) {
    if (n > 50000) return huge * copysign(huge, x); /* overflow */
    return tiny * copysign(tiny, x);           /* underflow */
  }
  k += 54;                                     /* subnormal result */
  x = withHi(x, (hx & 0x800fffff) | (k << 20));
  return x * twom54;
}

// ---------------------------------------------------------------------------
// exp (e_exp.c)
// ---------------------------------------------------------------------------

const halF = [0.5, -0.5];
const o_threshold = 7.09782712893383973096e+02;
const u_threshold = -7.45133219101941108420e+02;
const ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const invln2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;
const twom1000 = 9.33263618503218878990e-302;

export function exp(x: number): number {
  let hi = 0, lo = 0, k = 0;
  let hx = hiWord(x);
  const xsb = (hx >> 31) & 1;                  /* sign bit of x */
  hx &= 0x7fffffff;                            /* high word of |x| */

  /* filter out non-finite argument */
  if (hx >= 0x40862E42) {                      /* if |x|>=709.78... */
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | loWord(x)) !== 0) return x + x; /* NaN */
      return xsb === 0 ? x : 0.0;              /* exp(+-inf)={inf,0} */
    }
    if (x > o_threshold) return huge * huge;   /* overflow */
    if (x < u_threshold) return twom1000 * twom1000; /* underflow */
  }

  /* argument reduction */
  if (hx > 0x3fd62e42) {                       /* if  |x| > 0.5 ln2 */
    if (hx < 0x3FF0A2B2) {                     /* and |x| < 1.5 ln2 */
      hi = x - ln2HI[xsb]!; lo = ln2LO[xsb]!; k = 1 - xsb - xsb;
    } else {
      k = toInt(invln2 * x + halF[xsb]!);
      const t = k;
      hi = x - t * ln2HI[0]!;                  /* t*ln2HI is exact here */
      lo = t * ln2LO[0]!;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {                /* when |x|<2**-28 */
    if (huge + x > one) return one + x;        /* trigger inexact */
  } else {
    k = 0;
  }

  /* x is now in primary range */
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return one - ((x * c) / (c - 2.0) - x);
  const y = one - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    return withHi(y, hiWord(y) + (k << 20)); /* add k to y's exponent */
  }
  return withHi(y, hiWord(y) + ((k + 1000) << 20)) * twom1000;
}

// ---------------------------------------------------------------------------
// log (e_log.c)
// ---------------------------------------------------------------------------

const ln2_hi = 6.93147180369123816490e-01;
const ln2_lo = 1.90821492927058770002e-10;
const Lg1 = 6.666666666666735130e-01;
const Lg2 = 3.999999999940941908e-01;
const Lg3 = 2.857142874366239149e-01;
const Lg4 = 2.222219843214978396e-01;
const Lg5 = 1.818357216161805012e-01;
const Lg6 = 1.531383769920937332e-01;
const Lg7 = 1.479819860511658591e-01;

export function log(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {                       /* x < 2**-1022  */
    if (((hx & 0x7fffffff) | lx) === 0) return -two54 / zero; /* log(+-0)=-inf */
    if (hx < 0) return (x - x) / zero;         /* log(-#) = NaN */
    k -= 54; x *= two54;                       /* subnormal number, scale up x */
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000));       /* normalize x or x/2 */
  k += (i >> 20);
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {           /* |f| < 2**-20 */
    if (f === zero) {
      if (k === 0) return zero;
      const dk = k;
      return dk * ln2_hi + dk * ln2_lo;
    }
    const R = f * f * (0.5 - 0.3333333333333333 * f); // fdlibm: 0.33333333333333333 (same double)
    if (k === 0) return f - R;
    const dk = k;
    return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}

// ---------------------------------------------------------------------------
// sin / cos (s_sin.c, s_cos.c, k_sin.c, k_cos.c, e_rem_pio2.c, k_rem_pio2.c)
// ---------------------------------------------------------------------------

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x: number, y: number, iy: number): number {
  const ix = hiWord(x) & 0x7fffffff;           /* high word of x */
  if (ix < 0x3e400000) {                       /* |x| < 2**-27 */
    if (toInt(x) === 0) return x;              /* generate inexact */
  }
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number, y: number): number {
  const ix = hiWord(x) & 0x7fffffff;           /* ix = |x|'s high word */
  if (ix < 0x3e400000) {                       /* if x < 2**27 */
    if (toInt(x) === 0) return one;            /* generate inexact */
  }
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3FD33333) {                       /* if |x| < 0.3 */
    return one - (0.5 * z - (z * r - x * y));
  }
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0); /* x/4 */
  const hz = 0.5 * z - qx;
  const a = one - qx;
  return a - (hz - (z * r - x * y));
}

/** Table of constants for 2/pi, 396 hex digits (476 decimal) of 2/pi. */
const two_over_pi = [
  0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62,
  0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A,
  0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129,
  0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
  0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8,
  0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
  0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
  0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
  0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3,
  0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880,
  0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B,
];

const npio2_hw = [
  0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
  0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
  0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
  0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
  0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
  0x404858EB, 0x404921FB,
];

const two24 = 1.67772160000000000000e+07;
const twon24 = 5.96046447753906250000e-08;
const invpio2 = 6.36619772367581382433e-01;
const pio2_1 = 1.57079632673412561417e+00;
const pio2_1t = 6.07710050650619224932e-11;
const pio2_2 = 6.07710050630396597660e-11;
const pio2_2t = 2.02226624879595063154e-21;
const pio2_3 = 2.02226624871116645580e-21;
const pio2_3t = 8.47842766036889956997e-32;

const init_jk = [2, 3, 4, 6];
const PIo2 = [
  1.57079625129699707031e+00,
  7.54978941586159635335e-08,
  5.39030252995776476554e-15,
  3.28200341580791294123e-22,
  1.27065575308067607349e-29,
  1.22933308981111328932e-36,
  2.73370053816464559624e-44,
  2.16741683877804819444e-51,
];

/** fdlibm __kernel_rem_pio2 with prec = 2 (the only precision rem_pio2 uses). */
function kernelRemPio2(x: number[], y: number[], e0: number, nx: number): number {
  const prec = 2;
  const ipio2 = two_over_pi;
  const iq: number[] = new Array<number>(20).fill(0);
  const f: number[] = new Array<number>(20).fill(0);
  const fq: number[] = new Array<number>(20).fill(0);
  const q: number[] = new Array<number>(20).fill(0);
  let z: number, fw: number, n: number, ih: number, i: number, j: number, k: number, carry: number;

  const jk = init_jk[prec]!;
  const jp = jk;
  const jx = nx - 1;
  let jv = Math.trunc((e0 - 3) / 24); if (jv < 0) jv = 0;
  let q0 = e0 - 24 * (jv + 1);

  /* set up f[0] to f[jx+jk] where f[jx+jk] = ipio2[jv+jk] */
  j = jv - jx; const m = jx + jk;
  for (i = 0; i <= m; i++, j++) f[i] = j < 0 ? zero : ipio2[j]!;

  /* compute q[0],q[1],...q[jk] */
  for (i = 0; i <= jk; i++) {
    for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j]! * f[jx + i - j]!;
    q[i] = fw;
  }

  let jz = jk;
  for (;;) { // recompute:
    /* distill q[] into iq[] reversingly */
    for (i = 0, j = jz, z = q[jz]!; j > 0; i++, j--) {
      fw = toInt(twon24 * z);
      iq[i] = toInt(z - two24 * fw);
      z = q[j - 1]! + fw;
    }

    /* compute n */
    z = scalbn(z, q0);                         /* actual value of z */
    z -= 8.0 * Math.floor(z * 0.125);          /* trim off integer >= 8 */
    n = toInt(z);
    z -= n;
    ih = 0;
    if (q0 > 0) {                              /* need iq[jz-1] to determine n */
      i = (iq[jz - 1]! >> (24 - q0)); n += i;
      iq[jz - 1] = iq[jz - 1]! - (i << (24 - q0));
      ih = iq[jz - 1]! >> (23 - q0);
    } else if (q0 === 0) {
      ih = iq[jz - 1]! >> 23;
    } else if (z >= 0.5) {
      ih = 2;
    }

    if (ih > 0) {                              /* q > 0.5 */
      n += 1; carry = 0;
      for (i = 0; i < jz; i++) {               /* compute 1-q */
        j = iq[i]!;
        if (carry === 0) {
          if (j !== 0) { carry = 1; iq[i] = 0x1000000 - j; }
        } else {
          iq[i] = 0xffffff - j;
        }
      }
      if (q0 > 0) {                            /* rare case: chance is 1 in 12 */
        switch (q0) {
          case 1: iq[jz - 1] = iq[jz - 1]! & 0x7fffff; break;
          case 2: iq[jz - 1] = iq[jz - 1]! & 0x3fffff; break;
        }
      }
      if (ih === 2) {
        z = one - z;
        if (carry !== 0) z -= scalbn(one, q0);
      }
    }

    /* check if recomputation is needed */
    if (z === zero) {
      j = 0;
      for (i = jz - 1; i >= jk; i--) j |= iq[i]!;
      if (j === 0) {                           /* need recomputation */
        for (k = 1; iq[jk - k] === 0; k++);    /* k = no. of terms needed */
        for (i = jz + 1; i <= jz + k; i++) {   /* add q[jz+1] to q[jz+k] */
          f[jx + i] = ipio2[jv + i]!;
          for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j]! * f[jx + i - j]!;
          q[i] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }

  /* chop off zero terms */
  if (z === 0.0) {
    jz -= 1; q0 -= 24;
    while (iq[jz] === 0) { jz--; q0 -= 24; }
  } else {                                     /* break z into 24-bit if necessary */
    z = scalbn(z, -q0);
    if (z >= two24) {
      fw = toInt(twon24 * z);
      iq[jz] = toInt(z - two24 * fw);
      jz += 1; q0 += 24;
      iq[jz] = toInt(fw);
    } else {
      iq[jz] = toInt(z);
    }
  }

  /* convert integer "bit" chunk to floating-point value */
  fw = scalbn(one, q0);
  for (i = jz; i >= 0; i--) {
    q[i] = fw * iq[i]!; fw *= twon24;
  }

  /* compute PIo2[0,...,jp]*q[jz,...,0] */
  for (i = jz; i >= 0; i--) {
    for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += PIo2[k]! * q[i + k]!;
    fq[jz - i] = fw;
  }

  /* compress fq[] into y[] (prec 1 and 2) */
  fw = 0.0;
  for (i = jz; i >= 0; i--) fw += fq[i]!;
  y[0] = ih === 0 ? fw : -fw;
  fw = fq[0]! - fw;
  for (i = 1; i <= jz; i++) fw += fq[i]!;
  y[1] = ih === 0 ? fw : -fw;
  return n & 7;
}

/** Returns n and writes x − n·π/2 as y[0] + y[1] (fdlibm __ieee754_rem_pio2). */
function remPio2(x: number, y: number[]): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  let z: number, w: number, t: number, r: number, fn: number, n: number, i: number, j: number;

  if (ix <= 0x3fe921fb) { y[0] = x; y[1] = 0; return 0; } /* |x| ~<= pi/4 */
  if (ix < 0x4002d97c) {                       /* |x| < 3pi/4, special case with n=+-1 */
    if (hx > 0) {
      z = x - pio2_1;
      if (ix !== 0x3ff921fb) {                 /* 33+53 bit pi is good enough */
        y[0] = z - pio2_1t;
        y[1] = (z - y[0]) - pio2_1t;
      } else {                                 /* near pi/2, use 33+33+53 bit pi */
        z -= pio2_2;
        y[0] = z - pio2_2t;
        y[1] = (z - y[0]) - pio2_2t;
      }
      return 1;
    } else {                                   /* negative x */
      z = x + pio2_1;
      if (ix !== 0x3ff921fb) {
        y[0] = z + pio2_1t;
        y[1] = (z - y[0]) + pio2_1t;
      } else {
        z += pio2_2;
        y[0] = z + pio2_2t;
        y[1] = (z - y[0]) + pio2_2t;
      }
      return -1;
    }
  }
  if (ix <= 0x413921fb) {                      /* |x| ~<= 2^19*(pi/2), medium size */
    t = Math.abs(x);
    n = toInt(t * invpio2 + 0.5);
    fn = n;
    r = t - fn * pio2_1;
    w = fn * pio2_1t;                          /* 1st round good to 85 bit */
    if (n < 32 && ix !== npio2_hw[n - 1]) {
      y[0] = r - w;                            /* quick check no cancellation */
    } else {
      j = ix >> 20;
      y[0] = r - w;
      i = j - ((hiWord(y[0]) >> 20) & 0x7ff);
      if (i > 16) {                            /* 2nd iteration needed, good to 118 */
        t = r;
        w = fn * pio2_2;
        r = t - w;
        w = fn * pio2_2t - ((t - r) - w);
        y[0] = r - w;
        i = j - ((hiWord(y[0]) >> 20) & 0x7ff);
        if (i > 49) {                          /* 3rd iteration need, 151 bits acc */
          t = r;
          w = fn * pio2_3;
          r = t - w;
          w = fn * pio2_3t - ((t - r) - w);
          y[0] = r - w;
        }
      }
    }
    y[1] = (r - y[0]) - w;
    if (hx < 0) { y[0] = -y[0]!; y[1] = -y[1]!; return -n; }
    return n;
  }
  /* all other (large) arguments */
  if (ix >= 0x7ff00000) {                      /* x is inf or NaN */
    y[0] = y[1] = x - x; return 0;
  }
  /* set z = scalbn(|x|,ilogb(x)-23) */
  const e0 = (ix >> 20) - 1046;                /* e0 = ilogb(z)-23; */
  z = fromWords(ix - (e0 << 20), loWord(x));
  const tx = [0, 0, 0];
  for (i = 0; i < 2; i++) {
    tx[i] = toInt(z);
    z = (z - tx[i]!) * two24;
  }
  tx[2] = z;
  let nx = 3;
  while (tx[nx - 1] === zero) nx--;            /* skip zero term */
  n = kernelRemPio2(tx, y, e0, nx);
  if (hx < 0) { y[0] = -y[0]!; y[1] = -y[1]!; return -n; }
  return n;
}

const Y = [0, 0];

export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0); /* |x| ~< pi/4 */
  if (ix >= 0x7ff00000) return x - x;          /* sin(Inf or NaN) is NaN */
  const n = remPio2(x, Y);
  switch (n & 3) {
    case 0: return kernelSin(Y[0]!, Y[1]!, 1);
    case 1: return kernelCos(Y[0]!, Y[1]!);
    case 2: return -kernelSin(Y[0]!, Y[1]!, 1);
    default: return -kernelCos(Y[0]!, Y[1]!);
  }
}

export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0); /* |x| ~< pi/4 */
  if (ix >= 0x7ff00000) return x - x;          /* cos(Inf or NaN) is NaN */
  const n = remPio2(x, Y);
  switch (n & 3) {
    case 0: return kernelCos(Y[0]!, Y[1]!);
    case 1: return -kernelSin(Y[0]!, Y[1]!, 1);
    case 2: return -kernelCos(Y[0]!, Y[1]!);
    default: return kernelSin(Y[0]!, Y[1]!, 1);
  }
}

// ---------------------------------------------------------------------------
// atan / atan2 (s_atan.c, e_atan2.c)
// ---------------------------------------------------------------------------

const atanhi = [
  4.63647609000806093515e-01, /* atan(0.5)hi */
  7.85398163397448278999e-01, /* atan(1.0)hi */
  9.82793723247329054082e-01, /* atan(1.5)hi */
  1.57079632679489655800e+00, /* atan(inf)hi */
];
const atanlo = [
  2.26987774529616870924e-17,
  3.06161699786838301793e-17,
  1.39033110312309984516e-17,
  6.12323399573676603587e-17,
];
const aT = [
  3.33333333333329318027e-01,
  -1.99999999998764832476e-01,
  1.42857142725034663711e-01,
  -1.11111104054623557880e-01,
  9.09088713343650656196e-02,
  -7.69187620504482999495e-02,
  6.66107313738753120669e-02,
  -5.83357013379057348645e-02,
  4.97687799461593236017e-02,
  -3.65315727442169155270e-02,
  1.62858201153657823623e-02,
];

export function atan(x: number): number {
  let id: number;
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {                      /* if |x| >= 2^66 */
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && loWord(x) !== 0)) return x + x; /* NaN */
    if (hx > 0) return atanhi[3]! + atanlo[3]!;
    return -atanhi[3]! - atanlo[3]!;
  }
  if (ix < 0x3fdc0000) {                       /* |x| < 0.4375 */
    if (ix < 0x3e200000) {                     /* |x| < 2^-29 */
      if (huge + x > one) return x;            /* raise inexact */
    }
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {                     /* |x| < 1.1875 */
      if (ix < 0x3fe60000) {                   /* 7/16 <=|x|<11/16 */
        id = 0; x = (2.0 * x - one) / (2.0 + x);
      } else {                                 /* 11/16<=|x|< 19/16 */
        id = 1; x = (x - one) / (x + one);
      }
    } else if (ix < 0x40038000) {              /* |x| < 2.4375 */
      id = 2; x = (x - 1.5) / (one + 1.5 * x);
    } else {                                   /* 2.4375 <= |x| < 2^66 */
      id = 3; x = -1.0 / x;
    }
  }
  /* end of argument reduction */
  const z = x * x;
  const w = z * z;
  /* break sum from i=0 to 10 aT[i]z**(i+1) into odd and even poly */
  const s1 = z * (aT[0]! + w * (aT[2]! + w * (aT[4]! + w * (aT[6]! + w * (aT[8]! + w * aT[10]!)))));
  const s2 = w * (aT[1]! + w * (aT[3]! + w * (aT[5]! + w * (aT[7]! + w * aT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  const r = atanhi[id]! - ((x * (s1 + s2) - atanlo[id]!) - x);
  return hx < 0 ? -r : r;
}

const pi_o_4 = 7.8539816339744827900E-01;
const pi_o_2 = 1.5707963267948965580E+00;
const pi = 3.1415926535897931160E+00;
const pi_lo = 1.2246467991473532e-16; // fdlibm: 1.2246467991473531772E-16 (same double)

export function atan2(y: number, x: number): number {
  const hx = hiWord(x), lx = loWord(x);
  const ix = hx & 0x7fffffff;
  const hy = hiWord(y), ly = loWord(y);
  const iy = hy & 0x7fffffff;
  if ((ix | ((lx | -lx) >>> 31)) > 0x7ff00000 || (iy | ((ly | -ly) >>> 31)) > 0x7ff00000) {
    return x + y;                              /* x or y is NaN */
  }
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y); /* x=1.0 */
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2); /* 2*sign(x)+sign(y) */

  /* when y = 0 */
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1: return y;                        /* atan(+-0,+anything)=+-0 */
      case 2: return pi + tiny;                /* atan(+0,-anything) = pi */
      default: return -pi - tiny;              /* atan(-0,-anything) =-pi */
    }
  }
  /* when x = 0 */
  if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;

  /* when x is INF */
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0: return pi_o_4 + tiny;          /* atan(+INF,+INF) */
        case 1: return -pi_o_4 - tiny;         /* atan(-INF,+INF) */
        case 2: return 3.0 * pi_o_4 + tiny;    /* atan(+INF,-INF) */
        default: return -3.0 * pi_o_4 - tiny;  /* atan(-INF,-INF) */
      }
    } else {
      switch (m) {
        case 0: return zero;                   /* atan(+...,+INF) */
        case 1: return -zero;                  /* atan(-...,+INF) */
        case 2: return pi + tiny;              /* atan(+...,-INF) */
        default: return -pi - tiny;            /* atan(-...,-INF) */
      }
    }
  }
  /* when y is INF */
  if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;

  /* compute y/x */
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) z = pi_o_2 + 0.5 * pi_lo;        /* |y/x| >  2**60 */
  else if (hx < 0 && k < -60) z = 0.0;         /* |y|/x < -2**60 */
  else z = atan(Math.abs(y / x));              /* safe to do y/x */
  switch (m) {
    case 0: return z;                          /* atan(+,+) */
    case 1: return -z;                         /* atan(-,+) (flips the sign bit) */
    case 2: return pi - (z - pi_lo);           /* atan(+,-) */
    default: return (z - pi_lo) - pi;          /* atan(-,-) */
  }
}

// ---------------------------------------------------------------------------
// pow (e_pow.c)
// ---------------------------------------------------------------------------

const bp = [1.0, 1.5];
const dp_h = [0.0, 5.84962487220764160156e-01];
const dp_l = [0.0, 1.35003920212974897128e-08];
const two53 = 9007199254740992.0;
const L1 = 5.99999999999994648725e-01;
const L2 = 4.28571428578550184252e-01;
const L3 = 3.33333329818377432918e-01;
const L4 = 2.72728123808534006489e-01;
const L5 = 2.30660745775561754067e-01;
const L6 = 2.06975017800338417784e-01;
const lg2 = 6.93147180559945286227e-01;
const lg2_h = 6.93147182464599609375e-01;
const lg2_l = -1.90465429995776804525e-09;
const ovt = 8.008566259537294e-17; // fdlibm: 8.0085662595372944372e-17 (same double)
const cp = 9.61796693925975554329e-01;
const cp_h = 9.61796700954437255859e-01;
const cp_l = -7.02846165095275826516e-09;
const ivln2 = 1.44269504088896338700e+00;
const ivln2_h = 1.44269502162933349609e+00;
const ivln2_l = 1.92596299112661746887e-08;

export function pow(x: number, y: number): number {
  let z: number, ax: number, p_h: number, p_l: number;
  let t1: number, t2: number, r: number, s: number, t: number, u: number, v: number, w: number;
  let i: number, j: number, k: number, n: number;

  const hx = hiWord(x), lx = loWord(x);
  const hy = hiWord(y), ly = loWord(y);
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;

  /* y==zero: x**0 = 1 */
  if ((iy | ly) === 0) return one;

  /* +-NaN return x+y */
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) {
    return x + y;
  }

  /* determine if y is an odd int when x < 0
   * yisint = 0 ... y is not an integer
   * yisint = 1 ... y is an odd int
   * yisint = 2 ... y is an even int */
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) {
      yisint = 2;                              /* even integer y */
    } else if (iy >= 0x3ff00000) {
      k = (iy >> 20) - 0x3ff;                  /* exponent */
      if (k > 20) {
        j = ly >>> (52 - k);
        if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        j = iy >> (20 - k);
        if ((j << (20 - k)) === iy) yisint = 2 - (j & 1);
      }
    }
  }

  /* special value of y */
  if (ly === 0) {
    if (iy === 0x7ff00000) {                   /* y is +-inf */
      if (((ix - 0x3ff00000) | lx) === 0) return y - y; /* (+-1)**+-inf is NaN */
      if (ix >= 0x3ff00000) return hy >= 0 ? y : zero; /* (|x|>1)**+-inf = inf,0 */
      return hy < 0 ? -y : zero;               /* (|x|<1)**-,+inf = inf,0 */
    }
    if (iy === 0x3ff00000) {                   /* y is  +-1 */
      return hy < 0 ? one / x : x;
    }
    if (hy === 0x40000000) return x * x;       /* y is  2 */
    if (hy === 0x3fe00000) {                   /* y is  0.5 */
      if (hx >= 0) return Math.sqrt(x);        /* x >= +0 */
    }
  }

  ax = Math.abs(x);
  /* special value of x */
  if (lx === 0) {
    if (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000) {
      z = ax;                                  /* x is +-0,+-inf,+-1 */
      if (hy < 0) z = one / z;                 /* z = (1/|x|) */
      if (hx < 0) {
        if (((ix - 0x3ff00000) | yisint) === 0) {
          z = (z - z) / (z - z);               /* (-1)**non-int is NaN */
        } else if (yisint === 1) {
          z = -z;                              /* (x<0)**odd = -(|x|**odd) */
        }
      }
      return z;
    }
  }

  n = (hx >> 31) + 1;

  /* (x<0)**(non-int) is NaN */
  if ((n | yisint) === 0) return (x - x) / (x - x);

  s = one;                                     /* s (sign of result -ve**odd) = -1 else = 1 */
  if ((n | (yisint - 1)) === 0) s = -one;      /* (-ve)**(odd int) */

  /* |y| is huge */
  if (iy > 0x41e00000) {                       /* if |y| > 2**31 */
    if (iy > 0x43f00000) {                     /* if |y| > 2**64, must o/uflow */
      if (ix <= 0x3fefffff) return hy < 0 ? huge * huge : tiny * tiny;
      if (ix >= 0x3ff00000) return hy > 0 ? huge * huge : tiny * tiny;
    }
    /* over/underflow if x is not close to one */
    if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
    if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
    /* now |1-x| is tiny <= 2**-20, suffice to compute log(x) by x-x^2/2+x^3/3-x^4/4 */
    t = ax - one;                              /* t has 20 trailing zeros */
    w = (t * t) * (0.5 - t * (0.3333333333333333 - t * 0.25)); // fdlibm: 0.3333333333333333333333
    u = ivln2_h * t;                           /* ivln2_h has 21 sig. bits */
    v = t * ivln2_l - w * ivln2;
    t1 = withLo(u + v, 0);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    /* take care subnormal number */
    if (ix < 0x00100000) { ax *= two53; n -= 53; ix = hiWord(ax); }
    n += (ix >> 20) - 0x3ff;
    j = ix & 0x000fffff;
    /* determine interval */
    ix = j | 0x3ff00000;                       /* normalize ix */
    let kk: 0 | 1;
    if (j <= 0x3988E) kk = 0;                  /* |x|<sqrt(3/2) */
    else if (j < 0xBB67A) kk = 1;              /* |x|<sqrt(3)   */
    else { kk = 0; n += 1; ix -= 0x00100000; }
    k = kk;
    ax = withHi(ax, ix);

    /* compute ss = s_h+s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5) */
    u = ax - bp[k]!;                           /* bp[0]=1.0, bp[1]=1.5 */
    v = one / (ax + bp[k]!);
    const ss = u * v;
    const s_h = withLo(ss, 0);
    /* t_h=ax+bp[k] High */
    let t_h = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let t_l = ax - (t_h - bp[k]!);
    const s_l = v * ((u - s_h * t_h) - s_h * t_l);
    /* compute log(ax) */
    let s2 = ss * ss;
    r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = withLo(3.0 + s2 + r, 0);
    t_l = r - ((t_h - 3.0) - s2);
    /* u+v = ss*(1+...) */
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;
    /* 2/(3log2)*(ss+...) */
    p_h = withLo(u + v, 0);
    p_l = v - (p_h - u);
    const z_h = cp_h * p_h;                    /* cp_h+cp_l = 2/(3*log2) */
    const z_l = cp_l * p_h + p_l * cp + dp_l[k]!;
    /* log2(ax) = (ss+..)*2/(3*log2) = n + dp_h + z_h + z_l */
    t = n;
    t1 = withLo(((z_h + z_l) + dp_h[k]!) + t, 0);
    t2 = z_l - (((t1 - t) - dp_h[k]!) - z_h);
  }

  /* split up y into y1+y2 and compute (y1+y2)*(t1+t2) */
  const y1 = withLo(y, 0);
  p_l = (y - y1) * t1 + y * t2;
  p_h = y1 * t1;
  z = p_l + p_h;
  j = hiWord(z);
  i = loWord(z);
  if (j >= 0x40900000) {                       /* z >= 1024 */
    if (j !== 0x40900000 || i !== 0) {         /* if z > 1024 */
      return s * huge * huge;                  /* overflow */
    }
    if (p_l + ovt > z - p_h) return s * huge * huge; /* overflow */
  } else if ((j & 0x7fffffff) >= 0x4090cc00) { /* z <= -1075 */
    if (j !== (0xc090cc00 | 0) || i !== 0) {   /* z < -1075 */
      return s * tiny * tiny;                  /* underflow */
    }
    if (p_l <= z - p_h) return s * tiny * tiny; /* underflow */
  }

  /* compute 2**(p_h+p_l) */
  i = j & 0x7fffffff;
  k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {                        /* if |z| > 0.5, set n = [z+0.5] */
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;      /* new k for n */
    t = fromWords(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  t = withLo(p_l + p_h, 0);
  u = t * lg2_h;
  v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
  z = u + v;
  w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  r = (z * t1) / (t1 - 2.0) - (w + z * w);
  z = one - (r - z);
  j = hiWord(z);
  j += (n << 20);
  if ((j >> 20) <= 0) z = scalbn(z, n);        /* subnormal output */
  else z = withHi(z, hiWord(z) + (n << 20));
  return s * z;
}

// ---------------------------------------------------------------------------
// sqrt: IEEE-754 requires a correctly rounded result, so Math.sqrt is exact
// and identical on every engine.
// ---------------------------------------------------------------------------

export const sqrt: (x: number) => number = Math.sqrt;

export const PI = 3.141592653589793;

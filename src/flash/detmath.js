// Online: sine, cosine and arctangent that give the same bits in every browser.
//
// Math.sin and friends may differ in their last bit between JavaScript engines, and a match
// played in lockstep (every browser running the same simulation from the same commands)
// drifts apart on the first difference.  These use nothing but IEEE-754 addition,
// subtraction, multiplication, division and rounding, which every engine does identically:
// fdlibm's kernels (Sun Microsystems, 1993; freely redistributable), with a simpler argument
// reduction that is exact enough for the angles a game uses.

// pi/2 in two parts: the first with its low bits clear, so n * PIO2_1 is exact.
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_1T = 6.07710050650619224932e-11;
const INVPIO2 = 6.36619772367581382433e-01;

function kernelSin(x) {
  const z = x * x;
  const r = 8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04 + z * (2.75573137070700676789e-06 +
    z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)));
  return x + x * z * (-1.66666666666666324348e-01 + z * r);
}

function kernelCos(x) {
  const z = x * x;
  const r = z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05 +
    z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
  return 1 - 0.5 * z + z * r;
}

// x reduced to [-pi/4, pi/4], and which quarter-turn it came from.
function reduce(x) {
  const n = Math.round(x * INVPIO2);
  return [(x - n * PIO2_1) - n * PIO2_1T, ((n % 4) + 4) % 4];
}

export function sin(x) {
  x = +x;
  if (!Number.isFinite(x)) return NaN;
  const [y, q] = reduce(x);
  switch (q) {
    case 0: return kernelSin(y);
    case 1: return kernelCos(y);
    case 2: return -kernelSin(y);
    default: return -kernelCos(y);
  }
}

export function cos(x) {
  x = +x;
  if (!Number.isFinite(x)) return NaN;
  const [y, q] = reduce(x);
  switch (q) {
    case 0: return kernelCos(y);
    case 1: return -kernelSin(y);
    case 2: return -kernelCos(y);
    default: return kernelSin(y);
  }
}

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
  -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
  -3.65315727442169155270e-02, 1.62858201153657823623e-02];

export function atan(x) {
  x = +x;
  if (Number.isNaN(x)) return NaN;
  const negative = x < 0;
  let t = negative ? -x : x;
  if (t >= 7.378697629483821e19) return negative ? -1.5707963267948966 : 1.5707963267948966;
  let id;
  if (t < 0.4375) {
    id = -1;
  } else if (t < 1.1875) {
    if (t < 0.6875) { id = 0; t = (2 * t - 1) / (2 + t); } else { id = 1; t = (t - 1) / (t + 1); }
  } else if (t < 2.4375) {
    id = 2; t = (t - 1.5) / (1 + 1.5 * t);
  } else {
    id = 3; t = -1 / t;
  }
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return negative ? -(t - t * (s1 + s2)) : t - t * (s1 + s2);
  const r = ATANHI[id] - ((t * (s1 + s2) - ATANLO[id]) - t);
  return negative ? -r : r;
}

export function atan2(y, x) {
  y = +y;
  x = +x;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) {
    if (y > 0) return 1.5707963267948966;
    if (y < 0) return -1.5707963267948966;
    return Object.is(x, -0) ? (Object.is(y, -0) ? -Math.PI : Math.PI) : y;
  }
  const a = atan(Math.abs(y / x));
  if (x > 0) return y < 0 || Object.is(y, -0) ? -a : a;
  return y < 0 || Object.is(y, -0) ? -(Math.PI - a) : Math.PI - a;
}

/**
 * "마무리 필터" (finish filter): a small, fixed post-processing chain for generated images.
 *
 * The math is a direct port of the tuned browser prototype (grain-lab.html) so results match it.
 * Order: sharpen → chromatic → white balance → tone curve → saturation → glow → paper → vignette → grain.
 *
 * Only RGB changes: the alpha channel carries NovelAI's stealth metadata and is copied through
 * untouched. Everything here is pure (no DOM), so it runs in a Web Worker and in tests.
 */

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };

export type FinishParams = {
  /** 색온도, -50..50 */
  temp: number;
  /** 톤 커브 S자, -40..60 */
  curve: number;
  /** 암부 올리기 %, 0..25 */
  lift: number;
  /** 채도 %, 60..130 */
  sat: number;
  /** 글로우 세기 %, 0..100 */
  glow: number;
  /** 글로우 시작 밝기 %, 40..95 */
  gthr: number;
  /** 글로우 번짐 px (at the 1216 px reference long side), 2..40 */
  grad: number;
  /** 색수차 px (reference), 0..3 */
  chroma: number;
  /** 비네팅 %, 0..40 */
  vig: number;
  /** 수채화지 질감 세기 %, 0..100 */
  pstr: number;
  /** 수채화지 결 크기 %, 50..250 */
  pscale: number;
  /** 그레인 강도 %, 0..20 */
  strength: number;
  /** 샤픈 %, 0..150 */
  sharp: number;
};

export type FinishParamKey = keyof FinishParams;
export type FinishPresetKey = "anime" | "watercolor";

export const FINISH_PARAM_RANGES: Record<FinishParamKey, { min: number; max: number; step: number }> = {
  temp: { min: -50, max: 50, step: 1 },
  curve: { min: -40, max: 60, step: 1 },
  lift: { min: 0, max: 25, step: 1 },
  sat: { min: 60, max: 130, step: 1 },
  glow: { min: 0, max: 100, step: 1 },
  gthr: { min: 40, max: 95, step: 1 },
  grad: { min: 2, max: 40, step: 1 },
  chroma: { min: 0, max: 3, step: 0.05 },
  vig: { min: 0, max: 40, step: 1 },
  pstr: { min: 0, max: 100, step: 1 },
  pscale: { min: 50, max: 250, step: 5 },
  strength: { min: 0, max: 20, step: 0.1 },
  sharp: { min: 0, max: 150, step: 1 },
};

/** Every stage is a no-op at these values ("끄기"). */
export const FINISH_NEUTRAL: Readonly<FinishParams> = Object.freeze({
  temp: 0, curve: 0, lift: 0, sat: 100,
  glow: 0, gthr: 75, grad: 14,
  chroma: 0, vig: 0,
  pstr: 0, pscale: 100,
  strength: 0, sharp: 0,
});

export const FINISH_PRESETS: Readonly<Record<FinishPresetKey | "off", Readonly<FinishParams>>> = Object.freeze({
  anime: Object.freeze({
    ...FINISH_NEUTRAL,
    temp: 6, curve: 14, lift: 4, sat: 106,
    glow: 35, gthr: 72, grad: 16,
    chroma: 0.75, vig: 10, pstr: 0, strength: 3.5, sharp: 30,
  }),
  watercolor: Object.freeze({
    ...FINISH_NEUTRAL,
    temp: 3, curve: 0, lift: 6, sat: 94,
    glow: 0, chroma: 0, vig: 0,
    pstr: 55, pscale: 120, strength: 2, sharp: 0,
  }),
  off: FINISH_NEUTRAL,
});

export const FINISH_PRESET_LABELS: Record<FinishPresetKey, string> = {
  anime: "애니 마무리",
  watercolor: "수채화 종이",
};

/** Fixed look choices that are no longer user settings. */
export const FINISH_FIXED = Object.freeze({
  grainSize: 1.5,
  sharpenRadius: 1.0,
  seed: 20260924,
});

/** Pixel sizes are tuned for 832×1216 output; they scale with the image's long side. */
export const FINISH_REFERENCE_LONG_SIDE = 1216;

const PARAM_KEYS = Object.keys(FINISH_NEUTRAL) as FinishParamKey[];

/** Clamps known keys into range and fills missing/invalid ones from `fallback`. */
export function sanitizeFinishParams(value: unknown, fallback: FinishParams = FINISH_PRESETS.anime): FinishParams {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = { ...fallback };
  for (const key of PARAM_KEYS) {
    const raw = source[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const { min, max } = FINISH_PARAM_RANGES[key];
    out[key] = Math.min(max, Math.max(min, raw));
  }
  return out;
}

export function finishParamsEqual(a: FinishParams, b: FinishParams) {
  return PARAM_KEYS.every((key) => a[key] === b[key]);
}

export function finishPixelScale(width: number, height: number) {
  return Math.max(width, height) / FINISH_REFERENCE_LONG_SIDE;
}

/** Pixel-sized parameters for an image of this size (identical to the prototype at 1216 px). */
export function scaledPixelParams(params: FinishParams, width: number, height: number) {
  const scale = finishPixelScale(width, height);
  return {
    glowRadius: params.grad * scale,
    chromaShift: params.chroma * scale,
    paperScale: params.pscale * scale,
    grainSize: Math.max(1, FINISH_FIXED.grainSize * scale),
    sharpenRadius: FINISH_FIXED.sharpenRadius * scale,
  };
}

// ---------------------------------------------------------------------------
// Prototype primitives (kept byte-for-byte equivalent)

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radii of three box passes approximating a Gaussian with this sigma. */
function boxes(sigma: number) {
  const n = 3;
  const wi = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wi);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    let ti = y * w, li = ti, ri = ti + r;
    const fv = src[ti], lv = src[ti + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[ti + Math.min(j, w - 1)];
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri++, y * w + w - 1)] - fv; dst[ti++] = val * iarr; }
    for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr; }
    for (let j = Math.max(w - r, r + 1); j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr; }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let ti = x, li = ti, ri = ti + r * w;
    const fv = src[ti], lv = src[ti + w * (h - 1)];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[ti + Math.min(j, h - 1) * w];
    for (let j = 0; j <= r; j++) { val += src[Math.min(ri, x + (h - 1) * w)] - fv; ri += w; dst[ti] = val * iarr; ti += w; }
    for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; ri += w; li += w; dst[ti] = val * iarr; ti += w; }
    for (let j = Math.max(h - r, r + 1); j < h; j++) { val += lv - src[li]; li += w; dst[ti] = val * iarr; ti += w; }
  }
}

function blurPlane(p: Float32Array, w: number, h: number, sigma: number) {
  const out = Float32Array.from(p);
  if (sigma < 0.3) return out;
  const tmp = new Float32Array(p.length);
  for (const r0 of boxes(sigma)) {
    const r = Math.max(0, Math.round(r0));
    if (!r) continue;
    boxH(out, tmp, w, h, r);
    boxV(tmp, out, w, h, r);
  }
  return out;
}

type Planes = [Float32Array, Float32Array, Float32Array];
const blur3 = (P: Planes, w: number, h: number, sigma: number): Planes =>
  [blurPlane(P[0], w, h, sigma), blurPlane(P[1], w, h, sigma), blurPlane(P[2], w, h, sigma)];

function noiseField(w: number, h: number, size: number, seed: number) {
  const gw = Math.ceil(w / size) + 2, gh = Math.ceil(h / size) + 2, rnd = mulberry32(seed);
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rnd() + rnd() - 1;
  const out = new Float32Array(w * h);
  if (size === 1) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = g[y * gw + x];
    return out;
  }
  for (let y = 0; y < h; y++) {
    const fy = y / size, y0 = fy | 0, ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x / size, x0 = fx | 0, tx = fx - x0, i = y0 * gw + x0;
      const a = g[i] + (g[i + 1] - g[i]) * tx, b = g[i + gw] + (g[i + gw + 1] - g[i + gw]) * tx;
      out[y * w + x] = a + (b - a) * ty;
    }
  }
  const k = Math.min(1.6, 1 + (size - 1) * 0.35);
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

/** Cold-press watercolour paper: a height map shaded by light from the top-left, roughly -1..1. */
function coldPaperMap(w: number, h: number, scale: number, seed: number) {
  const H = new Float32Array(w * h), k = scale / 100;
  const add = (size: number, amp: number, sd: number) => {
    const n = noiseField(w, h, Math.max(1, size * k), sd);
    for (let i = 0; i < H.length; i++) H[i] += n[i] * amp;
  };
  add(2, 0.35, seed + 21); add(6, 0.6, seed + 22); add(18, 0.5, seed + 23); add(60, 0.25, seed + 24);
  const S = new Float32Array(w * h);
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
    const i = y * w + x;
    S[i] = (H[i] - H[i - w - 1]) * 1.6 + (H[i] - 0.3) * 0.12;
  }
  return S;
}

function curveLUT(curve: number, liftPercent: number) {
  const lut = new Float32Array(256), a = curve / 100, lift = liftPercent / 100, top = 1; // highlights fixed at 0
  for (let i = 0; i < 256; i++) {
    const x = i / 255, sc = x * x * (3 - 2 * x);
    let y = x + (sc - x) * a * 1.6;
    y = lift + y * (top - lift);
    lut[i] = Math.min(255, Math.max(0, y * 255));
  }
  return lut;
}

const screen = (a: number, b: number, k: number) => a + ((255 - ((255 - a) * (255 - b)) / 255) - a) * k;

// ---------------------------------------------------------------------------
// Stages (exported for tests). Each returns the planes to use next.

export function toPlanes(image: RgbaImage): Planes {
  const N = image.width * image.height, sd = image.data;
  const P: Planes = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  for (let i = 0; i < N; i++) { P[0][i] = sd[i * 4]; P[1][i] = sd[i * 4 + 1]; P[2][i] = sd[i * 4 + 2]; }
  return P;
}

/** Unsharp mask; `amount` in %. */
export function sharpenStage(P: Planes, w: number, h: number, amount: number, radius: number): Planes {
  if (amount <= 0) return P;
  const B = blur3(P, w, h, radius), k = amount / 100, N = w * h;
  for (let c = 0; c < 3; c++) { const p = P[c], b = B[c]; for (let i = 0; i < N; i++) p[i] += (p[i] - b[i]) * k; }
  return P;
}

/** Radial horizontal shift of R outward and B inward, `shift` px at the edges. */
export function chromaticStage(P: Planes, w: number, h: number, shift: number): Planes {
  if (shift <= 0) return P;
  const N = w * h, R = new Float32Array(N), Bn = new Float32Array(N), cx = w / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.round((shift * (x - cx)) / cx), i = y * w + x;
    R[i] = P[0][y * w + Math.min(w - 1, Math.max(0, x + dx))];
    Bn[i] = P[2][y * w + Math.min(w - 1, Math.max(0, x - dx))];
  }
  return [R, P[1], Bn];
}

/** White balance → tone curve (+ lifted shadows) → saturation. Tint 0, contrast 100 % fixed. */
export function colorStage(P: Planes, params: Pick<FinishParams, "temp" | "curve" | "lift" | "sat">): Planes {
  const lut = curveLUT(params.curve, params.lift);
  const tr = params.temp * 0.6, tb = -params.temp * 0.6, tg = 0, trb = 0;
  const con = 1, sat = params.sat / 100;
  const [Pr, Pg, Pb] = P, N = Pr.length;
  for (let i = 0; i < N; i++) {
    let r = Pr[i] + tr + trb, g = Pg[i] + tg, b = Pb[i] + tb + trb;
    r = lut[Math.min(255, Math.max(0, r | 0))]; g = lut[Math.min(255, Math.max(0, g | 0))]; b = lut[Math.min(255, Math.max(0, b | 0))];
    r = (r - 128) * con + 128; g = (g - 128) * con + 128; b = (b - 128) * con + 128;
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    r = L + (r - L) * sat; g = L + (g - L) * sat; b = L + (b - L) * sat;
    Pr[i] = r; Pg[i] = g; Pb[i] = b;
  }
  return P;
}

/** Bright-pass glow, blurred and screened back; `glow`/`threshold` in %. */
export function glowStage(P: Planes, w: number, h: number, glow: number, threshold: number, radius: number): Planes {
  if (glow <= 0) return P;
  const N = w * h, [Pr, Pg, Pb] = P;
  const thr = (threshold / 100) * 255, span = 255 - thr + 1;
  const Bp: Planes = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  for (let i = 0; i < N; i++) {
    const L = 0.299 * Pr[i] + 0.587 * Pg[i] + 0.114 * Pb[i];
    const t = Math.min(1, Math.max(0, (L - thr) / span)), k = t * t;
    Bp[0][i] = Pr[i] * k; Bp[1][i] = Pg[i] * k; Bp[2][i] = Pb[i] * k;
  }
  const G = blur3(Bp, w, h, radius), k = (glow / 100) * 1.4;
  for (let c = 0; c < 3; c++) { const p = P[c], g = G[c]; for (let i = 0; i < N; i++) p[i] = screen(p[i], Math.min(255, g[i] * k), 1); }
  return P;
}

/** Cold-press paper texture modulating brightness; `strength` in %, `scale` in % (already size-scaled). */
export function paperStage(P: Planes, w: number, h: number, strength: number, scale: number, seed: number): Planes {
  if (strength <= 0) return P;
  const T = coldPaperMap(w, h, scale, seed), amp = (strength / 100) * 0.22, N = w * h;
  for (let i = 0; i < N; i++) { const m = 1 + T[i] * amp; P[0][i] *= m; P[1][i] *= m; P[2][i] *= m; }
  return P;
}

/** Vignette and monochrome midtone-weighted grain, written out with the source alpha. */
export function finalizeStage(
  P: Planes, source: RgbaImage, vignette: number, strength: number, grainSize: number, seed: number,
): Uint8ClampedArray {
  const { width: w, height: h, data: sd } = source;
  const d = new Uint8ClampedArray(w * h * 4);
  const vig = vignette / 100, cx = w / 2, cy = h / 2, maxd = Math.hypot(cx, cy), amp = (strength / 100) * 255;
  const n1 = amp > 0 ? noiseField(w, h, grainSize, seed) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    let r = P[0][i], g = P[1][i], b = P[2][i];
    if (vig > 0) {
      const dd = Math.hypot(x - cx, y - cy) / maxd, t = Math.min(1, Math.max(0, (dd - 0.35) / 0.65)), k = 1 - vig * t * t;
      r *= k; g *= k; b *= k;
    }
    if (n1) {
      let a = amp;
      const l = Math.min(1, Math.max(0, (0.299 * r + 0.587 * g + 0.114 * b) / 255));
      a *= 0.35 + 0.65 * (1 - Math.pow(2 * l - 1, 2));
      const n = n1[i] * a;
      r += n; g += n; b += n;
    }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = sd[o + 3];
  }
  return d;
}

/** Returns a new filtered image; `image` is not modified and its alpha is copied exactly. */
export function applyFinish(image: RgbaImage, params: FinishParams, seed: number = FINISH_FIXED.seed): RgbaImage {
  const { width: w, height: h } = image;
  if (w === 0 || h === 0) return { data: new Uint8ClampedArray(image.data), width: w, height: h };
  const px = scaledPixelParams(params, w, h);
  let P = toPlanes(image);
  P = sharpenStage(P, w, h, params.sharp, px.sharpenRadius);
  P = chromaticStage(P, w, h, px.chromaShift);
  P = colorStage(P, params);
  P = glowStage(P, w, h, params.glow, params.gthr, px.glowRadius);
  P = paperStage(P, w, h, params.pstr, px.paperScale, seed);
  return { data: finalizeStage(P, image, params.vig, params.strength, px.grainSize, seed), width: w, height: h };
}

export function finishFilename(filename: string) {
  return filename.replace(/\.png$/i, "") + "_finish.png";
}

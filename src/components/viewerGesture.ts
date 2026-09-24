/**
 * Full-screen viewer gestures (pure). States:
 * - fit (scale 1): one finger = swipe (left/right changes image, down closes), tap closes;
 * - zoomed (scale > 1): one finger = pan (clamped to the image edges), tap fits again;
 * - two fingers (either state): pinch zoom around the fingers' midpoint, panning with it.
 */
export type ViewerRelease = "none" | "tap" | "close" | "next" | "previous";
export type ViewerDrag = "pan" | "swipe" | "pinch";
export type Transform = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

export const TAP_MAX_MOVE = 10;
export const TAP_MAX_MS = 300;
export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
const ZOOMED = 1.02;

export const FIT: Transform = { scale: 1, x: 0, y: 0 };

export const isZoomed = (transform: Transform) => transform.scale > ZOOMED;

/** What moving fingers do right now. */
export function dragMode(pointerCount: number, zoomed: boolean): ViewerDrag {
  if (pointerCount >= 2) return "pinch";
  return zoomed ? "pan" : "swipe";
}

export function classifyRelease(input: {
  dx: number;
  dy: number;
  durationMs: number;
  pinched: boolean;
  zoomed: boolean;
}): ViewerRelease {
  const { dx, dy, durationMs, pinched, zoomed } = input;
  if (pinched) return "none";
  if (Math.hypot(dx, dy) <= TAP_MAX_MOVE && durationMs <= TAP_MAX_MS) return "tap";
  // A zoomed drag was a pan: never a swipe or close.
  if (zoomed) return "none";
  if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.2) return "close";
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "next" : "previous";
  return "none";
}

/** Size of an image fitted (contain) into the stage. */
export function fittedSize(image: Size, stage: Size): Size {
  const ratio = Math.min(stage.width / image.width, stage.height / image.height);
  return { width: image.width * ratio, height: image.height * ratio };
}

/** Keeps the zoomed image covering the stage where it can (offsets from the centred position). */
export function clampTransform(transform: Transform, fitted: Size, stage: Size): Transform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, transform.scale));
  const maxX = Math.max(0, (fitted.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (fitted.height * scale - stage.height) / 2);
  return {
    scale,
    x: Math.max(-maxX, Math.min(maxX, transform.x)),
    y: Math.max(-maxY, Math.min(maxY, transform.y)),
  };
}

/** One-finger pan by a pointer delta, clamped. */
export function panBy(start: Transform, dx: number, dy: number, fitted: Size, stage: Size): Transform {
  return clampTransform({ scale: start.scale, x: start.x + dx, y: start.y + dy }, fitted, stage);
}

/**
 * Pinch: the image point under the starting midpoint stays under the current midpoint
 * (zoom around the fingers and pan with them). Points are relative to the stage centre.
 */
export function pinchTo(
  start: Transform,
  startMid: { x: number; y: number },
  mid: { x: number; y: number },
  scaleFactor: number,
  fitted: Size,
  stage: Size,
): Transform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, start.scale * scaleFactor));
  const u = { x: (startMid.x - start.x) / start.scale, y: (startMid.y - start.y) / start.scale };
  return clampTransform({ scale, x: mid.x - u.x * scale, y: mid.y - u.y * scale }, fitted, stage);
}

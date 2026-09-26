/**
 * Full-screen viewer gestures (pure). States:
 * - fit (scale 1): one finger = swipe (left/right changes image, down closes), tap closes;
 * - zoomed (scale > 1): one finger = pan (clamped to the image edges), tap fits again;
 * - two fingers (either state): pinch zoom around the fingers' midpoint, panning with it.
 * A finger has to travel more than TAP_MAX_MOVE before it pans, so a tap never nudges the image.
 */
export type ViewerRelease = "none" | "tap" | "close" | "next" | "previous";
export type ViewerDrag = "pan" | "swipe" | "pinch";
export type Transform = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

export const TAP_MAX_MOVE = 10;
/** Below Android's long-press timeout: a still press released within this is a tap. */
export const TAP_MAX_MS = 500;
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
  /** The finger left the tap slop at some point (defaults to the end distance). */
  moved?: boolean;
  /** The browser cancelled the pointer (system gesture, palm rejection): never a tap. */
  cancelled?: boolean;
}): ViewerRelease {
  const { dx, dy, durationMs, pinched, zoomed, cancelled = false } = input;
  if (pinched || cancelled) return "none";
  const moved = input.moved ?? Math.hypot(dx, dy) > TAP_MAX_MOVE;
  if (!moved && durationMs <= TAP_MAX_MS) return "tap";
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

type Point = { x: number; y: number };
export type PointerSample = {
  id: number;
  x: number;
  y: number;
  /** Milliseconds (any monotonic clock). */
  time: number;
  /** `PointerEvent.isPrimary`: the first finger of a new touch, with no other finger down. */
  primary?: boolean;
};
/** Stage size, fitted image size and the stage centre in client coordinates. */
export type StageGeometry = { stage: Size; fitted: Size; centre: Point };
/** What a finished gesture asks the viewer to do ("fit" is already applied to `transform`). */
export type ViewerAction = "none" | "fit" | "close" | "next" | "previous";

type Session = {
  /** First finger's down point and time (tap and swipe are measured from here). */
  origin: Point;
  startAt: number;
  /** Where the current pan is measured from, and the transform it started at. */
  anchor: Point;
  from: Transform;
  pinched: boolean;
  /** The finger left the tap slop. */
  moved: boolean;
  pinch: { mid: Point; distance: number } | null;
};

/**
 * Tracks the fingers on the viewer stage and owns the image transform.
 * Robust against lost pointer events: a fresh primary finger drops any finger whose
 * pointerup/pointercancel never arrived, and events for unknown fingers are ignored.
 */
export class ViewerGestureTracker {
  transform: Transform = FIT;
  private pointers = new Map<number, Point>();
  private session: Session | null = null;

  /** A finger is down (the image follows it without a transition). */
  get active() {
    return this.pointers.size > 0;
  }

  reset() {
    this.transform = FIT;
    this.pointers.clear();
    this.session = null;
  }

  down(sample: PointerSample, geometry: StageGeometry) {
    // No other finger can be down when the browser reports a primary pointer: anything
    // still tracked is a ghost that would turn this tap into a pinch.
    if (sample.primary) {
      this.pointers.clear();
      this.session = null;
    }
    const point = { x: sample.x, y: sample.y };
    this.pointers.set(sample.id, point);
    if (this.pointers.size === 1) {
      this.session = {
        origin: point,
        startAt: sample.time,
        anchor: point,
        from: this.transform,
        pinched: false,
        moved: false,
        pinch: null,
      };
    } else {
      this.rebase(sample.time, geometry);
    }
  }

  /** Returns true when the transform changed. */
  move(sample: PointerSample, geometry: StageGeometry) {
    const session = this.session;
    if (!session || !this.pointers.has(sample.id)) return false;
    const point = { x: sample.x, y: sample.y };
    this.pointers.set(sample.id, point);
    const mode = dragMode(this.pointers.size, isZoomed(session.from));
    if (mode === "pinch") {
      if (!session.pinch) return false;
      const now = this.pinchInfo(geometry);
      return this.apply(pinchTo(
        session.from,
        session.pinch.mid,
        now.mid,
        now.distance / session.pinch.distance,
        geometry.fitted,
        geometry.stage,
      ));
    }
    if (!session.moved) {
      if (Math.hypot(point.x - session.origin.x, point.y - session.origin.y) <= TAP_MAX_MOVE) return false;
      // Past the tap slop: pan from here so the image does not jump.
      session.moved = true;
      session.anchor = point;
      session.from = this.transform;
    }
    // "swipe" is decided on release.
    if (mode !== "pan") return false;
    return this.apply(panBy(
      session.from,
      point.x - session.anchor.x,
      point.y - session.anchor.y,
      geometry.fitted,
      geometry.stage,
    ));
  }

  /** pointerup, or pointercancel with `cancelled`. */
  end(sample: PointerSample, geometry: StageGeometry, cancelled = false): ViewerAction {
    const last = this.pointers.get(sample.id);
    if (!last) return "none";
    this.pointers.delete(sample.id);
    if (this.pointers.size > 0) {
      // A finger stays down (end of a pinch): keep going from here.
      this.rebase(sample.time, geometry);
      return "none";
    }
    const session = this.session;
    this.session = null;
    if (!session) return "none";

    const zoomed = isZoomed(this.transform);
    const kind = classifyRelease({
      dx: last.x - session.origin.x,
      dy: last.y - session.origin.y,
      durationMs: sample.time - session.startAt,
      pinched: session.pinched,
      zoomed: isZoomed(session.from) || zoomed,
      moved: session.moved,
      cancelled,
    });
    // Barely zoomed counts as fit.
    if (!zoomed) this.transform = FIT;
    if (kind === "tap") {
      // A single tap acts at once: a zoomed image fits again, a fitted one closes.
      this.transform = FIT;
      return zoomed ? "fit" : "close";
    }
    return kind;
  }

  /** Keeps the current object when nothing changed (no needless re-render). */
  private apply(next: Transform) {
    const current = this.transform;
    if (next.scale === current.scale && next.x === current.x && next.y === current.y) return false;
    this.transform = next;
    return true;
  }

  /** (Re)starts from the fingers still down and the current transform (a pinch). */
  private rebase(time: number, geometry: StageGeometry) {
    const first = [...this.pointers.values()][0];
    if (!first) {
      this.session = null;
      return;
    }
    this.session = {
      origin: this.session?.origin ?? first,
      startAt: this.session?.startAt ?? time,
      anchor: first,
      from: this.transform,
      pinched: true,
      moved: true,
      pinch: this.pointers.size >= 2 ? this.pinchInfo(geometry) : null,
    };
  }

  private pinchInfo(geometry: StageGeometry) {
    const [a, b] = [...this.pointers.values()];
    return {
      mid: { x: (a.x + b.x) / 2 - geometry.centre.x, y: (a.y + b.y) / 2 - geometry.centre.y },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }
}

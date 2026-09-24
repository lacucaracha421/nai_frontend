import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { GenerationImage } from "../types/generation";
import { Icon } from "./Icon";
import { FIT, classifyRelease, dragMode, fittedSize, isZoomed, panBy, pinchTo, type Transform } from "./viewerGesture";

type Point = { x: number; y: number };

/**
 * Full-screen session viewer: swipe left/right between session images, swipe down to
 * close, pinch to zoom. Image actions and the meta line come from the caller.
 * When `displaySrc` (the 마무리 preview) is given, holding "누르고 있으면 원본" shows the original.
 */
export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
  displaySrc,
  topRight,
  meta,
  actions,
}: {
  images: GenerationImage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  displaySrc?: string | null;
  topRight?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const image = images[index];
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    start: Point;
    startAt: number;
    from: Transform;
    pinched: boolean;
    pinch: { mid: Point; distance: number } | null;
  } | null>(null);
  const [transform, setTransformState] = useState<Transform>(FIT);
  const transformRef = useRef<Transform>(FIT);
  const [dragging, setDragging] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const setTransform = (next: Transform) => {
    transformRef.current = next;
    setTransformState(next);
  };

  // Each image opens at fit size.
  useEffect(() => {
    transformRef.current = FIT;
    setTransformState(FIT);
  }, [index]);

  if (!image) return null;

  const geometry = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    const stage = { width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight };
    return {
      stage,
      fitted: fittedSize({ width: image.width, height: image.height }, stage),
      centre: { x: (rect?.left ?? 0) + stage.width / 2, y: (rect?.top ?? 0) + stage.height / 2 },
    };
  };

  const pinchInfo = () => {
    const [a, b] = [...pointers.current.values()];
    const { centre } = geometry();
    return {
      mid: { x: (a.x + b.x) / 2 - centre.x, y: (a.y + b.y) / 2 - centre.y },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  };

  /** (Re)starts the gesture from the current fingers and transform. */
  const rebase = (pinched: boolean) => {
    const first = [...pointers.current.values()][0];
    if (!first) {
      gesture.current = null;
      return;
    }
    gesture.current = {
      start: first,
      startAt: Date.now(),
      from: transformRef.current,
      pinched,
      pinch: pointers.current.size >= 2 ? pinchInfo() : null,
    };
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort (fails for pointers the browser no longer tracks).
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);
    if (pointers.current.size === 1) rebase(false);
    else rebase(true);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    const { stage, fitted } = geometry();
    const mode = dragMode(pointers.current.size, isZoomed(current.from));
    if (mode === "pinch" && current.pinch) {
      const now = pinchInfo();
      setTransform(pinchTo(current.from, current.pinch.mid, now.mid, now.distance / current.pinch.distance, fitted, stage));
    } else if (mode === "pan") {
      const point = pointers.current.get(event.pointerId)!;
      setTransform(panBy(current.from, point.x - current.start.x, point.y - current.start.y, fitted, stage));
    }
    // "swipe" is decided on release.
  };

  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const end = pointers.current.get(event.pointerId) ?? { x: event.clientX, y: event.clientY };
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (pointers.current.size > 0) {
      // A finger stays down (end of a pinch): keep panning from here.
      rebase(true);
      return;
    }
    gesture.current = null;
    setDragging(false);
    if (!current) return;

    const kind = classifyRelease({
      dx: end.x - current.start.x,
      dy: end.y - current.start.y,
      durationMs: Date.now() - current.startAt,
      pinched: current.pinched,
      zoomed: isZoomed(current.from) || isZoomed(transformRef.current),
    });
    if (kind === "close") onClose();
    if (kind === "next" || kind === "previous") {
      onIndex(Math.max(0, Math.min(images.length - 1, index + (kind === "next" ? 1 : -1))));
    }
    if (kind === "tap") {
      // A single tap acts at once: a zoomed image fits again, a fitted one closes.
      if (isZoomed(transformRef.current)) setTransform(FIT);
      else onClose();
    }
    if (transformRef.current.scale <= 1.02 && transformRef.current !== FIT) setTransform(FIT);
  };

  const src = (!showOriginal && displaySrc) || image.src;

  return (
    <div className="image-viewer b2-viewer">
      <div className="viewer-topbar">
        <button type="button" className="viewer-round" onClick={onClose} aria-label="닫기"><Icon name="left" /></button>
        <span className="viewer-count">{index + 1} / {images.length}</span>
        <span className="viewer-top-spacer" />
        {displaySrc && (
        <button
          type="button"
          className={`viewer-compare ${showOriginal ? "active" : ""}`}
          aria-pressed={showOriginal}
          onPointerDown={() => setShowOriginal(true)}
          onPointerUp={() => setShowOriginal(false)}
          onPointerLeave={() => setShowOriginal(false)}
          onPointerCancel={() => setShowOriginal(false)}
          onContextMenu={(event) => event.preventDefault()}
        >
          누르고 있으면 원본
        </button>
        )}
        {topRight ?? <span className="viewer-round-spacer" />}
      </div>

      <div
        ref={stageRef}
        className="viewer-stage"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
      >
        <img
          src={src}
          alt="generation full view"
          draggable={false}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transition: dragging ? "none" : "transform .14s ease",
          }}
        />
      </div>

      <div className="viewer-bottom">
        {meta && <div className="viewer-meta">{meta}</div>}
        {actions && <div className="viewer-actions">{actions}</div>}
      </div>
    </div>
  );
}

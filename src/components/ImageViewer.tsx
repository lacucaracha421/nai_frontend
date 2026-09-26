import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { GenerationImage } from "../types/generation";
import { swallowGhostClicks } from "./ghostClick";
import { Icon } from "./Icon";
import { FIT, ViewerGestureTracker, fittedSize, type PointerSample, type Transform } from "./viewerGesture";

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
  const trackerRef = useRef<ViewerGestureTracker | null>(null);
  trackerRef.current ??= new ViewerGestureTracker();
  const tracker = trackerRef.current;
  const [transform, setTransform] = useState<Transform>(FIT);
  const [dragging, setDragging] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  // Each image opens at fit size.
  useEffect(() => {
    tracker.reset();
    setTransform(FIT);
    setDragging(false);
  }, [index, tracker]);

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

  const sample = (event: ReactPointerEvent<HTMLDivElement>): PointerSample => ({
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: event.timeStamp,
    primary: event.isPrimary,
  });

  /** Mirrors the tracker into React state (the transition is off while a finger is down). */
  const sync = () => {
    setTransform(tracker.transform);
    setDragging(tracker.active);
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort (fails for pointers the browser no longer tracks).
    }
    tracker.down(sample(event), geometry());
    sync();
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!tracker.active) return;
    event.preventDefault();
    if (tracker.move(sample(event), geometry())) setTransform(tracker.transform);
  };

  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const action = tracker.end(sample(event), geometry(), cancelled);
    sync();
    if (action === "close") {
      // The browser's click for this tap arrives after pointerup and would land on the
      // screen revealed underneath (태그사전, or the thumbnail that reopens the viewer).
      swallowGhostClicks();
      onClose();
    }
    if (action === "next" || action === "previous") {
      onIndex(Math.max(0, Math.min(images.length - 1, index + (action === "next" ? 1 : -1))));
    }
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
        onPointerUp={(event) => pointerEnd(event, false)}
        onPointerCancel={(event) => pointerEnd(event, true)}
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

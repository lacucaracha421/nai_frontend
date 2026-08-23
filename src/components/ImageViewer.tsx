import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GenerationImage } from "../types/generation";

type Point = { x: number; y: number };

export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: GenerationImage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];
  const pointers = useRef(new Map<number, Point>());
  const gestureStart = useRef<Point | null>(null);
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const [scale, setScale] = useState(1);
  const [pinching, setPinching] = useState(false);

  if (!image) return null;

  const distance = () => {
    const values = [...pointers.current.values()];
    if (values.length < 2) return null;
    return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
  };

  const resetZoom = () => {
    setScale(1);
    setPinching(false);
    pinchStartDistance.current = null;
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      gestureStart.current = { x: event.clientX, y: event.clientY };
    } else if (pointers.current.size === 2) {
      pinchStartDistance.current = distance();
      pinchStartScale.current = scale;
      setPinching(true);
    }
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinchStartDistance.current) {
      const nextDistance = distance();
      if (!nextDistance) return;
      const nextScale = Math.max(1, Math.min(5, pinchStartScale.current * (nextDistance / pinchStartDistance.current)));
      setScale(nextScale);
    }
  };

  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const end = pointers.current.get(event.pointerId) ?? { x: event.clientX, y: event.clientY };
    const wasPinching = pointers.current.size > 1 || pinching;
    pointers.current.delete(event.pointerId);

    if (pointers.current.size < 2) {
      pinchStartDistance.current = null;
      setPinching(false);
    }

    if (wasPinching || scale > 1.02 || !gestureStart.current) {
      gestureStart.current = null;
      return;
    }

    const dx = end.x - gestureStart.current.x;
    const dy = end.y - gestureStart.current.y;
    gestureStart.current = null;

    if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      onClose();
      return;
    }
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
      onIndex(Math.max(0, Math.min(images.length - 1, index + (dx < 0 ? 1 : -1))));
      resetZoom();
    }
  };

  return (
    <div
      className="image-viewer"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd}
      onDoubleClick={resetZoom}
    >
      <button className="viewer-close" onClick={onClose}>×</button>
      <img
        src={image.src}
        alt="generation full view"
        draggable={false}
        style={{ transform: `scale(${scale})`, transition: pinching ? "none" : "transform .14s ease" }}
      />
      <div className="viewer-index">{index + 1} / {images.length}</div>
    </div>
  );
}

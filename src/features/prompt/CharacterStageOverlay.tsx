import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CharacterPrompt } from "../../types/generation";

type Props = {
  characters: CharacterPrompt[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDone: () => void;
};

export function CharacterStageOverlay({ characters, selectedId, onSelect, onMove, onDone }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const enabled = characters.filter((character) => character.enabled);

  const point = (event: ReactPointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.max(0.02, Math.min(0.98, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0.02, Math.min(0.98, (event.clientY - rect.top) / rect.height)),
    };
  };

  const targetCharacterId = (event: ReactPointerEvent) => {
    const target = event.target as HTMLElement;
    return target.closest<HTMLElement>("[data-character-marker]")?.dataset.characterMarker ?? selectedId ?? enabled[0]?.id ?? null;
  };

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-position-toolbar]")) return;
    const id = targetCharacterId(event);
    if (!id) return;
    const next = point(event);
    if (!next) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(id);
    onSelect(id);
    onMove(id, next.x, next.y);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingId) return;
    const next = point(event);
    if (next) onMove(draggingId, next.x, next.y);
  };

  return (
    <div
      ref={ref}
      className="stage-position-layer"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={() => setDraggingId(null)}
      onPointerCancel={() => setDraggingId(null)}
    >
      <div className="stage-position-toolbar" data-position-toolbar>
        <span>캐릭터 위치 지정</span>
        <small>이미지 위를 누르거나 마커를 끌어 배치</small>
        <button type="button" onClick={onDone}>완료</button>
      </div>
      {enabled.map((character, index) => (
        <button
          type="button"
          key={character.id}
          data-character-marker={character.id}
          className={`stage-character-marker ${selectedId === character.id ? "selected" : ""}`}
          style={{ left: `${character.position.x * 100}%`, top: `${character.position.y * 100}%` }}
          aria-label={`${character.name || `Character ${index + 1}`} 위치`}
        >
          {index + 1}
        </button>
      ))}
    </div>
  );
}

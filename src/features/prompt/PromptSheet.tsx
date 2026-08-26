import { useRef } from "react";
import type { PromptSectionKey } from "../../types/generation";
import { useGenerationStore } from "../../stores/generationStore";
import { usePromptHistoryStore } from "../../stores/promptHistoryStore";
import { AutocompleteTextarea } from "../tags/AutocompleteTextarea";
import { adjustEmphasis } from "./weight";
import type { TagCategory } from "../tags/localTagIndex";

const labels: Record<PromptSectionKey, string> = {
  artist: "Artist",
  other: "Other Prompt",
  quality: "Quality",
  negative: "Negative",
};

const filters: Record<PromptSectionKey, TagCategory[] | undefined> = {
  artist: ["artist"],
  other: ["general", "copyright", "meta"],
  quality: ["general", "meta"],
  negative: ["general", "meta"],
};

export function PromptSheet({
  section,
  onClose,
  onDictionary,
}: {
  section: PromptSectionKey;
  onClose: () => void;
  onDictionary: (section: PromptSectionKey) => void;
}) {
  const touchY = useRef<number | null>(null);
  const value = useGenerationStore((s) => (s as any)[`${section}Prompt`] as string);
  const setPrompt = useGenerationStore((s) => s.setPrompt);
  const generate = useGenerationStore((s) => s.generate);
  const status = useGenerationStore((s) => s.status);
  const checkpoint = usePromptHistoryStore((s) => s.checkpoint);
  const busy = status === "generating" || status === "upscaling";
  const historyKey = `prompt:${section}`;

  const weight = (delta: number) => {
    const element = document.activeElement;
    if (!(element instanceof HTMLTextAreaElement)) return;
    checkpoint(historyKey, {
      value,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
    });
    const out = adjustEmphasis(value, element.selectionStart, element.selectionEnd, delta);
    setPrompt(section, out.text);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(out.start, out.end);
    });
  };

  return (
    <div className="sheet prompt-sheet">
      <div
        className="sheet-head"
        onPointerDown={(event) => { touchY.current = event.clientY; }}
        onPointerUp={(event) => {
          if (touchY.current !== null && event.clientY - touchY.current > 55) onClose();
          touchY.current = null;
        }}
      >
        <div className="drag-handle" />
        <div><small>Prompt editor</small><h2>{labels[section]}</h2></div>
        <button className="icon-button" onClick={onClose}>↓</button>
      </div>
      <div className="editor-toolbar editor-toolbar-top">
        <button onPointerDown={(event) => { event.preventDefault(); weight(-0.1); }}>−0.1</button>
        <button onPointerDown={(event) => { event.preventDefault(); weight(0.1); }}>+0.1</button>
        <button onClick={() => onDictionary(section)}>태그사전</button>
        <button className="toolbar-generate" disabled={busy} onClick={() => void generate()}>
          {status === "generating" ? "Generating…" : status === "upscaling" ? "Upscaling…" : "Generate"}
        </button>
      </div>
      <div className="sheet-body">
        <AutocompleteTextarea
          value={value}
          onChange={(next) => setPrompt(section, next)}
          categories={filters[section]}
          historyKey={historyKey}
          tagPrefix={section === "artist" ? "artist:" : undefined}
          autoFocus
          placeholder={
            section === "artist"
              ? "artist:toma 또는 toma로 검색 가능"
              : section === "negative"
                ? "원하지 않는 요소"
                : section === "quality"
                  ? "거의 고정해둘 품질 프롬프트"
                  : "장면, 행동, 구도, 배경…"
          }
        />
      </div>
    </div>
  );
}

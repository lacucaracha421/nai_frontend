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

type TokenRange = { start: number; end: number };

function tokenRanges(value: string): TokenRange[] {
  const ranges: TokenRange[] = [];
  let segmentStart = 0;
  for (let cursor = 0; cursor <= value.length; cursor += 1) {
    const atEnd = cursor === value.length;
    const separator = !atEnd && (value[cursor] === "," || value[cursor] === "\n");
    if (!atEnd && !separator) continue;
    const segment = value.slice(segmentStart, cursor);
    const leading = segment.match(/^\s*/)?.[0].length ?? 0;
    const trailing = segment.match(/\s*$/)?.[0].length ?? 0;
    const start = segmentStart + leading;
    const end = cursor - trailing;
    if (end > start) ranges.push({ start, end });
    segmentStart = cursor + 1;
  }
  return ranges;
}

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
  const value = useGenerationStore((state) => (state as any)[`${section}Prompt`] as string);
  const setPrompt = useGenerationStore((state) => state.setPrompt);
  const generate = useGenerationStore((state) => state.generate);
  const status = useGenerationStore((state) => state.status);
  const checkpoint = usePromptHistoryStore((state) => state.checkpoint);
  const busy = status === "generating" || status === "upscaling";
  const historyKey = `prompt:${section}`;

  const weight = (delta: number) => {
    const element = document.activeElement;

    if (element instanceof HTMLTextAreaElement) {
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
      return;
    }

    if (!(element instanceof HTMLInputElement)) return;
    const orderText = element.dataset.promptTokenOrder;
    if (orderText === undefined) return;
    const order = Number(orderText);
    if (!Number.isInteger(order) || order < 0) return;
    const range = tokenRanges(value)[order];
    if (!range) return;

    const localStart = element.selectionStart ?? 0;
    const localEnd = element.selectionEnd ?? localStart;
    if (localStart === localEnd) return;
    checkpoint(historyKey, {
      value,
      selectionStart: localStart,
      selectionEnd: localEnd,
      activeIndex: order,
    });
    const out = adjustEmphasis(value, range.start + localStart, range.start + localEnd, delta);
    setPrompt(section, out.text);

    requestAnimationFrame(() => {
      const active = document.querySelector<HTMLInputElement>(`input[data-prompt-token-order="${order}"]`);
      if (!active) return;
      active.focus();
      active.setSelectionRange(
        Math.max(0, out.start - range.start),
        Math.max(0, out.end - range.start),
      );
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

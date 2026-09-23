import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { PromptSectionKey } from "../../types/generation";
import { useGenerationStore } from "../../stores/generationStore";
import { usePromptHistoryStore } from "../../stores/promptHistoryStore";
import { AutocompleteTextarea } from "../tags/AutocompleteTextarea";
import { adjustEmphasis } from "./weight";
import type { TagCategory } from "../tags/localTagIndex";
import { selectionOrWhole } from "../tags/promptEditorModel";
import { copyWholePrompt } from "./promptClipboard";

const labels: Record<PromptSectionKey, string> = {
  artist: "Artist",
  other: "Other Prompt",
  quality: "Quality",
  negative: "Negative",
};

const filters: Record<PromptSectionKey, TagCategory[] | undefined> = {
  artist: ["artist", "general", "meta"],
  other: ["general", "copyright", "meta"],
  quality: ["general", "meta"],
  negative: ["general", "meta"],
};

// Sections whose whole prompt is usually reused or replaced get one-tap copy and clear.
const copyAllSections = new Set<PromptSectionKey>(["artist", "other"]);

/** Clear a whole section, recording the previous text so the editor's undo restores it. */
export function clearWholePrompt(
  section: PromptSectionKey,
  value: string,
  checkpoint: (key: string, snapshot: { value: string; selectionStart: number; selectionEnd: number }) => void,
  setPrompt: (section: PromptSectionKey, value: string) => void,
) {
  if (!copyAllSections.has(section) || !value) return false;
  checkpoint(`prompt:${section}`, { value, selectionStart: 0, selectionEnd: value.length });
  setPrompt(section, "");
  return true;
}

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
  onPrombot,
}: {
  section: PromptSectionKey;
  onClose: () => void;
  onDictionary: (section: PromptSectionKey) => void;
  onPrombot: (section: PromptSectionKey) => void;
}) {
  const touchY = useRef<number | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyAttempt = useRef(0);
  useEffect(() => () => {
    copyAttempt.current += 1;
    clearTimeout(copyTimer.current);
    setCopyState("idle");
  }, [section]);
  const value = useGenerationStore((state) => (state as any)[`${section}Prompt`] as string);
  const setPrompt = useGenerationStore((state) => state.setPrompt);
  const generate = useGenerationStore((state) => state.generate);
  const status = useGenerationStore((state) => state.status);
  const checkpoint = usePromptHistoryStore((state) => state.checkpoint);
  const busy = status === "generating" || status === "upscaling";
  const historyKey = `prompt:${section}`;

  const copyPrompt = async () => {
    if (!copyAllSections.has(section) || !value) return;
    const attempt = ++copyAttempt.current;
    clearTimeout(copyTimer.current);
    setCopyState("idle");
    try {
      await copyWholePrompt(value, writeText);
      if (attempt !== copyAttempt.current) return;
      setCopyState("copied");
    } catch {
      if (attempt !== copyAttempt.current) return;
      setCopyState("error");
    }
    copyTimer.current = setTimeout(() => setCopyState("idle"), 1800);
  };

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

    const rawStart = element.selectionStart ?? 0;
    const rawEnd = element.selectionEnd ?? rawStart;
    const local = selectionOrWhole(rawStart, rawEnd, element.value.length);
    checkpoint(historyKey, {
      value,
      selectionStart: local.start,
      selectionEnd: local.end,
      activeIndex: order,
    });
    const out = adjustEmphasis(value, range.start + local.start, range.start + local.end, delta);
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
        <div><h2>{labels[section]}</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="프롬프트 편집기 닫기">↓</button>
      </div>

      <div className="editor-toolbar editor-toolbar-top">
        <button onPointerDown={(event) => { event.preventDefault(); weight(-0.1); }}>−0.1</button>
        <button onPointerDown={(event) => { event.preventDefault(); weight(0.1); }}>+0.1</button>
        <button onClick={() => onDictionary(section)}>태그사전</button>
        <button onClick={() => onPrombot(section)}>Prombot</button>
        {copyAllSections.has(section) && (
          <button
            type="button"
            className="prompt-copy-all"
            aria-live="polite"
            disabled={!value}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void copyPrompt()}
          >
            {copyState === "copied" ? "복사됨" : copyState === "error" ? "복사 실패" : "전체 복사"}
          </button>
        )}
        {copyAllSections.has(section) && (
          <button
            type="button"
            className="prompt-clear-all"
            disabled={!value}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => { clearWholePrompt(section, value, checkpoint, setPrompt); }}
          >
            전체 지우기
          </button>
        )}
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

import { useRef, useState } from "react";
import { usePromptHistoryStore } from "../../stores/promptHistoryStore";
import { adjustEmphasis } from "./weight";

/**
 * Plain-text editor for one prompt section, for anything the chip editor cannot
 * express (weight groups spanning several tags, partial-tag weights, line breaks).
 * The whole edit is one undo step in the section's history.
 */
export function RawPromptSheet({
  title,
  value,
  historyKey,
  onChange,
  onClose,
}: {
  title: string;
  value: string;
  historyKey: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const checkpoint = usePromptHistoryStore((state) => state.checkpoint);

  const weight = (delta: number) => {
    const area = areaRef.current;
    if (!area || area.selectionStart === area.selectionEnd) return;
    const out = adjustEmphasis(text, area.selectionStart, area.selectionEnd, delta);
    setText(out.text);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(out.start, out.end);
    });
  };

  const done = () => {
    if (text !== value) {
      checkpoint(historyKey, { value, selectionStart: 0, selectionEnd: 0 });
      onChange(text);
    }
    onClose();
  };

  return (
    <div className="sheet raw-prompt-sheet">
      <div className="sheet-head">
        <div className="drag-handle" />
        <div><h2>{title} · 텍스트 편집</h2></div>
        <button type="button" className="raw-prompt-cancel" onClick={onClose}>취소</button>
        <button type="button" className="raw-prompt-done" onClick={done}>완료</button>
      </div>
      <div className="raw-prompt-tools">
        <button type="button" onPointerDown={(event) => { event.preventDefault(); weight(-0.1); }}>−0.1</button>
        <button type="button" onPointerDown={(event) => { event.preventDefault(); weight(0.1); }}>+0.1</button>
        <span>선택한 부분의 가중치를 바꿉니다</span>
      </div>
      <div className="sheet-body">
        <textarea
          ref={areaRef}
          className="prompt-textarea"
          value={text}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setText(event.target.value)}
        />
      </div>
    </div>
  );
}

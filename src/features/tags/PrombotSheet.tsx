import { useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { PromptSectionKey } from "../../types/generation";

const DESTINATION_LABEL: Record<PromptSectionKey | "character", string> = {
  artist: "Artist",
  other: "Other",
  quality: "Quality",
  negative: "Negative",
  character: "Character Prompt",
};

export function PrombotSheet({
  destination,
  onInsert,
  onClose,
}: {
  destination: PromptSectionKey | "character";
  onInsert: (value: string) => void;
  onClose: () => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pasteFromClipboard = async () => {
    if (pasting) return;
    setPasting(true);
    setMessage(null);
    try {
      const text = (await readText()).trim();      if (!text) {
        setMessage("클립보드가 비어 있사와요.");
        return;
      }
      onInsert(text);
      setMessage("프롬프트에 붙여넣었사와요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPasting(false);
    }
  };

  return (
    <div className="sheet quickcopy-sheet prombot-sheet">
      <div className="quickcopy-hostbar">
        <div>
          <strong>Prombot Characters</strong>
          <span>상단 Characters 탭 선택 · 삽입 대상 {DESTINATION_LABEL[destination]}</span>
        </div>
        <div className="prombot-host-actions">
          <button type="button" disabled={pasting} onClick={() => void pasteFromClipboard()}>
            {pasting ? "붙여넣는 중…" : "붙여넣기"}
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Prombot 닫기">↓</button>
        </div>
      </div>      {message && <div className="prombot-message" role="status">{message}</div>}
      <iframe
        className="quickcopy-frame prombot-frame"
        src="https://prombot.net/"
        allow="clipboard-read; clipboard-write"
        title="Prombot Characters"
      />
    </div>
  );
}

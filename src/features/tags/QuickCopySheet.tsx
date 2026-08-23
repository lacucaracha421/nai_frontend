import { useEffect, useRef } from "react";
import type { PromptSectionKey } from "../../types/generation";

const BRIDGE_SOURCE = "artist-tag-quick-copy-v7";
const DESTINATION_LABEL: Record<PromptSectionKey, string> = {
  artist: "Artist",
  other: "Other",
  quality: "Quality",
  negative: "Negative",
};

export function QuickCopySheet({
  destination,
  onInsert,
  onClose,
}: {
  destination: PromptSectionKey;
  onInsert: (value: string) => void;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string; text?: unknown; tab?: string } | null;
      if (!data || data.source !== BRIDGE_SOURCE || data.type !== "insert") return;
      let text = String(data.text ?? "").trim();
      if (data.tab === "artists" && text && !/^artist\\?:/i.test(text)) text = `artist:${text}`;
      if (text) onInsert(text);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onInsert]);

  return (
    <div className="sheet quickcopy-sheet">
      <div className="quickcopy-hostbar">
        <div>
          <strong>Artist / Tag Quick Copy v7</strong>
          <span>삽입 대상 · {DESTINATION_LABEL[destination]}</span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Quick Copy 닫기">↓</button>
      </div>
      <iframe
        ref={frameRef}
        className="quickcopy-frame"
        src="/quickcopy/index.html"
        title="Artist / Tag Quick Copy v7"
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { PromptSectionKey } from "../../types/generation";
import { SexTagDictionary } from "./SexTagDictionary";
import { searchLocalTags } from "./localTagIndex";
import {
  exactArtistTag,
  quickCopyArtistQuery,
  quickCopyInsertion,
  type QuickCopyKind,
} from "./quickCopyBridge";

const BRIDGE_SOURCE = "artist-tag-quick-copy-v7";
const DESTINATION_LABEL: Record<PromptSectionKey, string> = {
  artist: "Artist",
  other: "Other",
  quality: "Quality",
  negative: "Negative",
};

type DictionaryView = "classic" | "sex";

/** The bundled same-origin dictionary exposes tab buttons, not a URL/message API. */
export function openDestinationTab(frame: HTMLIFrameElement, destination: PromptSectionKey) {
  const tab = destination === "artist" ? "artists" : destination === "other" ? "actions" : "tags";
  frame.contentDocument?.querySelector<HTMLButtonElement>(`button[data-tab="${tab}"]`)?.click();
}

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
  const [view, setView] = useState<DictionaryView>("classic");

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string; text?: unknown; kind?: QuickCopyKind; tab?: string } | null;
      if (!data || data.source !== BRIDGE_SOURCE || data.type !== "insert") return;
      void (async () => {
        const rawText = String(data.text ?? "").trim();
        const query = data.kind === "artist" ? quickCopyArtistQuery(rawText) : null;
        const rows = query && !/^artist\\?:/i.test(rawText)
          ? await searchLocalTags(query, undefined, 24)
          : [];
        const text = quickCopyInsertion(data, /^artist\\?:/i.test(rawText) || exactArtistTag(rawText, rows));
        if (text) onInsert(text);
      })();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onInsert]);

  return (
    <div className="sheet quickcopy-sheet">
      <div className="quickcopy-hostbar">
        <div>
          <strong>Tag Dictionary</strong>
          <span>삽입 대상 · {DESTINATION_LABEL[destination]}</span>
        </div>
        <div className="quickcopy-hostbar-tabs">
          <button type="button" className={view === "classic" ? "active" : ""} onClick={() => setView("classic")}>기존 사전</button>
          <button type="button" className={view === "sex" ? "active" : ""} onClick={() => setView("sex")}>Sex</button>
          <button className="icon-button" onClick={onClose} aria-label="태그사전 닫기">↓</button>
        </div>
      </div>
      {view === "classic" ? (
        <iframe
          ref={frameRef}
          className="quickcopy-frame"
          src="/quickcopy/index.html"
          onLoad={(event) => openDestinationTab(event.currentTarget, destination)}
          title="Artist / Tag Quick Copy v7"
        />
      ) : (
        <SexTagDictionary onInsert={onInsert} />
      )}
    </div>
  );
}

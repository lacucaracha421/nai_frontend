import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { PromptSectionKey } from "../../types/generation";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
import { favoriteLocalTags } from "./localTagIndex";
import {
  mergePrombotFavorites,
  prombotImportBreakdown,
  prombotImportMessage,
  resolvePrombotTags,
  type PrombotFavoriteCatalog,
} from "../prompt/prombotFavorites";

const DESTINATION_LABEL: Record<PromptSectionKey | "character", string> = {
  artist: "작가",
  other: "장면",
  quality: "품질",
  negative: "제외",
  character: "캐릭터",
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
  const [opening, setOpening] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openPrombot = async () => {
    if (opening) return;
    setOpening(true);
    setMessage(null);
    try {
      await invoke("open_prombot_webview");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    void openPrombot();
    // Open exactly once when the controller sheet is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pasteFromClipboard = async () => {
    if (pasting) return;
    setPasting(true);
    setMessage(null);
    try {
      const text = (await readText()).trim();
      if (!text) {
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

  const importBookmarks = async () => {
    if (importing) return;
    setImporting(true);
    setMessage(null);
    try {
      const rawKeys = await invoke<string[]>("prombot_favorites");
      // Prombot stores a series ☆ as every member of the series; keep only the
      // characters the user bookmarked one by one (see NAI-005).
      const catalog = await invoke<PrombotFavoriteCatalog>("prombot_favorite_catalog", { keys: rawKeys });
      const keys = catalog.characters;
      const resolved = keys.length ? await favoriteLocalTags(keys, ["character"]) : [];
      const incoming = resolvePrombotTags(keys, resolved).map((tag) => ({
        ...tag,
        series: catalog.series[tag.raw],
      }));
      const current = useCharacterLibraryStore.getState().entries;
      const result = mergePrombotFavorites(current, incoming);
      useCharacterLibraryStore.setState({
        entries: result.entries,
        prombotImportSummary: prombotImportBreakdown(catalog),
      });
      setMessage(rawKeys.length
        ? prombotImportMessage(catalog, result.stats)
        : `현재 북마크 0명 · Prombot에서 가져온 캐릭터 ${result.stats.removed}명을 도감에서 제거했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="sheet quickcopy-sheet prombot-sheet">
      <div className="quickcopy-hostbar">
        <div>
          <strong>Prombot Characters</strong>
          <span>삽입 대상 · {DESTINATION_LABEL[destination]}</span>
        </div>
        <div className="prombot-host-actions">
          <button type="button" disabled={pasting} onClick={() => void pasteFromClipboard()}>
            {pasting ? "붙여넣는 중…" : "붙여넣기"}
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Prombot 닫기">↓</button>
        </div>
      </div>
      <div className="prombot-control-body">
        <div className="prombot-control-card">
          <strong>Prombot은 별도 WebView에서 열립니다.</strong>
          <p>Characters에서 ★ 북마크를 모은 뒤 Android 뒤로가기로 돌아와 가져오기를 누르시와요.</p>
          <div className="prombot-control-actions">
            <button type="button" disabled={opening} onClick={() => void openPrombot()}>
              {opening ? "여는 중…" : "Prombot 열기"}
            </button>
            <button type="button" disabled={importing} onClick={() => void importBookmarks()}>
              {importing ? "가져오는 중…" : "★ 북마크 가져오기"}
            </button>
          </div>
        </div>
        {message && <div className="prombot-message" role="status">{message}</div>}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useGenerationStore } from "../../stores/generationStore";
import { useCharacterLibraryStore, type CharacterLibraryEntry } from "../../stores/characterLibraryStore";
import { usePromptHistoryStore } from "../../stores/promptHistoryStore";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import type { GenerationImage, PromptSectionKey } from "../../types/generation";
import { joinPositivePrompt } from "../../adapters/novelai/buildRequest";
import { CharacterSheet } from "../prompt/CharacterSheet";
import { CharacterLibrarySheet } from "../prompt/CharacterLibrarySheet";
import { CharacterStageOverlay } from "../prompt/CharacterStageOverlay";
import { RawPromptSheet } from "../prompt/RawPromptSheet";
import { TagBoard, switchCarriesEditing, type TagBoardTools } from "../prompt/TagBoard";
import { formatTagDiff, promptTagDiff, splitTags, type TagDiff } from "../prompt/tagChips";
import { copyWholePrompt } from "../prompt/promptClipboard";
import { chooseCharacterTag, detectCharacterTagFromPrompt } from "../prompt/characterTag";
import { randomCharacterPool, randomPickLabel } from "../prompt/randomCharacter";
import { QuickCopySheet } from "../tags/QuickCopySheet";
import { PrombotSheet } from "../tags/PrombotSheet";
import type { TagCategory } from "../tags/localTagIndex";
import { SettingsSheet, type SettingsScope } from "../options/SettingsSheet";
import { ImageViewer } from "../../components/ImageViewer";
import { Icon } from "../../components/Icon";
import { readImageBytes, saveImageBytes } from "../../adapters/novelai/client";
import {
  UPSCALE_ANLAS,
  estimateAnlas,
  formatAnlasCost,
  formatUsageHint,
  formatUsageLabel,
} from "../../adapters/novelai/anlas";
import { FinishSupersededError } from "./finish/finishProtocol";
import { finishPreviewSource, finishRunner, imageObjectUrl } from "./finish/finishImage";
import { formatFileSize, prepareSave } from "./save/prepareSave";
import { browserSaveDeps } from "./save/saveDeps";
import { FinishSheet } from "./finish/FinishSheet";
import { useQuotaClock } from "./useQuotaClock";
import { useImageLoader } from "./load/ImageLoadButton";
import { useBackLayer } from "../../app/backStack";
import { classifyEditorSwipe } from "./editorSwipe";
import { useSettledFlag, useVisualViewport } from "./useVisualViewport";

function imageFilename(createdAt: number, seed: number | null, kind: "generation" | "upscale") {
  const date = new Date(createdAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `NovelAI_${stamp}${seed !== null ? `_seed${seed}` : ""}${kind === "upscale" ? "_upscale" : ""}.png`;
}

function savedName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

type SaveState = "idle" | "saving" | "success" | "error";
type Tab = "artist" | "character" | "other" | "fixed";
type FixedPart = "quality" | "negative";
type MenuItem = { label: string; hint?: string; disabled?: boolean; danger?: boolean; onSelect: () => void };

const TABS: { key: Tab; label: string; dot?: string }[] = [
  { key: "artist", label: "작가", dot: "artist" },
  { key: "character", label: "캐릭터", dot: "character" },
  { key: "other", label: "장면", dot: "general" },
  { key: "fixed", label: "품질·제외" },
];

const SECTION_CONFIG: Record<PromptSectionKey, { title: string; categories: TagCategory[]; tagPrefix?: string; placeholder: string }> = {
  artist: { title: "작가", categories: ["artist", "general", "meta"], tagPrefix: "artist:", placeholder: "artist:toma 또는 toma로 검색 가능" },
  other: { title: "장면", categories: ["general", "copyright", "meta"], placeholder: "장면, 행동, 구도, 배경…" },
  quality: { title: "품질", categories: ["general", "meta"], placeholder: "거의 고정해둘 품질 프롬프트" },
  negative: { title: "제외", categories: ["general", "meta"], placeholder: "원하지 않는 요소" },
};
const CHARACTER_CATEGORIES: TagCategory[] = ["character", "general", "copyright", "meta"];

/** Positive prompt of the latest plain generation before `before` (upscales repeat their source prompt). */
function previousGenerationPrompt(images: GenerationImage[], before = images.length) {
  for (let index = Math.min(before, images.length) - 1; index >= 0; index -= 1) {
    if (images[index].kind === "generation") return images[index].positivePrompt;
  }
  return null;
}

function diffWords(diff: TagDiff) {
  return [...diff.added.map((tag) => `+${tag}`), ...diff.removed.map((tag) => `−${tag}`)].join(" ");
}

/** Tap = `onTap`; hold ~0.45 s = `onHold` (no click afterwards). */
function useHold(onTap: () => void, onHold: () => void) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      held.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        held.current = true;
        onHold();
      }, 450);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      onTap();
    },
  };
}

function PrivacyGlyph() {
  return (
    <div className="b2-privacy" aria-hidden="true">
      <Icon name="eyeoff" />
    </div>
  );
}

function MenuSheet({ title, items, onClose }: { title: string; items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="b2-menu-scrim" onClick={onClose}>
      <div className="b2-menu" role="menu" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="b2-menu-title">{title}</div>
        {items.map((item) => (
          <button
            type="button"
            role="menuitem"
            key={item.label}
            className={item.danger ? "danger" : ""}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.hint && <small>{item.hint}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function V5Studio() {
  const artist = useGenerationStore((s) => s.artistPrompt);
  const other = useGenerationStore((s) => s.otherPrompt);
  const quality = useGenerationStore((s) => s.qualityPrompt);
  const negative = useGenerationStore((s) => s.negativePrompt);
  const chars = useGenerationStore((s) => s.characters);
  const addCharacter = useGenerationStore((s) => s.addCharacter);
  const randomCharacterEnabled = useGenerationStore((s) => s.randomCharacterEnabled);
  const setRandomCharacterEnabled = useGenerationStore((s) => s.setRandomCharacterEnabled);
  const keepRandomCharacter = useGenerationStore((s) => s.keepRandomCharacter);
  // Same pool the 🎲 draws from (deduplicated), so the number shown is the number drawn from.
  const randomCharacterCount = useCharacterLibraryStore((s) => randomCharacterPool(s.entries).length);
  const prombotImportSummary = useCharacterLibraryStore((s) => s.prombotImportSummary);
  const settings = useGenerationStore((s) => s.settings);
  const images = useGenerationStore((s) => s.images);
  const active = useGenerationStore((s) => s.activeImage);
  const updateCharacter = useGenerationStore((s) => s.updateCharacter);
  const setPrompt = useGenerationStore((s) => s.setPrompt);
  const status = useGenerationStore((s) => s.status);
  const error = useGenerationStore((s) => s.errorMessage);
  const clearError = useGenerationStore((s) => s.clearError);
  const generate = useGenerationStore((s) => s.generate);
  const useSeed = useGenerationStore((s) => s.useSeed);
  const upscale = useGenerationStore((s) => s.upscaleActive);
  const appendPrompt = useGenerationStore((s) => s.appendPrompt);
  const finishEnabled = useUiStore((s) => s.finishEnabled);
  const finishParams = useUiStore((s) => s.finishParams);
  const saveFormat = useUiStore((s) => s.saveFormat);
  const setFinishEnabled = useUiStore((s) => s.setFinishEnabled);
  const showTagDiff = useUiStore((s) => s.showTagDiff);
  const showHints = useUiStore((s) => s.showHints);
  const connectionStatus = useConnectionStore((s) => s.status);
  const quota = useConnectionStore((s) => s.quota);
  const quotaReceivedAt = useConnectionStore((s) => s.quotaReceivedAt);
  const usageTrack = useConnectionStore((s) => s.usageTrack);
  const quotaStatus = useConnectionStore((s) => s.quotaStatus);
  const refreshQuota = useConnectionStore((s) => s.refreshQuota);
  const checkpoint = usePromptHistoryStore((s) => s.checkpoint);

  const [tab, setTab] = useState<Tab>("other");
  const [fixedPart, setFixedPart] = useState<FixedPart>("quality");
  const [characterId, setCharacterId] = useState<string | null>(chars[0]?.id ?? null);
  const [characterSheet, setCharacterSheet] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [quickCopy, setQuickCopy] = useState<PromptSectionKey | null>(null);
  const [prombot, setPrombot] = useState<PromptSectionKey | "character" | null>(null);
  const [rawEditor, setRawEditor] = useState(false);
  const [settingsScope, setSettingsScope] = useState<SettingsScope | null>(null);
  // Full-screen viewer shows any session image without changing the current one.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewer = viewerIndex !== null;
  const [menu, setMenu] = useState<"prompt" | "viewer" | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [placementId, setPlacementId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveResetTimer = useRef<number | null>(null);
  const [finishPreview, setFinishPreview] = useState<{ key: string; url: string } | null>(null);
  const finishPreviewUrlRef = useRef<string | null>(null);
  const [finishBusy, setFinishBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [imagesHidden, setImagesHidden] = useState(false);
  const loader = useImageLoader();
  const [sideSlot, setSideSlot] = useState<HTMLDivElement | null>(null);
  const viewport = useVisualViewport();
  // Typing (editing) mode, NAI-011: a tag input is open on the board. Only this compacts
  // the header. The keyboard never switches layouts; it only changes the height left for
  // the board (the tool row rides on the keyboard, or sits at the bottom after Back hid it).
  // Leaving waits for the tap to end so the layout never moves under a finger.
  const [boardEditing, setBoardEditing] = useState(false);
  const typing = useSettledFlag(boardEditing);
  // Section switch with the keyboard up keeps editing: the tab's pointerdown keeps focus in
  // the input (no blur, so the IME stays), the click commits the typed tag, switches and
  // mounts the next board with its input focused — all in the same tap. `carryEditing` is
  // true only for the render that mounts that board.
  const boardTools = useRef<TagBoardTools | null>(null);
  const carryTap = useRef(false);
  const carryEditing = useRef(false);
  const startEditingOnMount = carryEditing.current;
  useLayoutEffect(() => {
    carryEditing.current = false;
  });
  const switchPointerDown = (event: { preventDefault: () => void }) => {
    carryTap.current = switchCarriesEditing({ editing: boardEditing, keyboard: viewport.keyboard });
    if (carryTap.current) event.preventDefault();
  };
  const switchSection = (change: () => void) => {
    if (!carryTap.current) {
      change();
      return;
    }
    carryTap.current = false;
    boardTools.current?.flush();
    carryEditing.current = true;
    flushSync(change);
  };
  // User-chosen editor size (session only): swipe up/down on the editor or its handle.
  const [expanded, setExpanded] = useState(false);
  const compactHeader = typing || expanded;
  const swipeStart = useRef<{ x: number; y: number; onHandle: boolean; listAtTop: boolean } | null>(null);

  const showNotice = (text: string, duration = 1800) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), duration);
  };

  const activeCharacter = chars.find((character) => character.id === characterId) ?? chars[0];

  const characterPromptKey = chars
    .map((character) => `${character.id}:${character.enabled ? 1 : 0}:${character.prompt}`)
    .join("␞");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      for (const character of chars) {
        if (cancelled) return;

        if (!character.enabled || !character.prompt.trim()) {
          if (character.name) updateCharacter(character.id, { name: "" });
          continue;
        }

        const detected = await detectCharacterTagFromPrompt(character.prompt);
        if (cancelled) return;

        const current = useGenerationStore
          .getState()
          .characters
          .find((item) => item.id === character.id);
        if (!current || current.prompt !== character.prompt) continue;

        const nextName = detected?.display ?? "";
        if (current.name !== nextName) updateCharacter(character.id, { name: nextName });
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [characterPromptKey, updateCharacter]);

  const quotaNow = useQuotaClock(connectionStatus === "connected", refreshQuota);

  useEffect(() => {
    if (connectionStatus === "connected" && status === "success") {
      void refreshQuota();
    }
  }, [connectionStatus, status, refreshQuota]);

  const selected = images[active];
  const selectedPick = selected?.randomCharacter;
  const selectedPickLabel = selectedPick ? randomPickLabel(selectedPick) : null;
  const viewed = viewerIndex !== null ? images[viewerIndex] : undefined;
  /** The image the 마무리 preview is made for: the one in the viewer, else the current one. */
  const previewTarget = viewed ?? selected;
  const busy = status === "generating" || status === "upscaling";
  const saving = saveState === "saving";
  const previewUrlFor = (image: GenerationImage | undefined) =>
    finishEnabled && image && finishPreview?.key === image.filePath ? finishPreview.url : null;
  const finishPreviewUrl = previewUrlFor(selected);
  const viewerPreviewUrl = previewUrlFor(viewed);
  const finishPending = finishEnabled && !!previewTarget && (finishBusy || !previewUrlFor(previewTarget)) && !finishError;
  const usageLabel = connectionStatus === "connected" ? formatUsageLabel(quota?.usage) : null;
  const usageHint = formatUsageHint(quota?.usage, quotaReceivedAt, quotaNow, usageTrack);
  const cost = connectionStatus === "connected" && quota
    ? estimateAnlas({ width: settings.width, height: settings.height, steps: settings.steps }, quota)
    : undefined;
  const anlasText = quota?.anlas !== null && quota?.anlas !== undefined ? `Anlas ${quota.anlas.toLocaleString()}` : null;

  // Live stage preview: a downscaled copy filtered in the worker; stale slider jobs are dropped.
  useEffect(() => {
    setFinishError(null);
    if (!finishEnabled || !previewTarget || imagesHidden) {
      setFinishBusy(false);
      return;
    }
    let cancelled = false;
    setFinishBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const { preview: source } = await finishPreviewSource(previewTarget);
        const filtered = await finishRunner.run(source, finishParams, { lane: "stage" });
        if (cancelled) return;
        const url = await imageObjectUrl(filtered);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (finishPreviewUrlRef.current) URL.revokeObjectURL(finishPreviewUrlRef.current);
        finishPreviewUrlRef.current = url;
        setFinishPreview({ key: previewTarget.filePath, url });
        setFinishBusy(false);
      } catch (failure) {
        if (cancelled || failure instanceof FinishSupersededError) return;
        setFinishError(failure instanceof Error ? failure.message : String(failure));
        setFinishBusy(false);
      }
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [finishEnabled, finishParams, previewTarget, imagesHidden]);

  useEffect(() => () => {
    if (finishPreviewUrlRef.current) URL.revokeObjectURL(finishPreviewUrlRef.current);
  }, []);

  useEffect(() => () => {
    if (saveResetTimer.current !== null) window.clearTimeout(saveResetTimer.current);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  const toggleRandomCharacter = () => {
    if (!randomCharacterEnabled && !randomCharacterCount) {
      showNotice("Prombot 북마크를 먼저 가져오시와요.", 2200);
      setPrombot("character");
      return;
    }
    const next = !randomCharacterEnabled;
    setRandomCharacterEnabled(next);
    showNotice(next ? `랜덤 캐릭터 ON · ${randomCharacterCount}명` : "랜덤 캐릭터 OFF", 1600);
  };

  const settleSaveState = (next: SaveState, delay: number) => {
    setSaveState(next);
    if (saveResetTimer.current !== null) window.clearTimeout(saveResetTimer.current);
    saveResetTimer.current = window.setTimeout(() => setSaveState("idle"), delay);
  };

  const saveImage = async (image: GenerationImage | undefined) => {
    const selected = image;
    if (!selected || saving) return;
    if (saveResetTimer.current !== null) window.clearTimeout(saveResetTimer.current);
    setSaveState("saving");
    setNotice(null);
    try {
      const original = await readImageBytes(selected.src);
      // The cached original is only read; WebP and filtered copies are new files with the NovelAI metadata.
      const prepared = await prepareSave(
        {
          original,
          baseName: imageFilename(selected.createdAt, selected.seed, selected.kind),
          format: saveFormat,
          finish: finishEnabled ? finishParams : null,
        },
        browserSaveDeps,
      );
      const target = await saveImageBytes(prepared.bytes, prepared.filename);
      settleSaveState("success", 1600);
      const size = formatFileSize(prepared.bytes.length);
      showNotice(
        prepared.fallback
          ? `WebP 변환에 실패해 PNG로 저장했습니다 · ${size}`
          : `저장됨 · ${savedName(target)} · ${size}`,
        prepared.fallback ? 3600 : 2400,
      );
    } catch (saveError) {
      settleSaveState("error", 2600);
      useGenerationStore.setState({
        status: "error",
        errorMessage: `저장 실패: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
      });
    }
  };

  const copyViewedPrompt = async () => {
    if (!viewed) return;
    try {
      await navigator.clipboard.writeText(viewed.positivePrompt);
      showNotice("프롬프트를 복사했습니다");
    } catch {
      showNotice("복사하지 못했습니다");
    }
  };

  // ---- Current editor section --------------------------------------------------------
  const section: PromptSectionKey | null = tab === "character" ? null : tab === "fixed" ? fixedPart : tab;
  const sectionValue = section === "artist"
    ? artist
    : section === "other"
      ? other
      : section === "quality"
        ? quality
        : section === "negative"
          ? negative
          : activeCharacter?.prompt ?? "";
  const historyKey = section ? `prompt:${section}` : `character:${activeCharacter?.id ?? "none"}:prompt`;
  const sectionTitle = section ? SECTION_CONFIG[section].title : "캐릭터";
  const activeCharacterId = activeCharacter?.id;
  const setSectionValue = useCallback((next: string) => {
    if (section) setPrompt(section, next);
    else if (activeCharacterId) updateCharacter(activeCharacterId, { prompt: next });
  }, [section, activeCharacterId, setPrompt, updateCharacter]);

  const checkpointCharacter = () => {
    if (!activeCharacter) return;
    checkpoint(`character:${activeCharacter.id}:prompt`, {
      value: activeCharacter.prompt,
      selectionStart: activeCharacter.prompt.length,
      selectionEnd: activeCharacter.prompt.length,
      activeIndex: splitTags(activeCharacter.prompt).length,
    });
  };

  const insertIntoCharacter = (text: string) => {
    if (!activeCharacter) return;
    const clean = text.trim();
    if (!clean) return;
    checkpointCharacter();
    const prompt = activeCharacter.prompt.trim()
      ? `${activeCharacter.prompt.trim().replace(/,\s*$/, "")}, ${clean}`
      : clean;
    updateCharacter(activeCharacter.id, { prompt });
  };

  const selectFromLibrary = (entry: CharacterLibraryEntry) => {
    if (!activeCharacter) return;
    checkpointCharacter();
    updateCharacter(activeCharacter.id, {
      name: entry.display,
      prompt: chooseCharacterTag(activeCharacter.prompt, activeCharacter.name, entry.display),
    });
    setLibraryOpen(false);
  };

  const openDictionary = () => {
    if (section) setQuickCopy(section);
    else setLibraryOpen(true);
  };

  const copySection = async () => {
    try {
      await copyWholePrompt(sectionValue, writeText);
      showNotice(`${sectionTitle} 전체를 복사했습니다`);
    } catch {
      showNotice("복사하지 못했습니다");
    }
  };

  const clearSection = () => {
    if (!sectionValue) return;
    checkpoint(historyKey, { value: sectionValue, selectionStart: 0, selectionEnd: sectionValue.length });
    setSectionValue("");
    showNotice(`${sectionTitle} 비움 · 되돌리기로 복구`, 2200);
  };

  // ---- Diff against the last generation ---------------------------------------------
  const currentPositive = joinPositivePrompt({ artistPrompt: artist, otherPrompt: other, qualityPrompt: quality });
  const lastPrompt = previousGenerationPrompt(images);
  const diff = useMemo(() => promptTagDiff(lastPrompt, currentPositive), [lastPrompt, currentPositive]);
  const diffLabel = formatTagDiff(diff);
  const viewerDiff = viewed && viewerIndex !== null ? promptTagDiff(previousGenerationPrompt(images, viewerIndex), viewed.positivePrompt) : null;

  // ---- Status pill -------------------------------------------------------------------
  const overLimit = quota?.usage?.isNegative === true;
  const statusPrimary = connectionStatus !== "connected"
    ? "연결 안 됨"
    : quotaStatus === "loading" && !quota
      ? "확인 중…"
      : cost === 0
        ? "무료 생성"
        : overLimit
          ? "한도 초과"
          : anlasText ?? "Anlas —";
  const statusSecondary = [
    usageLabel && !overLimit ? usageLabel.replace("사용 ", "") : null,
    statusPrimary !== anlasText ? anlasText : null,
  ].filter(Boolean).join(" · ");
  const statusTone = connectionStatus !== "connected" ? "off" : cost === 0 ? "free" : overLimit ? "warn" : "paid";
  const costLine = busy || cost === undefined ? null : cost === 0 ? "무료 · 한도 내" : formatAnlasCost(cost);

  const saveLabel = saveState === "saving" ? (
    <><span className="save-spinner" aria-hidden="true" />저장 중</>
  ) : saveState === "success" ? (
    <><svg className="save-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>저장됨</>
  ) : saveState === "error" ? (
    <>! 저장 실패</>
  ) : (
    <><Icon name="save" />{finishEnabled ? "저장 · 마무리" : "저장"}</>
  );

  const generateNow = (tools?: TagBoardTools) => {
    tools?.flush();
    void generate().then(() => {
      // The 🎲 pick only exists in the request, so name it wherever the user is.
      const state = useGenerationStore.getState();
      const pick = state.status === "success" ? state.images[state.activeImage]?.randomCharacter : undefined;
      if (pick) showNotice(`🎲 ${randomPickLabel(pick).name}`, 2400);
    });
  };

  const upscaleViewed = async () => {
    if (viewerIndex === null) return;
    const before = useGenerationStore.getState().images.length;
    await upscale(viewerIndex);
    const after = useGenerationStore.getState().images;
    // Show the new upscaled copy in the viewer (it also becomes the current image, as before).
    if (after.length > before && after[after.length - 1].kind === "upscale") setViewerIndex(after.length - 1);
  };

  const setViewer = (open: boolean) => setViewerIndex(open ? active : null);

  const togglePrivacy = () => {
    const next = !imagesHidden;
    setImagesHidden(next);
    if (next) setViewer(false);
  };

  // The current image is the big thumbnail; the row holds the rest, newest first.
  const sessionOthers = images
    .map((image, index) => ({ image, index }))
    .filter(({ index }) => index !== active)
    .reverse();

  const thumbSrc = selected ? finishPreviewUrl || selected.src : null;
  const aspect = selected ? `${selected.width} / ${selected.height}` : `${settings.width} / ${settings.height}`;

  const currentThumb = (small: boolean) => (
    <button
      type="button"
      className={`b2-thumb ${small ? "small" : ""}`}
      style={{ aspectRatio: aspect }}
      disabled={!selected || imagesHidden}
      aria-label="이미지 크게 보기"
      onClick={() => { if (selected && !imagesHidden) setViewer(true); }}
    >
      {/* Nothing is drawn over the image; progress shows on 생성, upscale state in the viewer. */}
      {selected && !imagesHidden && thumbSrc && <img src={thumbSrc} alt="" />}
      {selected && imagesHidden && <PrivacyGlyph />}
      {!selected && <span className={`b2-thumb-empty ${status === "generating" ? "pulse" : ""}`} aria-hidden="true">🖼️</span>}
    </button>
  );

  const tabs = (
    <div className="b2-tabs" role="tablist" aria-label="프롬프트 구역">
      {TABS.map((item) => {
        const count = item.key === "artist"
          ? splitTags(artist).length
          : item.key === "other"
            ? splitTags(other).length
            : item.key === "character"
              ? chars.filter((character) => character.enabled && character.prompt.trim()).length
              : 0;
        return (
          <button
            type="button"
            role="tab"
            key={item.key}
            aria-selected={tab === item.key}
            className={tab === item.key ? "active" : ""}
            onPointerDown={switchPointerDown}
            onClick={() => switchSection(() => setTab(item.key))}
          >
            {item.dot && <span className={`tag-dot ${item.dot}`} />}
            {item.label}
            {count > 0 && <small>{count}</small>}
          </button>
        );
      })}
    </div>
  );

  const characterRow = tab === "character" && (
    <div className="b2-character-row">
      <div className="b2-character-pills">
        {chars.map((character, index) => (
          <button
            type="button"
            key={character.id}
            className={`${activeCharacter?.id === character.id ? "active" : ""} ${character.enabled ? "" : "disabled"}`}
            onPointerDown={switchPointerDown}
            onClick={() => switchSection(() => setCharacterId(character.id))}
          >
            <span className="b2-character-index">{index + 1}</span>
            {character.name || `캐릭터 ${index + 1}`}
          </button>
        ))}
        <button
          type="button"
          className="b2-character-add"
          aria-label="캐릭터 추가"
          onClick={() => {
            addCharacter();
            const next = useGenerationStore.getState().characters;
            setCharacterId(next[next.length - 1]?.id ?? null);
          }}
        >
          <Icon name="plus" />
        </button>
      </div>
      <button
        type="button"
        className={`b2-random ${randomCharacterEnabled ? "active" : ""}`}
        aria-pressed={randomCharacterEnabled}
        onClick={toggleRandomCharacter}
      >
        <Icon name="dice" />랜덤{randomCharacterEnabled ? ` · ${randomCharacterCount}명` : ""}
      </button>
      <button type="button" className="b2-character-settings" onClick={() => setCharacterSheet(true)}>
        <Icon name="sliders" />설정
      </button>
    </div>
  );

  const boardHeader = (
    <>
      {characterRow}
      {tab === "character" && (randomCharacterEnabled || selectedPick) && (
        <div className="b2-random-pick" aria-live="polite">
          <span className="b2-random-pick-icon" aria-hidden="true"><Icon name="dice" /></span>
          {selectedPick && selectedPickLabel ? (
            <span className="b2-random-pick-text">
              <small>{randomCharacterEnabled ? "지금 이미지 캐릭터" : "이 이미지는 🎲로 뽑은 캐릭터"}</small>
              <strong>{selectedPickLabel.name}</strong>
              {selectedPickLabel.series && <em>{selectedPickLabel.series}</em>}
            </span>
          ) : (
            <span className="b2-random-pick-text">
              <small>랜덤 캐릭터</small>
              <strong>생성하면 뽑아서 여기 보여드려요</strong>
            </span>
          )}
          {selectedPick && selectedPickLabel && (
            <button type="button" onClick={() => void keepRandomCharacter(selectedPick).then(() => showNotice(`${selectedPickLabel.name} 고정 · 랜덤 OFF`, 1800))}>
              이 캐릭터로 고정
            </button>
          )}
        </div>
      )}
      {showHints && tab === "character" && randomCharacterEnabled && (
        <p className="b2-random-note">
          🎲 생성할 때마다 첫 캐릭터의 캐릭터 태그만 북마크 {randomCharacterCount}명 중 하나로 바뀝니다 · 다시 뽑으려면 생성
          {prombotImportSummary ? <><br />마지막 가져오기: {prombotImportSummary}</> : null}
        </p>
      )}
      {tab === "fixed" && (
        <div className="b2-fixed-switch" role="tablist" aria-label="품질 또는 제외">
          <button type="button" role="tab" aria-selected={fixedPart === "quality"} className={fixedPart === "quality" ? "active" : ""} onPointerDown={switchPointerDown} onClick={() => switchSection(() => setFixedPart("quality"))}>
            품질 <small>{splitTags(quality).length}</small>
          </button>
          <button type="button" role="tab" aria-selected={fixedPart === "negative"} className={fixedPart === "negative" ? "active" : ""} onPointerDown={switchPointerDown} onClick={() => switchSection(() => setFixedPart("negative"))}>
            제외 <small>{splitTags(negative).length}</small>
          </button>
        </div>
      )}
      {!typing && (showHints || (showTagDiff && diffLabel)) && (
        <div className="b2-board-hint">
          <span>{showHints ? "누르면 선택 · 한 번 더 누르면 수정" : ""}</span>
          {showTagDiff && diffLabel && diff && (
            <button type="button" className={`b2-diff-chip ${diffOpen ? "open" : ""}`} aria-expanded={diffOpen} onClick={() => setDiffOpen(!diffOpen)}>
              직전 대비 <b className="plus">+{diff.added.length}</b> <b className="minus">−{diff.removed.length}</b>
            </button>
          )}
        </div>
      )}
      {!typing && showTagDiff && diffOpen && diff && diffLabel && (
        <div className="b2-diff-panel">
          {diff.added.map((tag, index) => <span key={`a${index}`} className="plus">+{tag}</span>)}
          {diff.removed.map((tag, index) => <span key={`r${index}`} className="minus">−{tag}</span>)}
        </div>
      )}
    </>
  );

  const promptMenuItems: MenuItem[] = [
    { label: "Prombot", hint: `${sectionTitle}에 넣기`, onSelect: () => setPrombot(section ?? "character") },
    { label: "전체 복사", hint: sectionTitle, disabled: !sectionValue, onSelect: () => void copySection() },
    { label: "텍스트로 편집", hint: "쉼표·줄바꿈·부분 가중치까지 그대로", onSelect: () => setRawEditor(true) },
    { label: loader.loading ? "읽는 중…" : "불러오기", hint: "이미지의 프롬프트·설정 적용", disabled: loader.loading, onSelect: loader.pick },
    ...(tab === "character" ? [{ label: "캐릭터 설정", hint: "위치 · 사용 · 캐릭터 제외 · 삭제", onSelect: () => setCharacterSheet(true) }] : []),
    { label: "전체 지우기", hint: `${sectionTitle} · 되돌리기로 복구`, danger: true, disabled: !sectionValue, onSelect: clearSection },
  ];

  const viewerMenuItems: MenuItem[] = [
    { label: "프롬프트 복사", hint: "이 이미지의 기본 프롬프트", onSelect: () => void copyViewedPrompt() },
    {
      label: "이 설정 불러오기",
      hint: "이 이미지의 프롬프트·캐릭터·설정 적용",
      disabled: !viewed || loader.loading,
      onSelect: () => { if (viewed) void loader.loadBytes(() => readImageBytes(viewed.src)); },
    },
    { label: "마무리 조절", hint: "프리셋 · 세부 조절", onSelect: () => setFinishOpen(true) },
  ];

  // Android Back closes the topmost of these (see app/backStack.ts).
  useBackLayer(menu !== null, () => setMenu(null));
  useBackLayer(settingsScope !== null, () => setSettingsScope(null));
  useBackLayer(quickCopy !== null, () => setQuickCopy(null));
  useBackLayer(prombot !== null, () => setPrombot(null));
  useBackLayer(characterSheet, () => setCharacterSheet(false));
  useBackLayer(libraryOpen, () => setLibraryOpen(false));
  useBackLayer(rawEditor, () => setRawEditor(false));
  useBackLayer(placementId !== null, () => setPlacementId(null));
  useBackLayer(finishOpen, () => setFinishOpen(false));
  useBackLayer(diffOpen, () => setDiffOpen(false));
  useBackLayer(viewer && !imagesHidden, () => setViewer(false));
  useBackLayer(expanded, () => setExpanded(false));

  const finishHold = useHold(() => setFinishEnabled(!finishEnabled), () => setFinishOpen(true));
  const seedFixed = !!viewed && viewed.seed !== null && settings.seed === viewed.seed;
  const upscaleBlocked = !viewed || viewed.width * viewed.height > 1024 * 1024 || busy;

  const viewedPick = viewed?.randomCharacter ? randomPickLabel(viewed.randomCharacter) : null;
  const viewerMeta = viewed && (
    <>
      {viewedPick && (
        <span className="viewer-random">🎲 <b>{viewedPick.name}</b>{viewedPick.series && ` · ${viewedPick.series}`}</span>
      )}
      {viewed.seed !== null && <span>Seed {viewed.seed}</span>}
      <span>{viewed.width}×{viewed.height}</span>
      {viewed.kind === "upscale" && <span>업스케일</span>}
      {showTagDiff && viewerDiff && formatTagDiff(viewerDiff) && <span className="viewer-diff">직전 대비 {diffWords(viewerDiff)}</span>}
    </>
  );

  const viewerActions = viewed && (
    <>
      <button type="button" className={`viewer-save save-button ${saveState}`} disabled={saving} aria-live="polite" onClick={() => void saveImage(viewed)}>
        {saveLabel}
      </button>
      <button type="button" className={`viewer-finish ${finishEnabled ? "active" : ""}`} aria-pressed={finishEnabled} {...finishHold}>
        {finishPending ? <span className="finish-busy" aria-hidden="true" /> : <Icon name="sparkle" />}
        마무리{finishEnabled ? (finishError ? " !" : " ON") : ""}
      </button>
      <button
        type="button"
        className={seedFixed ? "active" : ""}
        aria-pressed={seedFixed}
        disabled={viewed.seed === null}
        onClick={() => {
          if (seedFixed) {
            useSeed(null);
            showNotice("Seed 랜덤으로 돌아갑니다");
          } else {
            useSeed(viewed.seed);
            showNotice(`Seed ${viewed.seed} 고정`);
          }
        }}
      >
        <Icon name="seed" />{seedFixed ? "Seed 고정됨" : "Seed"}
      </button>
      <button type="button" disabled={upscaleBlocked} onClick={() => void upscaleViewed()}>
        <Icon name="upscale" />{status === "upscaling" ? "업스케일 중…" : "업스케일"} <small>{formatAnlasCost(UPSCALE_ANLAS)}</small>
      </button>
      <button type="button" className="viewer-more" aria-label="더 보기" onClick={() => setMenu("viewer")}><Icon name="more" /></button>
    </>
  );

  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  const generateLabel = status === "generating" ? "생성 중…" : status === "upscaling" ? "업스케일 중…" : "생성";

  // Typing mode: one row above the keyboard. Normal mode: the image-side button grid
  // (rendered into the top band through a portal, so 번역 still reaches the board)
  // and a bottom row with undo/redo + 생성.
  const bottomRow = (tools: TagBoardTools) => (
    <div className="b2-bottom">
      <button type="button" className="b2-history" aria-label="되돌리기" disabled={!tools.canUndo} onClick={tools.undo}>
        <Icon name="undo" />
      </button>
      <button type="button" className="b2-history" aria-label="다시 실행" disabled={!tools.canRedo} onClick={tools.redo}>
        <Icon name="redo" />
      </button>
      <button type="button" className="b2-generate" disabled={busy} onClick={() => generateNow(tools)}>
        <strong>{generateLabel}</strong>
        {costLine && <small>{costLine}</small>}
      </button>
    </div>
  );

  const renderTools = (tools: TagBoardTools) => typing ? (
    <div className="b2-tools compact">
      <button type="button" className="num" disabled={!tools.canWeight} onPointerDown={keepFocus} onClick={() => tools.weight(-0.1)}>−0.1</button>
      <button type="button" className="num" disabled={!tools.canWeight} onPointerDown={keepFocus} onClick={() => tools.weight(0.1)}>+0.1</button>
      {/* No keepFocus: opening the dictionary commits the typed tag and ends editing,
          so the keyboard never stays up over the sheet typing into a hidden input. */}
      <button type="button" onClick={openDictionary}>
        <Icon name="book" />사전
      </button>
      <button type="button" data-keeps-selection disabled={!tools.canTranslate || tools.translating} onPointerDown={keepFocus} onClick={tools.translate}>
        <Icon name="translate" />{tools.translating ? "번역 중…" : "번역"}
      </button>
      <button type="button" className="icon-only" aria-label="되돌리기" disabled={!tools.canUndo} onPointerDown={keepFocus} onClick={tools.undo}>
        <Icon name="undo" />
      </button>
      <button type="button" className="icon-only" aria-label="다시 실행" disabled={!tools.canRedo} onPointerDown={keepFocus} onClick={tools.redo}>
        <Icon name="redo" />
      </button>
      <span className="b2-tools-spacer" />
      <button type="button" className="b2-generate-mini" disabled={busy} onPointerDown={keepFocus} onClick={() => generateNow(tools)}>
        {generateLabel}
      </button>
    </div>
  ) : expanded ? (
    <>
      <div className="b2-tools">
        <button type="button" className="icon-only" aria-label="생성 설정" onClick={() => setSettingsScope("generation")}><Icon name="sliders" /></button>
        <button type="button" onClick={openDictionary}><Icon name="book" />태그사전</button>
        <button type="button" data-keeps-selection disabled={!tools.canTranslate || tools.translating} onClick={tools.translate}>
          <Icon name="translate" />{tools.translating ? "번역 중…" : "번역"}
        </button>
        <button type="button" className="icon-only" aria-label="더 보기" onClick={() => setMenu("prompt")}><Icon name="more" /></button>
        <span className="b2-tools-spacer" />
        <button type="button" className={`b2-save b2-save-inline save-button ${saveState}`} disabled={!selected || saving} aria-live="polite" onClick={() => void saveImage(selected)}>
          {saveLabel}
        </button>
      </div>
      {bottomRow(tools)}
    </>
  ) : (
    <>
      {sideSlot && createPortal(
        <div className="b2-side-grid">
          <button type="button" className="b2-side-settings" onClick={() => setSettingsScope("generation")}>
            <Icon name="sliders" />
            <span>
              <strong>생성 설정</strong>
              <small>{settings.width}×{settings.height} · {settings.steps} · CFG {settings.guidance}{settings.seed !== null ? " · Seed 고정" : ""}</small>
            </span>
          </button>
          <button type="button" onClick={openDictionary}><Icon name="book" />태그사전</button>
          <button type="button" data-keeps-selection disabled={!tools.canTranslate || tools.translating} onClick={tools.translate}>
            <Icon name="translate" />{tools.translating ? "번역 중…" : "번역"}
          </button>
          <button type="button" className="b2-side-more" onClick={() => setMenu("prompt")}><Icon name="more" />더 보기</button>
          <button type="button" className={`b2-save save-button ${saveState}`} disabled={!selected || saving} aria-live="polite" onClick={() => void saveImage(selected)}>
            {saveLabel}
          </button>
        </div>,
        sideSlot,
      )}
      {bottomRow(tools)}
    </>
  );

  const boardConfig = section ? SECTION_CONFIG[section] : null;

  return (
    <main
      className={`b2-shell ${typing ? "compact" : ""} ${expanded && !typing ? "expanded" : ""} ${viewport.keyboard ? "keyboard" : ""}`}
      style={viewport.pinned ? { "--vv-height": `${viewport.height}px`, "--vv-top": `${viewport.top}px` } as CSSProperties : undefined}
    >
      {compactHeader ? (
        <header className="b2-top compact">
          {currentThumb(true)}
          {tabs}
        </header>
      ) : (
        <header className="b2-top">
          <div className="b2-top-row">
            <button
              type="button"
              className={`b2-status ${statusTone}`}
              onClick={() => (connectionStatus === "connected" ? void refreshQuota() : setSettingsScope("app"))}
              aria-label={connectionStatus === "connected" ? "사용량 새로고침" : "NovelAI 연결 설정"}
            >
              <span className="b2-status-dot" aria-hidden="true" />
              <span className="b2-status-text">
                <span className="b2-status-line">
                  <strong>{statusPrimary}</strong>
                  {statusSecondary && <span>· {statusSecondary}</span>}
                </span>
                {usageHint && <small>{usageHint}</small>}
              </span>
            </button>
            <span className="b2-top-spacer" />
            <button type="button" className={`b2-icon ${imagesHidden ? "active" : ""}`} aria-label={imagesHidden ? "이미지 표시" : "이미지 숨기기"} onClick={togglePrivacy}>
              <Icon name={imagesHidden ? "eyeoff" : "eye"} />
            </button>
            <button type="button" className="b2-icon" aria-label="앱 설정" onClick={() => setSettingsScope("app")}>
              <Icon name="cog" />
            </button>
          </div>
          <div className="b2-image-row">
            {currentThumb(false)}
            <div className="b2-image-side">
              <div className={`b2-session ${imagesHidden ? "privacy-hidden" : ""}`} aria-label="이번 세션 이미지">
                {sessionOthers.map(({ image, index }) => (
                  <button type="button" key={`${image.createdAt}-${index}`} onClick={() => { if (!imagesHidden) setViewerIndex(index); }} aria-label={`세션 이미지 ${index + 1}${image.randomCharacter ? ` (🎲 ${randomPickLabel(image.randomCharacter).name})` : ""} 크게 보기`}>
                    {imagesHidden ? <PrivacyGlyph /> : <img src={image.src} alt="" />}
                    {image.kind === "upscale" && <span className="b2-up-badge">UP</span>}
                  </button>
                ))}
              </div>
              <div className="b2-side-slot" ref={setSideSlot} />
            </div>
          </div>
          {tabs}
        </header>
      )}

      <section
        className="b2-editor"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          const target = event.target as HTMLElement;
          // Typing, multi-touch and text fields keep their own gestures.
          if (typing || event.touches.length > 1 || !touch || target.closest("input, textarea")) {
            swipeStart.current = null;
            return;
          }
          const list = event.currentTarget.querySelector(".tag-board-scroll");
          swipeStart.current = {
            x: touch.clientX,
            y: touch.clientY,
            onHandle: !!target.closest(".b2-handle"),
            listAtTop: !list || list.scrollTop <= 0,
          };
        }}
        onTouchEnd={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const result = classifyEditorSwipe({
            dx: touch.clientX - start.x,
            dy: touch.clientY - start.y,
            expanded,
            listAtTop: start.listAtTop,
            onHandle: start.onHandle,
          });
          if (result === "expand") setExpanded(true);
          if (result === "collapse") setExpanded(false);
        }}
        onTouchCancel={() => { swipeStart.current = null; }}
      >
        {!typing && (
          <button
            type="button"
            className="b2-handle"
            aria-label={expanded ? "이미지 크게 보기로 돌아가기" : "편집 영역 넓히기"}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <span aria-hidden="true" />
          </button>
        )}
        <TagBoard
          key={historyKey}
          value={sectionValue}
          onChange={setSectionValue}
          historyKey={historyKey}
          categories={boardConfig?.categories ?? CHARACTER_CATEGORIES}
          tagPrefix={boardConfig?.tagPrefix}
          placeholder={showHints ? boardConfig?.placeholder ?? "캐릭터 외형과 의상 태그" : undefined}
          onSelectTag={section ? undefined : (tag) => {
            if (tag.category === "character" && activeCharacter) updateCharacter(activeCharacter.id, { name: tag.display });
          }}
          header={boardHeader}
          renderTools={(tools) => {
            boardTools.current = tools;
            return renderTools(tools);
          }}
          onEditingChange={setBoardEditing}
          startEditing={startEditingOnMount}
        />
      </section>


      {error && <div className="error-toast b2-toast"><span>{error}</span><button onClick={clearError} aria-label="닫기">×</button></div>}
      {notice && <div className="success-toast b2-toast"><span>{notice}</span></div>}
      {loader.element}

      {placementId && (
        <div className="b2-placement">
          <div
            className="image-render-surface positioning"
            style={{
              aspectRatio: aspect,
              "--hw": selected ? selected.height / selected.width : settings.height / settings.width,
            } as CSSProperties}
          >
            {selected && !imagesHidden ? <img src={selected.src} alt="" /> : <div className="b2-placement-blank" />}
            <CharacterStageOverlay
              characters={chars}
              selectedId={placementId}
              onSelect={setPlacementId}
              onMove={(id, x, y) => updateCharacter(id, { position: { x, y } })}
              onDone={() => setPlacementId(null)}
            />
          </div>
        </div>
      )}

      {characterSheet && (
        <CharacterSheet
          onClose={() => setCharacterSheet(false)}
          onPlaceOnImage={(id) => {
            setCharacterSheet(false);
            setPlacementId(id);
          }}
        />
      )}
      {libraryOpen && <CharacterLibrarySheet onClose={() => setLibraryOpen(false)} onSelect={selectFromLibrary} />}
      {quickCopy && <QuickCopySheet destination={quickCopy} onClose={() => setQuickCopy(null)} onInsert={(value) => appendPrompt(quickCopy, value)} />}
      {prombot && (
        <PrombotSheet
          destination={prombot}
          onClose={() => setPrombot(null)}
          onInsert={(value) => (prombot === "character" ? insertIntoCharacter(value) : appendPrompt(prombot, value))}
        />
      )}
      {rawEditor && (
        <RawPromptSheet
          title={sectionTitle}
          value={sectionValue}
          historyKey={historyKey}
          onChange={setSectionValue}
          onClose={() => setRawEditor(false)}
        />
      )}
      {settingsScope && <SettingsSheet scope={settingsScope} onClose={() => setSettingsScope(null)} />}
      {viewer && !imagesHidden && (
        <ImageViewer
          images={images}
          index={viewerIndex ?? active}
          onIndex={setViewerIndex}
          onClose={() => setViewer(false)}
          displaySrc={viewerPreviewUrl}
          topRight={(
            <button type="button" className="viewer-round" aria-label="이미지 숨기기" onClick={togglePrivacy}>
              <Icon name="eye" />
            </button>
          )}
          meta={viewerMeta}
          actions={viewerActions}
        />
      )}
      {finishOpen && <FinishSheet image={previewTarget} busy={finishPending} onClose={() => setFinishOpen(false)} />}
      {menu === "prompt" && <MenuSheet title={`${sectionTitle} · 더 보기`} items={promptMenuItems} onClose={() => setMenu(null)} />}
      {menu === "viewer" && <MenuSheet title="이미지 · 더 보기" items={viewerMenuItems} onClose={() => setMenu(null)} />}
    </main>
  );
}

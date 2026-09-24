import { useEffect, useRef, useState } from "react";
import { useGenerationStore } from "../../stores/generationStore";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import type { PromptSectionKey } from "../../types/generation";
import { PromptSheet } from "../prompt/PromptSheet";
import { CharacterSheet } from "../prompt/CharacterSheet";
import { CharacterStageOverlay } from "../prompt/CharacterStageOverlay";
import { QuickCopySheet } from "../tags/QuickCopySheet";
import { PrombotSheet } from "../tags/PrombotSheet";
import { SettingsSheet } from "../options/SettingsSheet";
import { ImageViewer } from "../../components/ImageViewer";
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
import { ImageLoadButton } from "./load/ImageLoadButton";
import { detectCharacterTagFromPrompt, normalizedCharacterTag } from "../prompt/characterTag";

function preview(text: string) {
  const trimmed = text.trim();
  return trimmed || "비어 있음";
}

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

function characterPromptPreview(characters: ReturnType<typeof useGenerationStore.getState>["characters"]) {
  const registered = characters.filter((character) => character.enabled && character.prompt.trim());
  if (!registered.length) return "";

  const names = registered.map((character, index) => {
    const prompt = normalizedCharacterTag(character.prompt);
    const detectedName = normalizedCharacterTag(character.name);
    if (detectedName && prompt.includes(detectedName)) return character.name;
    return `미지정 ${index + 1}`;
  });

  return `${registered.length}명 · ${names.join(", ")}`;
}


function PromptCard({ title, value, onOpen, className = "" }: { title: string; value: string; onOpen: () => void; className?: string }) {
  const startY = useRef<number | null>(null);
  return (
    <button
      className={`prompt-card ${className}`}
      onClick={onOpen}
      onPointerDown={(event) => { startY.current = event.clientY; }}
      onPointerUp={(event) => {
        if (startY.current !== null && startY.current - event.clientY > 36) onOpen();
        startY.current = null;
      }}
    >
      <span>{title}</span><p>{preview(value)}</p><b>⌃</b>
    </button>
  );
}

export function V5Studio() {
  const artist = useGenerationStore((s) => s.artistPrompt);
  const other = useGenerationStore((s) => s.otherPrompt);
  const quality = useGenerationStore((s) => s.qualityPrompt);
  const negative = useGenerationStore((s) => s.negativePrompt);
  const chars = useGenerationStore((s) => s.characters);
  const randomCharacterEnabled = useGenerationStore((s) => s.randomCharacterEnabled);
  const setRandomCharacterEnabled = useGenerationStore((s) => s.setRandomCharacterEnabled);
  const lastRandomCharacter = useGenerationStore((s) => s.lastRandomCharacter);
  const randomCharacterCount = useCharacterLibraryStore((s) =>
    s.entries.reduce((count, entry) => count + (entry.prombotFavorite ? 1 : 0), 0),
  );
  const settings = useGenerationStore((s) => s.settings);
  const images = useGenerationStore((s) => s.images);
  const active = useGenerationStore((s) => s.activeImage);
  const setActive = useGenerationStore((s) => s.setActiveImage);
  const updateCharacter = useGenerationStore((s) => s.updateCharacter);
  const status = useGenerationStore((s) => s.status);
  const error = useGenerationStore((s) => s.errorMessage);
  const clearError = useGenerationStore((s) => s.clearError);
  const generate = useGenerationStore((s) => s.generate);
  const useSeed = useGenerationStore((s) => s.useSeed);
  const upscale = useGenerationStore((s) => s.upscaleActive);
  const appendPrompt = useGenerationStore((s) => s.appendPrompt);
  const showFixed = useUiStore((s) => s.showFixedPrompts);
  const finishEnabled = useUiStore((s) => s.finishEnabled);
  const finishParams = useUiStore((s) => s.finishParams);
  const saveFormat = useUiStore((s) => s.saveFormat);
  const setFinishEnabled = useUiStore((s) => s.setFinishEnabled);
  const setShowFixed = useUiStore((s) => s.setShowFixedPrompts);
  const connectionStatus = useConnectionStore((s) => s.status);
  const quota = useConnectionStore((s) => s.quota);
  const quotaStatus = useConnectionStore((s) => s.quotaStatus);
  const refreshQuota = useConnectionStore((s) => s.refreshQuota);

  const [sheet, setSheet] = useState<PromptSectionKey | null>(null);
  const [characters, setCharacters] = useState(false);
  const [quickCopy, setQuickCopy] = useState<PromptSectionKey | null>(null);
  const [prombot, setPrombot] = useState<PromptSectionKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [placementId, setPlacementId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveResetTimer = useRef<number | null>(null);
  const [finishPreview, setFinishPreview] = useState<{ key: string; url: string } | null>(null);
  const finishPreviewUrlRef = useRef<string | null>(null);
  const [finishBusy, setFinishBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const finishLongPressTimer = useRef<number | null>(null);
  const finishLongPressed = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [imagesHidden, setImagesHidden] = useState(false);

  const characterPromptKey = chars
    .map((character) => `${character.id}:${character.enabled ? 1 : 0}:${character.prompt}`)
    .join("\u241e");

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



  useEffect(() => {
    if (connectionStatus !== "connected") return;
    void refreshQuota();
    const timer = window.setInterval(() => void refreshQuota(), 60_000);
    return () => window.clearInterval(timer);
  }, [connectionStatus, refreshQuota]);

  useEffect(() => {
    if (connectionStatus === "connected" && status === "success") {
      void refreshQuota();
    }
  }, [connectionStatus, status, refreshQuota]);

  const selected = images[active];
  const busy = status === "generating" || status === "upscaling";
  const saving = saveState === "saving";
  const finishPreviewUrl = finishEnabled && selected && finishPreview?.key === selected.filePath ? finishPreview.url : null;
  const finishPending = finishEnabled && !!selected && (finishBusy || !finishPreviewUrl) && !finishError;
  const usageLabel = connectionStatus === "connected" ? formatUsageLabel(quota?.usage) : null;
  const usageHint = formatUsageHint(quota?.usage);
  const generationCost = connectionStatus === "connected" && quota
    ? formatAnlasCost(estimateAnlas({ width: settings.width, height: settings.height, steps: settings.steps }, quota))
    : null;

  // Live stage preview: a downscaled copy filtered in the worker; stale slider jobs are dropped.
  useEffect(() => {
    setFinishError(null);
    if (!finishEnabled || !selected || imagesHidden) {
      setFinishBusy(false);
      return;
    }
    let cancelled = false;
    setFinishBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const { preview: source } = await finishPreviewSource(selected);
        const filtered = await finishRunner.run(source, finishParams, { lane: "stage" });
        if (cancelled) return;
        const url = await imageObjectUrl(filtered);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (finishPreviewUrlRef.current) URL.revokeObjectURL(finishPreviewUrlRef.current);
        finishPreviewUrlRef.current = url;
        setFinishPreview({ key: selected.filePath, url });
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
  }, [finishEnabled, finishParams, selected, imagesHidden]);

  useEffect(() => () => {
    if (finishPreviewUrlRef.current) URL.revokeObjectURL(finishPreviewUrlRef.current);
    if (finishLongPressTimer.current !== null) window.clearTimeout(finishLongPressTimer.current);
  }, []);

  const cancelFinishLongPress = () => {
    if (finishLongPressTimer.current !== null) window.clearTimeout(finishLongPressTimer.current);
    finishLongPressTimer.current = null;
  };

  useEffect(() => () => {
    if (saveResetTimer.current !== null) window.clearTimeout(saveResetTimer.current);
  }, []);
  const characterCardValue = randomCharacterEnabled
    ? `🎲 랜덤 · ${randomCharacterCount}명${lastRandomCharacter ? ` · 최근 ${lastRandomCharacter}` : ""}`
    : characterPromptPreview(chars);

  const toggleRandomCharacter = () => {
    if (!randomCharacterEnabled && !randomCharacterCount) {
      setNotice("Prombot 북마크를 먼저 가져오시와요.");
      setCharacters(true);
      window.setTimeout(() => setNotice(null), 2200);
      return;
    }
    const next = !randomCharacterEnabled;
    setRandomCharacterEnabled(next);
    setNotice(next ? `랜덤 캐릭터 ON · ${randomCharacterCount}명` : "랜덤 캐릭터 OFF");
    window.setTimeout(() => setNotice(null), 1600);
  };

  // Existing generated images keep their own aspect ratio. Resolution settings only affect the next generation.
  const stageWidth = selected ? selected.width : settings.width;
  const stageHeight = selected ? selected.height : settings.height;

  const copyPrompt = async () => {
    if (selected) await navigator.clipboard.writeText(selected.positivePrompt);
  };


  const settleSaveState = (next: SaveState, delay: number) => {
    setSaveState(next);
    if (saveResetTimer.current !== null) window.clearTimeout(saveResetTimer.current);
    saveResetTimer.current = window.setTimeout(() => setSaveState("idle"), delay);
  };

  const saveSelected = async () => {
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
      setNotice(
        prepared.fallback
          ? `WebP 변환에 실패해 PNG로 저장했습니다 · ${size}`
          : `저장됨 · ${savedName(target)} · ${size}`,
      );
      window.setTimeout(() => setNotice(null), prepared.fallback ? 3600 : 2400);
    } catch (saveError) {
      settleSaveState("error", 2600);
      useGenerationStore.setState({
        status: "error",
        errorMessage: `저장 실패: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
      });
    }
  };

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="studio-header-actions">
          <button
            className="quota-pill anlas-pill"
            disabled={connectionStatus !== "connected"}
            onClick={() => void refreshQuota()}
            title={quota?.anlas !== null && quota?.anlas !== undefined ? `ImageAnlas ${quota.anlas.toLocaleString()}` : "ImageAnlas"}
          >
            <strong>
              {connectionStatus !== "connected"
                ? "Anlas —"
                : quotaStatus === "loading" && !quota
                  ? "Anlas …"
                  : quota?.anlas !== null && quota?.anlas !== undefined
                    ? `Anlas ${quota.anlas.toLocaleString()}`
                    : "Anlas —"}
            </strong>
          </button>
          {usageLabel && (
            <button
              className={`quota-pill usage-pill ${quota?.usage?.isNegative ? "negative" : ""}`}
              onClick={() => void refreshQuota()}
              title={usageHint ?? "NovelAI V5 사용 한도"}
            >
              <strong>{usageLabel}</strong>
              {usageHint && <span>{usageHint}</span>}
            </button>
          )}
          <button
            className={`icon-button privacy-toggle ${imagesHidden ? "active" : ""}`}
            aria-label={imagesHidden ? "이미지 표시" : "이미지 숨기기"}
            title={imagesHidden ? "이미지 표시" : "이미지 잠시 숨기기"}
            onClick={() => {
              const next = !imagesHidden;
              setImagesHidden(next);
              if (next) setViewer(false);
            }}
          >
            {imagesHidden ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.8 10.8 0 0 1 12 4c5.2 0 8.6 4.4 9.5 6.1a3.9 3.9 0 0 1 .5 1.9c0 .6-.2 1.3-.5 1.9-.3.6-.8 1.3-1.4 2M6.2 6.2C4.4 7.4 3.2 9.1 2.5 10.1A3.9 3.9 0 0 0 2 12c0 .6.2 1.3.5 1.9C3.4 15.6 6.8 20 12 20c1.4 0 2.7-.3 3.8-.8"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 10.1C3.4 8.4 6.8 4 12 4s8.6 4.4 9.5 6.1a3.9 3.9 0 0 1 0 3.8C20.6 15.6 17.2 20 12 20s-8.6-4.4-9.5-6.1a3.9 3.9 0 0 1 0-3.8Z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="설정">⚙</button>
        </div>
      </header>

      <section className="preview-section">
        <div className="image-stage">
          <div
            className={`image-render-surface ${selected ? "has-image" : ""} ${placementId ? "positioning" : ""}`}
            onClick={() => { if (selected && !placementId && !imagesHidden) setViewer(true); }}
          >
            {selected ? (
              imagesHidden ? (
                <>
                  <svg
                    className="stage-aspect-spacer"
                    width={stageWidth}
                    height={stageHeight}
                    viewBox={`0 0 ${stageWidth} ${stageHeight}`}
                    aria-hidden="true"
                  />
                  <div className="privacy-stage" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.8 10.8 0 0 1 12 4c5.2 0 8.6 4.4 9.5 6.1M6.2 6.2C4.4 7.4 3.2 9.1 2.5 10.1A3.9 3.9 0 0 0 2 12c0 .6.2 1.3.5 1.9C3.4 15.6 6.8 20 12 20c1.4 0 2.7-.3 3.8-.8"/></svg>
                    <span>이미지 숨김</span>
                  </div>
                </>
              ) : (
                <img src={(!showOriginal && finishPreviewUrl) || selected.src} alt="NovelAI generation" />
              )
            ) : (
              <>
                <svg
                  className="stage-aspect-spacer"
                  width={stageWidth}
                  height={stageHeight}
                  viewBox={`0 0 ${stageWidth} ${stageHeight}`}
                  aria-hidden="true"
                />
                <div className="empty-stage" aria-hidden="true">
                  <span className={status === "generating" ? "empty-image-glyph pulse" : "empty-image-glyph"}>🖼️</span>
                </div>
              </>
            )}

            {placementId && (
              <CharacterStageOverlay
                characters={chars}
                selectedId={placementId}
                onSelect={setPlacementId}
                onMove={(id, x, y) => updateCharacter(id, { position: { x, y } })}
                onDone={() => setPlacementId(null)}
              />
            )}

            {selected && !imagesHidden && !placementId && (
              <div className="finish-controls">
                <button
                  type="button"
                  className={`finish-chip ${finishEnabled ? "active" : ""} ${finishPending ? "pending" : ""}`}
                  aria-pressed={finishEnabled}
                  title={finishError ?? (finishEnabled ? "마무리 필터 끄기 · 길게 눌러 조절" : "마무리 필터 켜기 · 길게 눌러 조절")}
                  onPointerDown={() => {
                    finishLongPressed.current = false;
                    cancelFinishLongPress();
                    finishLongPressTimer.current = window.setTimeout(() => {
                      finishLongPressed.current = true;
                      setFinishOpen(true);
                    }, 450);
                  }}
                  onPointerUp={cancelFinishLongPress}
                  onPointerLeave={cancelFinishLongPress}
                  onPointerCancel={cancelFinishLongPress}
                  onContextMenu={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (finishLongPressed.current) {
                      finishLongPressed.current = false;
                      return;
                    }
                    setFinishEnabled(!finishEnabled);
                  }}
                >
                  {finishPending && <span className="finish-busy" aria-hidden="true" />}
                  마무리{finishEnabled ? (finishError ? " !" : " ON") : ""}
                </button>
                <button
                  type="button"
                  className="finish-chip finish-chip-adjust"
                  aria-label="마무리 필터 조절"
                  title="마무리 필터 조절"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFinishOpen(true);
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
                </button>
              </div>
            )}

            {selected && !imagesHidden && !placementId && finishEnabled && finishPreviewUrl && (
              <button
                type="button"
                className={`finish-compare ${showOriginal ? "active" : ""}`}
                aria-pressed={showOriginal}
                title="누르고 있는 동안 원본 보기"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setShowOriginal(true);
                }}
                onPointerUp={() => setShowOriginal(false)}
                onPointerLeave={() => setShowOriginal(false)}
                onPointerCancel={() => setShowOriginal(false)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    setShowOriginal(true);
                  }
                }}
                onKeyUp={() => setShowOriginal(false)}
                onBlur={() => setShowOriginal(false)}
                onContextMenu={(event) => event.preventDefault()}
                onClick={(event) => event.stopPropagation()}
              >
                원본
              </button>
            )}

            {(status === "generating" || status === "upscaling") && (
              <div className="stage-progress">{status === "upscaling" ? "Upscaling…" : "Generating…"}</div>
            )}
          </div>
        </div>

        {selected && (
          <div className="image-actions">
            <button onClick={() => useSeed(selected.seed)}>Seed</button>
            <button onClick={() => void copyPrompt()}>Prompt</button>
            <button disabled={selected.width * selected.height > 1024 * 1024 || busy} onClick={() => void upscale()}>
              Upscale <small>{formatAnlasCost(UPSCALE_ANLAS)}</small>
            </button>
            <button
              className={`save-button ${saveState}`}
              disabled={saving}
              aria-live="polite"
              onClick={() => void saveSelected()}
            >
              {saveState === "saving" ? (
                <><span className="save-spinner" aria-hidden="true" />저장 중</>
              ) : saveState === "success" ? (
                <><svg className="save-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>저장됨</>
              ) : saveState === "error" ? (
                <>! 저장 실패</>
              ) : (
                <>{finishEnabled ? "저장 · 마무리" : "저장"}</>
              )}
            </button>
          </div>
        )}

        {images.length > 0 && (
          <div className={`thumbnail-strip ${imagesHidden ? "privacy-hidden" : ""}`}>
            {images.map((image, index) => (
              <button
                key={`${image.createdAt}-${index}`}
                className={index === active ? "active" : ""}
                onClick={() => setActive(index)}
                aria-label={`history ${index + 1}`}
              >
                {imagesHidden ? (
                  <div className="thumbnail-privacy" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.8 10.8 0 0 1 12 4c5.2 0 8.6 4.4 9.5 6.1M6.2 6.2C4.4 7.4 3.2 9.1 2.5 10.1A3.9 3.9 0 0 0 2 12c0 .6.2 1.3.5 1.9C3.4 15.6 6.8 20 12 20c1.4 0 2.7-.3 3.8-.8"/>
                    </svg>
                  </div>
                ) : (
                  <img src={image.src} alt={`history ${index + 1}`} />
                )}
                {image.kind === "upscale" && <span>UP</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="prompt-dashboard">
        <div className="two-up">
          <PromptCard title="ARTIST" value={artist} onOpen={() => setSheet("artist")} className="artist-card" />
          <div className="character-card-wrap">
            <PromptCard title="CHARACTER PROMPTS" value={characterCardValue} onOpen={() => setCharacters(true)} className="character-card" />
            <button
              type="button"
              className={`random-character-toggle ${randomCharacterEnabled ? "active" : ""}`}
              aria-pressed={randomCharacterEnabled}
              aria-label="랜덤 캐릭터 토글"
              title={randomCharacterCount ? `Prombot 북마크 ${randomCharacterCount}명에서 랜덤 선택` : "Prombot 북마크를 먼저 가져오세요"}
              onClick={toggleRandomCharacter}
            >
              🎲
            </button>
          </div>
        </div>
        <PromptCard title="OTHER" value={other} onOpen={() => setSheet("other")} className="other-card" />
        <button className="fixed-prompts-toggle" onClick={() => setShowFixed(!showFixed)}><span>Quality / Negative</span><b>{showFixed ? "−" : "＋"}</b></button>
        {showFixed && (
          <div className="two-up fixed">
            <PromptCard title="QUALITY" value={quality} onOpen={() => setSheet("quality")} />
            <PromptCard title="NEGATIVE" value={negative} onOpen={() => setSheet("negative")} />
          </div>
        )}
        <div className="quick-settings">
          <button onClick={() => setQuickCopy("other")}>태그사전</button>
          <button onClick={() => setSettingsOpen(true)}>{settings.width}×{settings.height}</button>
          <button onClick={() => setSettingsOpen(true)}>{settings.steps} steps</button>
          <button onClick={() => setSettingsOpen(true)}>CFG {settings.guidance}</button>
          <ImageLoadButton />
        </div>
      </section>

      {error && <div className="error-toast"><span>{error}</span><button onClick={clearError}>×</button></div>}
      {notice && <div className="success-toast"><span>{notice}</span></div>}
      <div className="generate-dock">
        <button disabled={busy} onClick={() => void generate()}>
          {status === "generating" ? "GENERATING…" : status === "upscaling" ? "UPSCALING…" : "GENERATE"}
          {generationCost && !busy && <small className="generate-cost">{generationCost}</small>}
        </button>
      </div>

      {sheet && <PromptSheet section={sheet} onClose={() => setSheet(null)} onDictionary={(destination) => setQuickCopy(destination)} onPrombot={(destination) => setPrombot(destination)} />}
      {characters && (
        <CharacterSheet
          onClose={() => setCharacters(false)}
          onPlaceOnImage={(characterId) => {
            setCharacters(false);
            setPlacementId(characterId);
          }}
        />
      )}
      {quickCopy && <QuickCopySheet destination={quickCopy} onClose={() => setQuickCopy(null)} onInsert={(value) => appendPrompt(quickCopy, value)} />}
      {prombot && <PrombotSheet destination={prombot} onClose={() => setPrombot(null)} onInsert={(value) => appendPrompt(prombot, value)} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {finishOpen && <FinishSheet image={selected} busy={finishPending} onClose={() => setFinishOpen(false)} />}
      {viewer && <ImageViewer images={images} index={active} onIndex={setActive} onClose={() => setViewer(false)} />}
    </main>
  );
}

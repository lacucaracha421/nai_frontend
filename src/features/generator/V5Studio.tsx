import { useEffect, useRef, useState } from "react";
import { useGenerationStore } from "../../stores/generationStore";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import type { PromptSectionKey } from "../../types/generation";
import { PromptSheet } from "../prompt/PromptSheet";
import { CharacterSheet } from "../prompt/CharacterSheet";
import { CharacterStageOverlay } from "../prompt/CharacterStageOverlay";
import { QuickCopySheet } from "../tags/QuickCopySheet";
import { SettingsSheet } from "../options/SettingsSheet";
import { ImageViewer } from "../../components/ImageViewer";
import { saveNovelAiImage } from "../../adapters/novelai/client";
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
  const setShowFixed = useUiStore((s) => s.setShowFixedPrompts);
  const connectionStatus = useConnectionStore((s) => s.status);
  const quota = useConnectionStore((s) => s.quota);
  const quotaStatus = useConnectionStore((s) => s.quotaStatus);
  const refreshQuota = useConnectionStore((s) => s.refreshQuota);

  const [sheet, setSheet] = useState<PromptSectionKey | null>(null);
  const [characters, setCharacters] = useState(false);
  const [quickCopy, setQuickCopy] = useState<PromptSectionKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [placementId, setPlacementId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
  // Existing generated images keep their own aspect ratio. Resolution settings only affect the next generation.
  const stageWidth = selected ? selected.width : settings.width;
  const stageHeight = selected ? selected.height : settings.height;

  const copyPrompt = async () => {
    if (selected) await navigator.clipboard.writeText(selected.positivePrompt);
  };


  const saveSelected = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const filename = imageFilename(selected.createdAt, selected.seed, selected.kind);
      const target = await saveNovelAiImage(selected.src, filename);
      if (target) {
        setNotice("이미지를 저장했습니다.");
        window.setTimeout(() => setNotice(null), 1800);
      }
    } catch (saveError) {
      useGenerationStore.setState({
        status: "error",
        errorMessage: saveError instanceof Error ? saveError.message : String(saveError),
      });
    } finally {
      setSaving(false);
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
                <img src={selected.src} alt="NovelAI generation" />
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

            {(status === "generating" || status === "upscaling") && (
              <div className="stage-progress">{status === "upscaling" ? "Upscaling…" : "Generating…"}</div>
            )}
          </div>
        </div>

        {selected && (
          <div className="image-actions">
            <button onClick={() => useSeed(selected.seed)}>Seed</button>
            <button onClick={() => void copyPrompt()}>Prompt</button>
            <button disabled={selected.width * selected.height > 1024 * 1024 || busy} onClick={() => void upscale()}>Upscale</button>
            <button disabled={saving} onClick={() => void saveSelected()}>{saving ? "저장 중…" : "저장"}</button>
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
          <PromptCard title="CHARACTER PROMPTS" value={characterPromptPreview(chars)} onOpen={() => setCharacters(true)} className="character-card" />
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
        </div>
      </section>

      {error && <div className="error-toast"><span>{error}</span><button onClick={clearError}>×</button></div>}
      {notice && <div className="success-toast"><span>{notice}</span></div>}
      <div className="generate-dock"><button disabled={busy} onClick={() => void generate()}>{status === "generating" ? "GENERATING…" : status === "upscaling" ? "UPSCALING…" : "GENERATE"}</button></div>

      {sheet && <PromptSheet section={sheet} onClose={() => setSheet(null)} onDictionary={(destination) => setQuickCopy(destination)} />}
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
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {viewer && <ImageViewer images={images} index={active} onIndex={setActive} onClose={() => setViewer(false)} />}
    </main>
  );
}

import { useRef, useState } from "react";
import { Icon } from "../../../components/Icon";
import { readImageBytes } from "../../../adapters/novelai/client";
import { useGenerationStore } from "../../../stores/generationStore";
import type { GenerationImage, ReferenceMode } from "../../../types/generation";
import { prepareReferenceBlob, prepareReferenceBytes } from "./prepareReference";
import "./reference.css";

const REFERENCE_MODES: { value: ReferenceMode; label: string }[] = [
  { value: "character&style", label: "Character & Style" },
  { value: "character", label: "Character" },
  { value: "style", label: "Style" },
  { value: "outfit", label: "Outfit" },
];

type Props = {
  currentImage?: GenerationImage;
};

export function ReferencePanel({ currentImage }: Props) {
  const references = useGenerationStore((s) => s.references);
  const addReference = useGenerationStore((s) => s.addReference);
  const updateReference = useGenerationStore((s) => s.updateReference);
  const removeReference = useGenerationStore((s) => s.removeReference);
  const clearReferences = useGenerationStore((s) => s.clearReferences);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const prepared = await prepareReferenceBlob(file);
        addReference(prepared);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const addCurrentImage = async () => {
    if (!currentImage) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await readImageBytes(currentImage.src);
      const prepared = await prepareReferenceBytes(bytes, "image/png");
      addReference(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reference-inline">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <div className="reference-inline-bar">
        <button
          type="button"
          className="reference-add-btn"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="plus" />
          {busy ? "처리 중…" : "이미지 추가"}
        </button>
        <button
          type="button"
          className="reference-secondary-btn"
          disabled={busy || !currentImage}
          onClick={() => void addCurrentImage()}
        >
          <Icon name="image" />
          현재 이미지 추가
        </button>
        {references.length > 0 && (
          <button type="button" className="reference-clear-btn" onClick={clearReferences}>
            전체 비우기
          </button>
        )}
      </div>

      {error && <div className="reference-error" role="alert">{error}</div>}

      <div className="reference-inline-body">
        {references.length === 0 ? (
          <div className="reference-empty">참조할 캐릭터·화풍·의상 이미지를 추가하세요.</div>
        ) : (
          <div className="reference-grid">
            {references.map((ref) => {
              const showOutfitOption = ref.mode === "character&style" || ref.mode === "character";
              return (
                <div key={ref.id} className={`reference-card ${ref.enabled ? "" : "disabled"}`}>
                  <div className="reference-thumb-col">
                    <div className="reference-thumb">
                      <img src={ref.previewUrl} alt="" />
                    </div>
                    <div className="reference-card-actions">
                      <button
                        type="button"
                        className={ref.enabled ? "active" : ""}
                        aria-pressed={ref.enabled}
                        aria-label={ref.enabled ? "레퍼런스 끄기" : "레퍼런스 켜기"}
                        onClick={() => updateReference(ref.id, { enabled: !ref.enabled })}
                      >
                        <Icon name="check" />
                      </button>
                      <button
                        type="button"
                        className="danger"
                        aria-label="레퍼런스 삭제"
                        onClick={() => removeReference(ref.id)}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </div>

                  <div className="reference-controls">
                    <select
                      className="reference-mode-select"
                      aria-label="레퍼런스 종류"
                      value={ref.mode}
                      onChange={(event) => updateReference(ref.id, { mode: event.target.value as ReferenceMode })}
                    >
                      {REFERENCE_MODES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    {showOutfitOption && (
                      <label className="reference-outfit-toggle">
                        <input
                          type="checkbox"
                          checked={ref.preferSameOutfit}
                          onChange={(event) => updateReference(ref.id, { preferSameOutfit: event.target.checked })}
                        />
                        <span>Prefer same outfit</span>
                      </label>
                    )}

                    <label className="reference-strength">
                      <span className="reference-strength-head">
                        <span>Strength</span>
                        <strong>{ref.strength.toFixed(2).replace(/\.?0+$/, "")}</strong>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={ref.strength}
                        onChange={(event) => updateReference(ref.id, { strength: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

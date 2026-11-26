import { useEffect, useRef, useState, type DragEvent } from "react";
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

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

function isImageFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_EXT_RE.test(file.name);
}

function hasDraggedFiles(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.types ?? []).includes("Files")) return true;
  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
}

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
  const dragDepthRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter(isImageFile);
    if (list.length === 0) {
      setError("이미지 파일(PNG, JPG, WebP 등)만 추가할 수 있습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const preparedList = await Promise.all(list.map((file) => prepareReferenceBlob(file)));
      for (const prepared of preparedList) {
        addReference(prepared);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file && isImageFile(file)));
      if (files.length === 0) return;
      event.preventDefault();
      void handleFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragging(false);
    if (busy) return;
    void handleFiles(event.dataTransfer.files);
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
    <div
      className={`reference-inline ${dragging ? "is-dragging" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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

      <div className={`reference-inline-body ${dragging ? "is-dragging" : ""}`}>
        {dragging && (
          <div className="reference-drop-overlay" aria-hidden="true">
            <span>여기에 이미지를 놓아 레퍼런스 추가</span>
          </div>
        )}
        {references.length === 0 ? (
          <div className="reference-empty">참조할 캐릭터·화풍·의상 이미지를 추가하거나 여기에 끌어다 놓으세요. (Ctrl+V 붙여넣기 가능)</div>
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

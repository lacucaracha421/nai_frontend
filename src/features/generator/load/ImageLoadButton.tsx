/** "불러오기": hidden file input + result toast with a 6-second undo. Touch-only UI. */
import { useEffect, useRef, useState } from "react";
import type { LoadSnapshot } from "../../../stores/generationStore";
import { browserStealthReader } from "./loadDeps";
import { loadImageIntoStudio, undoImageLoad } from "./loadImage";

const UNDO_MS = 6000;
const MESSAGE_MS = 3200;

type Toast =
  | { kind: "applied"; snapshot: LoadSnapshot; skipped: string[] }
  | { kind: "message"; text: string };

/**
 * Picker, toast and undo for "불러오기", usable from any menu: `element` must stay
 * mounted (it holds the hidden file input and the toast); `pick()` opens the picker
 * and `loadBytes()` applies an image that is already in memory (a session image).
 */
export function useImageLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const show = (next: Toast, duration: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setToast(next);
    timer.current = window.setTimeout(() => setToast(null), duration);
  };

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const loadBytes = async (read: () => Promise<Uint8Array>) => {
    setLoading(true);
    try {
      const outcome = await loadImageIntoStudio(await read(), browserStealthReader);
      if (outcome.kind === "none") show({ kind: "message", text: "이 이미지에는 NovelAI 정보가 없습니다" }, MESSAGE_MS);
      else show({ kind: "applied", snapshot: outcome.snapshot, skipped: outcome.skipped }, UNDO_MS);
    } catch (error) {
      console.warn("Image load failed:", error);
      show({ kind: "message", text: "이미지를 읽지 못했습니다" }, MESSAGE_MS);
    } finally {
      setLoading(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    await loadBytes(async () => new Uint8Array(await file.arrayBuffer()));
  };

  const undo = () => {
    if (toast?.kind !== "applied") return;
    undoImageLoad(toast.snapshot);
    show({ kind: "message", text: "되돌렸습니다" }, 1600);
  };

  const element = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file again fires change.
          event.target.value = "";
          void onFile(file);
        }}
      />
      {toast && (
        <div className="success-toast image-load-toast" role="status">
          {toast.kind === "message" ? (
            <span>{toast.text}</span>
          ) : (
            <>
              <span>
                불러왔습니다
                {toast.skipped.length > 0 && (
                  <small>일부 항목은 앱에서 지원하지 않아 건너뛰었습니다 · {toast.skipped.join(", ")}</small>
                )}
              </span>
              <button type="button" onClick={undo}>되돌리기</button>
            </>
          )}
        </div>
      )}
    </>
  );

  return { loading, pick: () => inputRef.current?.click(), loadBytes, element };
}

/** "불러오기" button + hidden file input + result toast with a 6-second undo. Touch-only UI. */
import { useEffect, useRef, useState } from "react";
import type { LoadSnapshot } from "../../../stores/generationStore";
import { browserStealthReader } from "./loadDeps";
import { loadImageIntoStudio, undoImageLoad } from "./loadImage";

const UNDO_MS = 6000;
const MESSAGE_MS = 3200;

type Toast =
  | { kind: "applied"; snapshot: LoadSnapshot; skipped: string[] }
  | { kind: "message"; text: string };

export function ImageLoadButton() {
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

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    try {
      const outcome = await loadImageIntoStudio(new Uint8Array(await file.arrayBuffer()), browserStealthReader);
      if (outcome.kind === "none") show({ kind: "message", text: "이 이미지에는 NovelAI 정보가 없습니다" }, MESSAGE_MS);
      else show({ kind: "applied", snapshot: outcome.snapshot, skipped: outcome.skipped }, UNDO_MS);
    } catch (error) {
      console.warn("Image load failed:", error);
      show({ kind: "message", text: "이미지를 읽지 못했습니다" }, MESSAGE_MS);
    } finally {
      setLoading(false);
    }
  };

  const undo = () => {
    if (toast?.kind !== "applied") return;
    undoImageLoad(toast.snapshot);
    show({ kind: "message", text: "되돌렸습니다" }, 1600);
  };

  return (
    <>
      <button type="button" className="image-load-button" disabled={loading} aria-busy={loading} onClick={() => inputRef.current?.click()}>
        {loading ? "읽는 중…" : "불러오기"}
      </button>
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
}

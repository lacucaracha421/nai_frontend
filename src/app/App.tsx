import { useEffect, useState } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import type { PluginListener } from "@tauri-apps/api/core";
import { V5Studio } from "../features/generator/V5Studio";
import { useConnectionStore } from "../stores/connectionStore";
import { EXIT_WINDOW_MS, backStack } from "./backStack";

const isTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function App() {
  const restoreConnection = useConnectionStore((state) => state.restore);
  const [exitHint, setExitHint] = useState(false);

  useEffect(() => {
    void restoreConnection();
  }, [restoreConnection]);

  // Android Back: close the topmost open layer. With nothing open, the first Back shows
  // "한 번 더 누르면 종료" and hands Back to Android for a moment, so a second Back
  // leaves the app the usual way; after that the app takes Back over again.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let listener: PluginListener | null = null;
    let disposed = false;
    let rearm: number | null = null;
    const listen = async () => {
      const next = await onBackButtonPress(() => {
        if (backStack.handleBack()) return;
        setExitHint(true);
        const current = listener;
        listener = null;
        void current?.unregister();
        rearm = window.setTimeout(() => {
          setExitHint(false);
          if (!disposed) void listen();
        }, EXIT_WINDOW_MS);
      });
      if (disposed) void next.unregister();
      else listener = next;
    };
    void listen().catch((error) => console.warn("Back button listener failed:", error));
    return () => {
      disposed = true;
      if (rearm !== null) window.clearTimeout(rearm);
      void listener?.unregister();
    };
  }, []);

  return (
    <>
      <V5Studio />
      {exitHint && <div className="success-toast b2-toast" role="status"><span>한 번 더 누르면 종료</span></div>}
    </>
  );
}

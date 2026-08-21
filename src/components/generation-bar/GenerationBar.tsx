import { useGenerationStore } from "../../stores/generationStore";
import { useUiStore } from "../../stores/uiStore";

export function GenerationBar() {
  const count = useGenerationStore((s) => s.settings.count);
  const status = useGenerationStore((s) => s.status);
  const setSetting = useGenerationStore((s) => s.setSetting);
  const generate = useGenerationStore((s) => s.generate);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);

  return (
    <div className="generation-bar-wrap">
      <div className="generation-bar">
        <button className="count-button" disabled={status === "generating"} onClick={() => setSetting("count", count >= 4 ? 1 : count + 1)}>{count}</button>
        <button
          className={`generate-button ${status === "generating" ? "loading" : ""}`}
          disabled={status === "generating"}
          onClick={() => { setWorkspaceTab("generate"); void generate(); }}
        >
          {status === "generating" ? "Generating…" : "Generate"}
        </button>
        <button className="history-button" title="Gallery / history is planned for a later milestone">↶</button>
      </div>
    </div>
  );
}

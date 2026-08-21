import { CharactersBrowser } from "../../features/characters/CharactersBrowser";
import { useUiStore } from "../../stores/uiStore";
import { GenerateWorkspace } from "./GenerateWorkspace";

export function Workspace() {
  const tab = useUiStore((s) => s.workspaceTab);
  const setTab = useUiStore((s) => s.setWorkspaceTab);

  return (
    <main className="workspace">
      <div className="workspace-head">
        <button className="bookmark-button">▱</button>
        <div className="workspace-switch segmented">
          <button className={tab === "generate" ? "active" : ""} onClick={() => setTab("generate")}>Generate</button>
          <button className={tab === "characters" ? "active" : ""} onClick={() => setTab("characters")}>Characters</button>
        </div>
        <div className="credit-chip"><span>◈</span> 9,856</div>
      </div>
      <div className="workspace-body">
        {tab === "generate" ? <GenerateWorkspace /> : <CharactersBrowser />}
      </div>
    </main>
  );
}

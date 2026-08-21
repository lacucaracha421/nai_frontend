import { GenerationBar } from "../components/generation-bar/GenerationBar";
import { Sidebar } from "../components/sidebar/Sidebar";
import { Workspace } from "../components/workspace/Workspace";
import { PromptLibraryDrawer } from "../features/library/PromptLibraryDrawer";

export function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <Workspace />
      <GenerationBar />
      <PromptLibraryDrawer />
    </div>
  );
}

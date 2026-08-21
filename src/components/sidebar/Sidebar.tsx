import { AutomationPanel } from "../../features/automation/AutomationPanel";
import { GeneratorPanel } from "../../features/generator/GeneratorPanel";
import { OptionsPanel } from "../../features/options/OptionsPanel";
import { PromptPanel } from "../../features/prompt/PromptPanel";
import { useUiStore } from "../../stores/uiStore";
import type { SidebarTab } from "../../types/generation";

const tabs: { id: SidebarTab; label: string }[] = [
  { id: "prompt", label: "Prompt" },
  { id: "generator", label: "Generator" },
  { id: "options", label: "Options" },
  { id: "automation", label: "Automation" },
];

export function Sidebar() {
  const active = useUiStore((s) => s.sidebarTab);
  const setActive = useUiStore((s) => s.setSidebarTab);

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        {tabs.map((tab) => <button key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => setActive(tab.id)}>{tab.label}</button>)}
      </div>
      <div className="sidebar-content">
        {active === "prompt" && <PromptPanel />}
        {active === "generator" && <GeneratorPanel />}
        {active === "options" && <OptionsPanel />}
        {active === "automation" && <AutomationPanel />}
      </div>
    </aside>
  );
}

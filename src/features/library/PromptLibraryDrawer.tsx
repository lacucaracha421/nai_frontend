import { useMemo, useState } from "react";
import { useGenerationStore } from "../../stores/generationStore";
import { useUiStore } from "../../stores/uiStore";
import { actions, artists } from "./libraryData";

export function PromptLibraryDrawer() {
  const open = useUiStore((s) => s.libraryOpen);
  const setOpen = useUiStore((s) => s.setLibraryOpen);
  const insertPromptText = useGenerationStore((s) => s.insertPromptText);
  const [tab, setTab] = useState<"artists" | "actions">("artists");
  const [query, setQuery] = useState("");

  const artistList = useMemo(() => artists
    .filter((item) => `${item.name} ${item.note ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))), [query]);

  const actionList = useMemo(() => actions
    .filter((item) => `${item.title} ${item.prompt} ${item.category}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))), [query]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={() => setOpen(false)}>
      <aside className="library-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">PERSONAL LIBRARY</div>
            <h2>Prompt palette</h2>
          </div>
          <button className="icon-button" onClick={() => setOpen(false)}>×</button>
        </div>

        <div className="segmented compact">
          <button className={tab === "artists" ? "active" : ""} onClick={() => setTab("artists")}>Artists</button>
          <button className={tab === "actions" ? "active" : ""} onClick={() => setTab("actions")}>Actions</button>
        </div>

        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search saved prompts" />

        <div className="library-list">
          {tab === "artists" ? artistList.map((item) => (
            <button key={item.name} className="library-row" onClick={() => insertPromptText(`artist:${item.name}`)}>
              <span>{item.name}</span>
              <small>{item.pinned ? "PIN" : item.note}</small>
            </button>
          )) : actionList.map((item) => (
            <button key={item.title} className="library-row multiline" onClick={() => insertPromptText(item.prompt)}>
              <span>{item.title}</span>
              <small>{item.category} · {item.prompt}</small>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { characters, series } from "./characterData";

export function CharactersBrowser() {
  const [query, setQuery] = useState("");
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);

  const filteredCharacters = useMemo(() => characters.filter((item) => {
    const haystack = `${item.name} ${item.series} ${item.tags}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (!selectedSeries || item.series === selectedSeries);
  }), [query, selectedSeries]);

  return (
    <div className="character-browser">
      <div className="browser-toolbar">
        <input className="browser-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, series, attire, features" />
        {selectedSeries && <button className="clear-series" onClick={() => setSelectedSeries(null)}>× {selectedSeries}</button>}
      </div>

      {!selectedSeries && !query ? (
        <>
          <div className="browser-meta"><span><strong>1,187</strong> Series</span><span>Sort&nbsp;&nbsp;<strong>Most popular</strong></span></div>
          <div className="series-grid">
            {series.map((item) => (
              <button className="series-card" key={item.name} onClick={() => setSelectedSeries(item.name)} style={{ "--accent": item.accent } as CSSProperties}>
                <div className="series-art"><span>{item.name.slice(0, 2).toUpperCase()}</span></div>
                <div className="series-gradient" />
                <div className="series-caption"><strong>{item.name}</strong><small>{item.count} characters</small></div>
                <span className="star">☆</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="browser-meta"><span><strong>{filteredCharacters.length}</strong> Characters</span><span>Local mock dataset</span></div>
          <div className="series-grid character-results">
            {filteredCharacters.map((item) => (
              <button className="series-card" key={`${item.series}-${item.name}`} style={{ "--accent": item.accent } as CSSProperties}>
                <div className="series-art character-art"><span>{item.name.split(" ").map((x) => x[0]).join("").slice(0, 3)}</span></div>
                <div className="series-gradient" />
                <div className="series-caption"><strong>{item.name}</strong><small>{item.series} · {item.tags}</small></div>
                <span className="star">☆</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

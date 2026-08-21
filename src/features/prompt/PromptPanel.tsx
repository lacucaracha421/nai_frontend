import { useGenerationStore } from "../../stores/generationStore";
import { useUiStore } from "../../stores/uiStore";

function TextBlock({ label, value, onChange, library = false }: { label: string; value: string; onChange: (value: string) => void; library?: boolean }) {
  const openLibrary = useUiStore((s) => s.setLibraryOpen);
  return (
    <section className="field-section">
      <div className="field-label-row">
        <label>{label}</label>
        {library && <button className="micro-button" onClick={() => openLibrary(true)}>Library</button>}
      </div>
      <textarea className="prompt-textarea" value={value} onChange={(e) => onChange(e.target.value)} />
    </section>
  );
}

export function PromptPanel() {
  const store = useGenerationStore();
  const enabledCount = store.characters.filter((c) => c.enabled).length;

  return (
    <div className="sidebar-scroll">
      <TextBlock label="Beginning Prompt" value={store.beginningPrompt} onChange={store.setBeginningPrompt} library />

      <section className="field-section">
        <div className="field-label-row">
          <label>Characters</label>
          <span className="muted-small">{enabledCount} of {store.characters.length}</span>
        </div>
        <div className="character-box">
          <label className="toggle-row prominent">
            <div>
              <strong>AI's choice of position</strong>
              <small>Let the model decide where each character stands</small>
            </div>
            <input type="checkbox" checked={store.aiPosition} onChange={(e) => store.setAiPosition(e.target.checked)} />
          </label>

          <div className="character-stack">
            {store.characters.map((character, index) => (
              <div className={`character-editor ${!character.enabled ? "disabled" : ""}`} key={character.id}>
                <div className="character-editor-head">
                  <span className="number-dot">{index + 1}</span>
                  <div className="mini-tabs"><span className="selected">Prompt</span><span>Negative</span></div>
                  <button className="position-pill" title="Position editor comes in the next milestone">{character.positionLabel}</button>
                  <button className="tiny-icon" onClick={() => store.updateCharacter(character.id, { enabled: !character.enabled })}>{character.enabled ? "◉" : "○"}</button>
                  <button className="tiny-icon" onClick={() => store.removeCharacter(character.id)}>×</button>
                </div>
                <textarea
                  className="character-textarea"
                  value={character.prompt}
                  onChange={(e) => store.updateCharacter(character.id, { prompt: e.target.value })}
                  placeholder="Character prompt"
                />
              </div>
            ))}
          </div>

          <button className="add-character" onClick={store.addCharacter}>＋ Add character</button>
        </div>
      </section>

      <TextBlock label="Ending Prompt" value={store.endingPrompt} onChange={store.setEndingPrompt} library />
      <TextBlock label="Negative Prompt" value={store.negativePrompt} onChange={store.setNegativePrompt} />
    </div>
  );
}

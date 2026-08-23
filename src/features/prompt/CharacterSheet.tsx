import { useState } from "react";
import { useGenerationStore } from "../../stores/generationStore";
import { AutocompleteTextarea } from "../tags/AutocompleteTextarea";

type Props = {
  onClose: () => void;
  onPlaceOnImage: (characterId: string) => void;
};


export function CharacterSheet({ onClose, onPlaceOnImage }: Props) {
  const characters = useGenerationStore((s) => s.characters);
  const useCoords = useGenerationStore((s) => s.useCharacterCoords);
  const setUseCoords = useGenerationStore((s) => s.setUseCharacterCoords);
  const add = useGenerationStore((s) => s.addCharacter);
  const remove = useGenerationStore((s) => s.removeCharacter);
  const update = useGenerationStore((s) => s.updateCharacter);
  const [selected, setSelected] = useState<string | null>(characters[0]?.id ?? null);
  const active = characters.find((character) => character.id === selected) ?? characters[0];


  return (
    <div className="sheet character-sheet">
      <div className="sheet-head">
        <div className="drag-handle" />
        <div><h2>Character Prompts</h2></div>
        <button className="icon-button" onClick={onClose}>↓</button>
      </div>

      <div className="character-sheet-body">
        <section>
          <div className="section-title"><strong>Positioning</strong></div>
          <div className="position-mode">
            <button className={!useCoords ? "active" : ""} onClick={() => setUseCoords(false)}>AI&apos;s Choice</button>
            <button className={useCoords ? "active" : ""} onClick={() => setUseCoords(true)}>Manual Position</button>
          </div>
          {useCoords && (
            <div className="manual-position-box">
              <button
                type="button"
                disabled={!active || !active.enabled}
                onClick={() => active?.enabled && onPlaceOnImage(active.id)}
              >
                이미지에서 위치 지정
              </button>
            </div>
          )}
        </section>

        <div className="character-tabs">
          {characters.map((character, index) => (
            <button key={character.id} className={active?.id === character.id ? "active" : ""} onClick={() => setSelected(character.id)}>
              <span>{index + 1}</span>{character.name || `Character ${index + 1}`}
            </button>
          ))}
          <button className="add-character" onClick={() => {
            add();
            requestAnimationFrame(() => {
              const next = useGenerationStore.getState().characters;
              setSelected(next[next.length - 1]?.id ?? null);
            });
          }}>＋</button>
        </div>

        {active && (
          <section className="character-editor">
            <div className="character-editor-head">
              <label><input type="checkbox" checked={active.enabled} onChange={(event) => update(active.id, { enabled: event.target.checked })} /> 사용</label>
              {characters.length > 1 && <button className="danger-ghost" onClick={() => {
                remove(active.id);
                setSelected(characters.find((character) => character.id !== active.id)?.id ?? null);
              }}>삭제</button>}
            </div>

            <label className="field-label">캐릭터 태그</label>
            <input
              className="plain-tag-input"
              value={active.name}
              onChange={(event) => update(active.id, { name: event.target.value })}
              placeholder="예: kaine"
              autoComplete="off"
              spellCheck={false}
            />

            <label className="field-label">Character Prompt</label>
            <AutocompleteTextarea
              value={active.prompt}
              onChange={(prompt) => update(active.id, { prompt })}
              categories={["character", "general", "copyright", "meta"]}
              rows={7}
              placeholder="캐릭터 외형과 의상 태그"
              onSelectTag={(tag) => {
                if (tag.category === "character") update(active.id, { name: tag.display });
              }}
            />

            <details>
              <summary>Character Negative</summary>
              <AutocompleteTextarea
                value={active.negative}
                onChange={(negative) => update(active.id, { negative })}
                categories={["general", "meta"]}
                rows={4}
                placeholder="이 캐릭터에만 적용할 네거티브"
              />
            </details>
          </section>
        )}
      </div>
    </div>
  );
}

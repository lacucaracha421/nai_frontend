import { AutocompleteTextarea } from "../tags/AutocompleteTextarea";
import { useEffect, useState } from "react";
import { useGenerationStore } from "../../stores/generationStore";
import { useTagStore } from "../../stores/tagStore";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
import { favoriteLocalTags } from "../tags/localTagIndex";

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
  const favorites = useTagStore((s) => s.favorites);
  const removeFavorites = useTagStore((s) => s.removeFavorites);
  const addManyToLibrary = useCharacterLibraryStore((s) => s.addMany);
  const legacyMigrated = useCharacterLibraryStore((s) => s.legacyFavoritesMigrated);
  const finishLegacyMigration = useCharacterLibraryStore((s) => s.finishLegacyMigration);
  const [selected, setSelected] = useState<string | null>(characters[0]?.id ?? null);
  const active = characters.find((character) => character.id === selected) ?? characters[0];

  useEffect(() => {
    if (legacyMigrated) return;
    let cancelled = false;
    void favoriteLocalTags(favorites, ["character"]).then((characterFavorites) => {
      if (cancelled) return;
      addManyToLibrary(characterFavorites);
      if (characterFavorites.length) removeFavorites(characterFavorites.map((tag) => tag.raw));
      finishLegacyMigration();
    });
    return () => { cancelled = true; };
  }, [favorites, legacyMigrated, addManyToLibrary, removeFavorites, finishLegacyMigration]);

  return (
    <>
      <div className="sheet character-sheet">
        <div className="sheet-head">
          <div className="drag-handle" />
          <div><h2>캐릭터 관리</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="캐릭터 관리 닫기">↓</button>
        </div>

        <div className="character-sheet-body">
          <section>
            <div className="section-title"><strong>위치</strong></div>
            <div className="position-mode">
              <button className={!useCoords ? "active" : ""} onClick={() => setUseCoords(false)}>AI 선택</button>
              <button className={useCoords ? "active" : ""} onClick={() => setUseCoords(true)}>직접 지정</button>
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
                <span>{index + 1}</span>{character.name || `캐릭터 ${index + 1}`}
              </button>
            ))}
            <button className="add-character" onClick={() => {
              add();
              requestAnimationFrame(() => {
                const next = useGenerationStore.getState().characters;
                setSelected(next[next.length - 1]?.id ?? null);
              });
            }}>＋ 캐릭터 추가</button>
          </div>

          {active && (
            <section className="character-editor">
              <div className="character-editor-head">
                <label><input type="checkbox" checked={active.enabled} onChange={(event) => update(active.id, { enabled: event.target.checked })} /> 사용</label>
                <div>
                  {characters.length > 1 && <button className="danger-ghost" onClick={() => {
                    remove(active.id);
                    setSelected(characters.find((character) => character.id !== active.id)?.id ?? null);
                  }}>삭제</button>}
                </div>
              </div>
              <label className="character-negative">
                <span>캐릭터 제외</span>
                <AutocompleteTextarea
                  value={active.negative}
                  onChange={(negative) => update(active.id, { negative })}
                  categories={["general", "meta"]}
                  historyKey={`character:${active.id}:negative`}
                  rows={3}
                  placeholder="이 캐릭터에만 적용할 네거티브"
                />
              </label>
              <p className="character-management-note">캐릭터 태그는 보드에서 고칩니다.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

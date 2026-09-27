import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PromptToolbar,
  RandomPickLine,
  imageMenuLabels,
  promptMenuLabels,
  promptToolbarLabels,
} from "./V5Studio";
import { CharacterSheet } from "../prompt/CharacterSheet";

const character = {
  id: "character-1",
  name: "hoshino aoi",
  prompt: "hoshino aoi, school uniform",
  negative: "bad anatomy",
  enabled: true,
  position: { x: 0.5, y: 0.5 },
};
const secondCharacter = { ...character, id: "character-2", name: "kurose mei" };

const tools = {
  editing: false,
  canWeight: false,
  weight: vi.fn(),
  canTranslate: false,
  translating: false,
  translate: vi.fn(),
  canUndo: true,
  canRedo: false,
  undo: vi.fn(),
  redo: vi.fn(),
  flush: vi.fn(),
};

describe("prompt toolbar layout", () => {
  it("keeps the same core order in normal, expanded, and typing states", () => {
    const normal = promptToolbarLabels(false, "캐릭터 찾기", "캐릭터 메뉴");
    const expanded = promptToolbarLabels(false, "캐릭터 찾기", "캐릭터 메뉴");
    const typing = promptToolbarLabels(true, "캐릭터 찾기", "캐릭터 메뉴");
    const core = ["캐릭터 찾기", "번역", "되돌리기", "다시 실행", "캐릭터 메뉴"];

    expect(normal).toEqual(core);
    expect(expanded).toEqual(core);
    expect(typing).toEqual(["−0.1", "+0.1", ...core, "생성"]);
  });

  it("renders the character menu at the end of every state", () => {
    for (const typing of [false, true]) {
      const html = renderToStaticMarkup(
        <PromptToolbar
          typing={typing}
          dictionaryLabel="캐릭터 찾기"
          sectionMenuLabel="캐릭터 메뉴"
          tools={tools}
          onDictionary={() => {}}
          onMenu={() => {}}
          onGenerate={() => {}}
          generateLabel="생성"
        />,
      );
      expect(html.indexOf("캐릭터 찾기")).toBeLessThan(html.indexOf("캐릭터 메뉴"));
      if (typing) expect(html.indexOf("캐릭터 메뉴")).toBeLessThan(html.indexOf("생성"));
    }
  });
});

describe("image actions and character board", () => {
  it("keeps file import in the image menu", () => {
    expect(imageMenuLabels()).toEqual(["프롬프트 복사", "이 설정 불러오기", "파일에서 불러오기", "마무리 조절"]);
  });

  it("keeps import and character management out of the prompt menu", () => {
    expect(promptMenuLabels()).toEqual(["전체 복사", "텍스트로 편집", "전체 지우기"]);
    expect(promptMenuLabels()).not.toContain("불러오기");
    expect(promptMenuLabels()).not.toContain("캐릭터 설정");
  });

  it("renders the random pick in the image zone with a compact keep action", () => {
    const html = renderToStaticMarkup(
      <RandomPickLine pick={{ display: "hoshino_aoi", series: "Blue Archive" }} onKeep={() => {}} />,
    );
    expect(html).toContain("🎲");
    expect(html).toContain("hoshino aoi");
    expect(html).toContain("Blue Archive");
    expect(html).toContain("고정");
    expect(renderToStaticMarkup(<RandomPickLine pick={undefined} onKeep={() => {}} />)).toBe("");
  });
});

vi.mock("../tags/AutocompleteTextarea", () => ({
  AutocompleteTextarea: ({ value }: { value: string }) => <textarea value={value} readOnly />,
}));
vi.mock("../prompt/CharacterFinderSheet", () => ({ CharacterFinderSheet: () => null }));
vi.mock("../../app/backStack", () => ({ useBackLayer: () => {} }));
vi.mock("../../stores/generationStore", () => ({
  useGenerationStore: (selector: (state: unknown) => unknown) => selector({
    characters: [character, secondCharacter],
    useCharacterCoords: false,
    setUseCharacterCoords: vi.fn(),
    addCharacter: vi.fn(),
    removeCharacter: vi.fn(),
    updateCharacter: vi.fn(),
  }),
}));
vi.mock("../../stores/tagStore", () => ({
  useTagStore: (selector: (state: unknown) => unknown) => selector({ favorites: [], removeFavorites: vi.fn() }),
}));
vi.mock("../../stores/characterLibraryStore", () => ({
  UNCATEGORIZED_SERIES: "미분류",
  useCharacterLibraryStore: (selector: (state: unknown) => unknown) => selector({
    addMany: vi.fn(),
    legacyFavoritesMigrated: true,
    finishLegacyMigration: vi.fn(),
  }),
}));

describe("character management sheet", () => {
  it("keeps management controls and the character negative, without a second prompt editor", () => {
    const html = renderToStaticMarkup(<CharacterSheet onClose={() => {}} onPlaceOnImage={() => {}} />);

    expect(html).toContain("캐릭터 관리");
    expect(html).toContain("AI 선택");
    expect(html).toContain("직접 지정");
    expect(html).toContain("사용");
    expect(html).toContain("삭제");
    expect(html).toContain("캐릭터 추가");
    expect(html).not.toContain("캐릭터 프롬프트");
    // The only editor left is the per-character negative (user, 2026-09-27).
    expect(html).toContain("캐릭터 제외");
    expect(html.match(/<textarea/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("캐릭터 찾기");
  });
});

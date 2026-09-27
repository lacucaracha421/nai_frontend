import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { CharacterFinderSheet } from "./CharacterFinderSheet";
import { useCharacterLibraryStore } from "../../stores/characterLibraryStore";
vi.mock("../../stores/characterLibraryStore", async importOriginal => {
  const actual = await importOriginal<typeof import("../../stores/characterLibraryStore")>();
  // SSR intentionally reads Zustand's initial snapshot. Supply the current fixture to the view.
  const hook = Object.assign((selector?: (state: ReturnType<typeof actual.useCharacterLibraryStore.getState>) => unknown) => {
    const state = actual.useCharacterLibraryStore.getState();
    return selector ? selector(state) : state;
  }, actual.useCharacterLibraryStore);
  return { ...actual, useCharacterLibraryStore: hook };
});
const props = { onClose: () => {}, onSelect: () => {}, currentIndex: 0 };
afterEach(() => useCharacterLibraryStore.setState(useCharacterLibraryStore.getInitialState(), true));
it("opens the unified finder with both tabs and a new-slot target", () => {
  const html = renderToStaticMarkup(<CharacterFinderSheet {...props} initialAdd />);
  expect(html).toContain('aria-label="캐릭터 찾기"');
  expect(html).toContain('role="tab" aria-selected="true"');
  expect(html).toContain("내 도감");
  expect(html).toContain("새 캐릭터로 추가");
});
it("renders folder switches with the selected scope and matching random count", () => {
  useCharacterLibraryStore.setState({ entries: [
    { raw: "a", display: "A", series: "blue_archive", addedAt: 1 },
    { raw: "b", display: "B", series: "vocaloid", addedAt: 2 },
  ], randomScope: "series", randomSeries: ["blue_archive"] });
  const html = renderToStaticMarkup(<CharacterFinderSheet {...props} initialRandom />);
  expect(html).toContain("🎲 랜덤 범위");
  expect(html).toContain("생성할 때마다 1명 중 한 명");
  expect(html).toContain('aria-label="블루 아카이브 랜덤 포함" aria-checked="true"');
  expect(html).toContain('aria-label="보컬로이드 랜덤 포함" aria-checked="false"');
});

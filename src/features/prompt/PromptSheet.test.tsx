import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PromptSheet } from "./PromptSheet";

const state = vi.hoisted(() => ({ artistPrompt: "artist:test", otherPrompt: "other", qualityPrompt: "quality", negativePrompt: "negative", status: "idle" }));
vi.mock("../../stores/generationStore", () => ({
  useGenerationStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock("../tags/AutocompleteTextarea", () => ({ AutocompleteTextarea: () => null }));

const render = (section: "artist" | "other" | "quality" | "negative") => renderToStaticMarkup(
  <PromptSheet section={section} onClose={() => {}} onDictionary={() => {}} onPrombot={() => {}} />,
);

describe("Artist whole-copy control", () => {
  it("is available only in the Artist editor", () => {
    expect(render("artist")).toContain("전체 복사");
    for (const section of ["other", "quality", "negative"] as const) {
      expect(render(section)).not.toContain("전체 복사");
    }
  });

  it("disables copy when the Artist prompt is empty", () => {
    state.artistPrompt = "";
    expect(render("artist")).toMatch(/class="artist-copy-all"[^>]*disabled=""/);
    state.artistPrompt = "artist:test";
  });
});

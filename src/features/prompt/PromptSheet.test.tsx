import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PromptSheet, clearWholePrompt } from "./PromptSheet";

const state = vi.hoisted(() => ({ artistPrompt: "artist:test", otherPrompt: "other", qualityPrompt: "quality", negativePrompt: "negative", status: "idle" }));
vi.mock("../../stores/generationStore", () => ({
  useGenerationStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock("../tags/AutocompleteTextarea", () => ({ AutocompleteTextarea: () => null }));

const render = (section: "artist" | "other" | "quality" | "negative") => renderToStaticMarkup(
  <PromptSheet section={section} onClose={() => {}} onDictionary={() => {}} onPrombot={() => {}} />,
);

describe("Whole-copy control", () => {
  it("is available in the Artist and Other editors only", () => {
    for (const section of ["artist", "other"] as const) {
      expect(render(section)).toContain("전체 복사");
    }
    for (const section of ["quality", "negative"] as const) {
      expect(render(section)).not.toContain("전체 복사");
    }
  });

  it("disables copy when that prompt is empty", () => {
    state.artistPrompt = "";
    state.otherPrompt = "";
    expect(render("artist")).toMatch(/class="prompt-copy-all"[^>]*disabled=""/);
    expect(render("other")).toMatch(/class="prompt-copy-all"[^>]*disabled=""/);
    state.artistPrompt = "artist:test";
    state.otherPrompt = "other";
  });
});

describe("Whole-clear control", () => {
  it("is available in the Artist and Other editors only and disabled when empty", () => {
    for (const section of ["artist", "other"] as const) {
      expect(render(section)).toContain("전체 지우기");
    }
    for (const section of ["quality", "negative"] as const) {
      expect(render(section)).not.toContain("전체 지우기");
    }
    state.otherPrompt = "";
    expect(render("other")).toMatch(/class="prompt-clear-all"[^>]*disabled=""/);
    state.otherPrompt = "other";
  });

  it("records the previous text for undo before clearing", () => {
    const checkpoint = vi.fn();
    const setPrompt = vi.fn();
    expect(clearWholePrompt("other", "1girl, smile", checkpoint, setPrompt)).toBe(true);
    expect(checkpoint).toHaveBeenCalledWith("prompt:other", { value: "1girl, smile", selectionStart: 0, selectionEnd: 12 });
    expect(setPrompt).toHaveBeenCalledWith("other", "");
    expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(setPrompt.mock.invocationCallOrder[0]);
  });

  it("does nothing for an empty prompt or another section", () => {
    const checkpoint = vi.fn();
    const setPrompt = vi.fn();
    expect(clearWholePrompt("artist", "", checkpoint, setPrompt)).toBe(false);
    expect(clearWholePrompt("negative", "bad", checkpoint, setPrompt)).toBe(false);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(setPrompt).not.toHaveBeenCalled();
  });
});

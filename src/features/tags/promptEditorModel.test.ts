import { describe, expect, it } from "vitest";
import {
  insertionForSuggestion,
  movePromptToken,
  reconcilePromptTokens,
  selectionOrWhole,
  serializePromptTokens,
  tokensFromPrompt,
} from "./promptEditorModel";

describe("prompt editor model", () => {
  it("adds artist prefix only to artist suggestions", () => {
    expect(insertionForSuggestion("toma", "artist", "artist:")).toBe("artist:toma");
    expect(insertionForSuggestion("toon (style)", "general", "artist:")).toBe("toon (style)");
  });

  it("uses the whole active block when selection is collapsed", () => {
    expect(selectionOrWhole(4, 4, 12)).toEqual({ start: 0, end: 12 });
    expect(selectionOrWhole(2, 7, 12)).toEqual({ start: 2, end: 7 });
  });

  it("preserves token identity when external text changes in place", () => {
    const tokens = tokensFromPrompt("alpha, beta");
    const reconciled = reconcilePromptTokens(tokens, "1.1::alpha ::, beta");
    expect(reconciled[0].id).toBe(tokens[0].id);
    expect(reconciled[0].text).toBe("1.1::alpha ::");
    expect(reconciled[1].id).toBe(tokens[1].id);
  });

  it("reorders tokens without changing their stable ids", () => {
    const tokens = tokensFromPrompt("a, b, c");
    const moved = movePromptToken(tokens, tokens[0].id, tokens[2].id);
    expect(moved.map((token) => token.text)).toEqual(["b", "c", "a"]);
    expect(new Set(moved.map((token) => token.id))).toEqual(new Set(tokens.map((token) => token.id)));
    expect(serializePromptTokens(moved)).toBe("b, c, a");
  });
});
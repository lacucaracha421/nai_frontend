import { expect, it } from "vitest";
import { groupCatalog, matchesCharacter, insertCharacter, type CatalogCharacter } from "./characterCatalog";
const row = (raw: string, series: string): CatalogCharacter => ({ raw, display: raw.replaceAll("_", " "), series, features: ["black hair", "blue eyes"], attire: ["red dress"], isNew: false, posts: 0 });
it("orders saved series first then counts and leaves uncategorized last", () => {
  const rows = [row("a", "large"), row("b", "large"), row("c", "saved"), row("d", "")];
  expect(groupCatalog(rows, [{ raw: "c", display: "c", series: "my folder", addedAt: 1 }]).map(g => g.series)).toEqual(["saved", "large", "미분류"]);
});
it("searches normalized English names and Korean series labels", () => {
  expect(matchesCharacter(row("ellen_joe", "zenless_zone_zero"), "젠레스")).toBe(true);
  expect(matchesCharacter(row("aemeath_(wuthering_waves)", ""), "명조")).toBe(true);
  expect(matchesCharacter(row("ELLEN_JOE", "zenless_zone_zero"), "ellen joe")).toBe(true);
  expect(matchesCharacter(row("a", "reverse:1999"), "리버스")).toBe(true);
});
it("inserts each mode, drops chips, and only replaces previously owned tags", () => {
  const character = row("ellen_joe", "zzz");
  const previous = { prompt: "old, smiling, black hair", name: "old", finderTags: [] };
  expect(insertCharacter(previous, character, "name").prompt).toBe("ellen joe, smiling, black hair");
  const features = insertCharacter(previous, character, "features");
  expect(features.prompt).toBe("ellen joe, smiling, black hair, blue eyes");
  expect(features.finderTags).toEqual(["blue eyes"]);
  expect(insertCharacter(previous, character, "attire", ["blue eyes"]).prompt).toBe("ellen joe, smiling, black hair, red dress");
  const replaced = insertCharacter({ ...features, name: "ellen joe" }, row("new", "zzz"), "name");
  expect(replaced.prompt).toBe("new, smiling, black hair");
});

it("retains a newly inserted identity absent from the local autocomplete database", async () => {
  const { containsCharacterTag } = await import("./characterTag");
  expect(containsCharacterTag("1girl, 1.2::aemeath_(wuthering_waves)::, smiling", "aemeath (wuthering waves)")).toBe(true);
  expect(containsCharacterTag("aemeath cosplay, smiling", "aemeath")).toBe(false);
});
it("keeps weighted manually edited appearance when changing the finder choice", () => {
  const result = insertCharacter({ prompt: "old, 1.2::blue eyes::, black hair", name: "old", finderTags: ["blue eyes"] }, row("new", "zzz"), "name");
  expect(result.prompt).toBe("new, 1.2::blue eyes::, black hair");
});

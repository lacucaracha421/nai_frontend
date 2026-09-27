import { splitTags } from "./tagChips";
import { chooseCharacterTag, normalizedCharacterTag } from "./characterTag";
import { UNCATEGORIZED_SERIES, type CharacterLibraryEntry, type InsertMode } from "../../stores/characterLibraryStore";

export type CatalogCharacter = { raw: string; display: string; series: string; features: string[]; attire: string[]; isNew: boolean; posts: number };
import seriesKo from "./seriesKo.json";
import characterKo from "./characterKo.json";

/**
 * Korean series names shown instead of Danbooru copyright tags. `seriesKo.json` covers every
 * catalog series (drafted 2026-09-27: official Korean titles where known, else fan names or
 * transliterations; the top 130 were reviewed). The hand-picked labels below win over it.
 */
export const SERIES_LABELS: Record<string, string> = {
  wuthering_waves: "명조", zenless_zone_zero: "젠레스 존 제로", blue_archive: "블루 아카이브",
  "reverse:1999": "리버스:1999", chainsaw_man: "체인소맨", girls_band_cry: "걸즈 밴드 크라이",
  "goddess_of_victory:_nikke": "니케", nikke: "니케", genshin_impact: "원신",
  "honkai:_star_rail": "붕괴: 스타레일", hololive: "홀로라이브", vocaloid: "보컬로이드",
  gakuen_idolmaster: "학원 아이돌마스터", "cho_kaguya-hime!": "초카구야 공주!!", umamusume: "우마무스메",
  "fate_(series)": "페이트", "fate/grand_order": "페이트 그랜드 오더", touhou: "동방",
  kantai_collection: "칸코레", arknights: "명일방주", jujutsu_kaisen: "주술회전", persona_5: "페르소나 5",
  pokemon: "포켓몬", azur_lane: "벽람항로", idolmaster: "아이돌마스터",
};
export function characterKey(raw: string) {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replaceAll('""', '"');
  return normalizedCharacterTag(value);
}
const seriesAliases = Object.entries(SERIES_LABELS).map(([key, label]) => ({ key: characterKey(key), label }));
const labels = new Map([
  ...Object.entries(seriesKo as Record<string, string>).map(([key, label]) => [characterKey(key), label] as const),
  ...seriesAliases.map(({ key, label }) => [key, label] as const),
]);
export function seriesLabel(series: string) {
  return labels.get(characterKey(series)) ?? series.replaceAll("_", " ");
}
const characterLabels = new Map(Object.entries(characterKo as Record<string, string>).map(([key, label]) => [characterKey(key), label]));
/** Korean name for a character (drafted 2026-09-27 for the user's 도감, reviewed), if known. */
export function characterLabel(raw: string) {
  return characterLabels.get(characterKey(raw));
}
export function matchesSeries(series: string, query: string) {
  const q = characterKey(query);
  return characterKey(`${series} ${seriesLabel(series)}`).includes(q);
}
const searchText = new WeakMap<CatalogCharacter, string>();
export function matchesCharacter(row: CatalogCharacter, query: string) {
  let text = searchText.get(row);
  if (!text) {
    const name = characterKey(row.raw);
    const aliases = seriesAliases.filter(({ key }) => name.includes(key)).map(({ label }) => label).join(" ");
    text = characterKey(`${row.raw} ${row.display} ${characterLabel(row.raw) ?? ""} ${row.series} ${seriesLabel(row.series)} ${aliases}`);
    searchText.set(row, text);
  }
  return text.includes(characterKey(query));
}
export function libraryCharacter(entry: CharacterLibraryEntry, catalog: Map<string, CatalogCharacter>): CatalogCharacter {
  return catalog.get(characterKey(entry.raw)) ?? { ...entry, features: [], attire: [], isNew: false, posts: 0 };
}
export function groupCatalog(rows: CatalogCharacter[], saved: CharacterLibraryEntry[]) {
  const keys = new Set(saved.map(entry => characterKey(entry.raw)));
  const groups = new Map<string, { series: string; rows: CatalogCharacter[]; saved: number; newCount: number }>();
  for (const row of rows) {
    const series = row.series || UNCATEGORIZED_SERIES;
    const group = groups.get(series) ?? { series, rows: [], saved: 0, newCount: 0 };
    group.rows.push(row);
    if (keys.has(characterKey(row.raw))) group.saved++;
    if (row.isNew) group.newCount++;
    groups.set(series, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.series === UNCATEGORIZED_SERIES) return 1;
    if (b.series === UNCATEGORIZED_SERIES) return -1;
    return Number(b.saved > 0) - Number(a.saved > 0) || b.rows.length - a.rows.length || a.series.localeCompare(b.series);
  });
}
export function insertCharacter(
  previous: { prompt: string; name: string; finderTags?: string[] },
  row: CatalogCharacter, mode: InsertMode, removed: string[] = [],
) {
  // Only exact, unedited tags added by the finder are owned. Existing manual tags never are.
  const owned = new Set(previous.finderTags ?? []);
  const retained = splitTags(previous.prompt).map(s => s.trim()).filter(s => s && !owned.has(s)).join(", ");
  const prompt = chooseCharacterTag(retained, previous.name, row.display);
  const existing = new Set(splitTags(prompt).map(characterKey));
  const dropped = new Set(removed);
  const tags = mode === "name" ? [] : [...row.features, ...(mode === "attire" ? row.attire : [])];
  const finderTags = tags.filter(tag => {
    const key = characterKey(tag);
    if (dropped.has(tag) || existing.has(key)) return false;
    existing.add(key); return true;
  });
  return { name: row.display, prompt: [prompt, ...finderTags].filter(Boolean).join(", "), finderTags };
}

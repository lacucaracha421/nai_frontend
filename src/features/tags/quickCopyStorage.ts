/**
 * Shared localStorage persistence for the QuickCopy / Tag Dictionary
 * (`artist-tag-quick-copy.v4`), keeping full compatibility with existing
 * user entries and backup export/import.
 */

import type { PromptSectionKey } from "../../types/generation";
import { splitTags } from "../prompt/tagChips";

export type StoredArtist = { name: string; title?: string; note?: string; pinned?: boolean };
export type StoredAction = {
  title?: string;
  prompt?: string;
  name?: string;
  category?: string;
  aliases?: string;
  note?: string;
  pinned?: boolean;
};
export type StoredTag = {
  title: string;
  category?: string;
  prompt: string;
  description?: string;
  aliases?: string;
  note?: string;
  pinned?: boolean;
};
export type StoredQuickCopy = {
  artists: StoredArtist[];
  actions: StoredAction[];
  tags: StoredTag[];
};

export const QUICKCOPY_STORAGE_KEY = "artist-tag-quick-copy.v4";
export const QUICKCOPY_UPDATED_EVENT = "nai-quickcopy-updated";

export const DEFAULT_ARTISTS: StoredArtist[] = [
  "kanzarin", "ing (ing205509)", "kim 8thhh", "konoshige (ryuun)", "toma (toma50)",
  "turisasu", "sanatsuki (user cgxu2455)", "velzhe", "laliberte", "kuromoto-kun (rina masimaro)",
  "ushio kiyoshi", "seoyong", "santa (sunflower)", "luxsumildo", "kubo tite", "mori kaoru",
  "obata takeshi", "hiramoto akira", "gurihiru", "yabuki kentarou", "katsura masakazu",
  "oogure ito", "eguchi hisashi", "fujimoto tatsuki", "rurudo", "saitou masatsugu", "mignon", "mugi (twinbox)",
].map((name) => ({ name, note: "", pinned: false }));

export const TAG_CATEGORIES = ["시점", "렌즈·원근", "프레이밍", "구도", "초점", "화면 효과", "품질", "제외"];

export function readQuickCopyData(defaultTags: StoredTag[] = []): StoredQuickCopy {
  try {
    const raw = localStorage.getItem(QUICKCOPY_STORAGE_KEY);
    if (!raw) {
      return { artists: [...DEFAULT_ARTISTS], actions: [], tags: [...defaultTags] };
    }
    const parsed = JSON.parse(raw) as Partial<StoredQuickCopy>;
    return {
      artists: Array.isArray(parsed.artists) && parsed.artists.length ? parsed.artists : [...DEFAULT_ARTISTS],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags : [...defaultTags],
    };
  } catch {
    return { artists: [...DEFAULT_ARTISTS], actions: [], tags: [...defaultTags] };
  }
}

export function writeQuickCopyData(next: StoredQuickCopy) {
  try {
    localStorage.setItem(QUICKCOPY_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(QUICKCOPY_UPDATED_EVENT));
  } catch {
    // ignore storage quota errors
  }
}

export function formatArtistPrompt(name: string) {
  const clean = name.trim();
  if (!clean) return "";
  if (/^artist:/i.test(clean) || clean.includes(",")) return clean;
  return `artist:${clean}`;
}

function normalizePromptPresetKey(value: string) {
  return splitTags(value)
    .map((tag) => tag.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase())
    .join(",");
}

function normalizeArtistPresetKey(value: string) {
  return normalizePromptPresetKey(formatArtistPrompt(value));
}

function nextAutoPresetTitle(prefix: string, existingTitles: Iterable<string>) {
  const used = new Set<string>();
  for (const title of existingTitles) {
    const clean = title.trim();
    if (clean) used.add(clean);
  }
  let index = 1;
  while (used.has(`${prefix}(${index})`)) index += 1;
  return `${prefix}(${index})`;
}

export type SavePresetResult = {
  status: "saved" | "updated" | "duplicate" | "empty";
  targetLabel: string;
  title?: string;
};

export type SaveArtistPresetResult = {
  status: "saved" | "updated" | "duplicate" | "empty";
  entry?: StoredArtist;
};

export function saveArtistPreset(rawPrompt: string, rawTitle?: string): SaveArtistPresetResult {
  const cleanPrompt = splitTags(rawPrompt).join(", ");
  if (!cleanPrompt) return { status: "empty" };
  const cleanTitle = (rawTitle ?? "").trim();
  const targetKey = normalizeArtistPresetKey(cleanPrompt);
  const current = readQuickCopyData();
  const existingIndex = current.artists.findIndex(
    (item) => item && typeof item.name === "string" && normalizeArtistPresetKey(item.name) === targetKey,
  );

  if (existingIndex >= 0) {
    const existing = current.artists[existingIndex];
    const existingTitle = (existing.title ?? "").trim();
    if (cleanTitle && cleanTitle !== existingTitle) {
      const updated: StoredArtist = { ...existing, title: cleanTitle };
      const nextArtists = [...current.artists];
      nextArtists[existingIndex] = updated;
      writeQuickCopyData({ ...current, artists: nextArtists });
      return { status: "updated", entry: updated };
    }
    return { status: "duplicate", entry: existing };
  }

  const resolvedTitle = cleanTitle || nextAutoPresetTitle(
    "새 작가",
    current.artists.map((item) => item.title || item.name || ""),
  );
  const entry: StoredArtist = {
    name: cleanPrompt,
    title: resolvedTitle,
    note: "",
    pinned: false,
  };
  writeQuickCopyData({ ...current, artists: [entry, ...current.artists] });
  return { status: "saved", entry };
}

export function saveSectionPreset(
  section: PromptSectionKey,
  rawPrompt: string,
  rawTitle?: string,
  defaultTags: StoredTag[] = [],
): SavePresetResult {
  if (section === "artist") {
    const res = saveArtistPreset(rawPrompt, rawTitle);
    return {
      status: res.status,
      targetLabel: "작가",
      title: res.entry?.title,
    };
  }

  const cleanPrompt = splitTags(rawPrompt).join(", ");
  const targetLabel = section === "other" ? "행동" : "구도";
  if (!cleanPrompt) return { status: "empty", targetLabel };

  const cleanTitle = (rawTitle ?? "").trim();
  const targetKey = normalizePromptPresetKey(cleanPrompt);
  const current = readQuickCopyData(defaultTags);

  if (section === "other") {
    const existingIndex = current.actions.findIndex((item) => {
      const prompt = (item?.prompt ?? item?.name ?? "").trim();
      return prompt !== "" && normalizePromptPresetKey(prompt) === targetKey;
    });
    if (existingIndex >= 0) {
      const existing = current.actions[existingIndex];
      const existingTitle = (existing.title ?? existing.name ?? "").trim();
      if (cleanTitle && cleanTitle !== existingTitle) {
        const updated: StoredAction = { ...existing, title: cleanTitle };
        const nextActions = [...current.actions];
        nextActions[existingIndex] = updated;
        writeQuickCopyData({ ...current, actions: nextActions });
        return { status: "updated", targetLabel, title: cleanTitle };
      }
      return { status: "duplicate", targetLabel, title: existingTitle || undefined };
    }

    const resolvedTitle = cleanTitle || nextAutoPresetTitle(
      "새 행동",
      current.actions.map((item) => item.title || item.name || ""),
    );
    const entry: StoredAction = {
      title: resolvedTitle,
      prompt: cleanPrompt,
      category: "장면",
      aliases: "",
      note: "",
      pinned: false,
    };
    writeQuickCopyData({ ...current, actions: [entry, ...current.actions] });
    return { status: "saved", targetLabel, title: resolvedTitle };
  }

  const category = section === "quality" ? "품질" : "제외";
  const existingIndex = current.tags.findIndex(
    (item) => item && typeof item.prompt === "string" && normalizePromptPresetKey(item.prompt) === targetKey,
  );
  if (existingIndex >= 0) {
    const existing = current.tags[existingIndex];
    const existingTitle = (existing.title ?? "").trim();
    if (cleanTitle && cleanTitle !== existingTitle) {
      const updated: StoredTag = { ...existing, title: cleanTitle };
      const nextTags = [...current.tags];
      nextTags[existingIndex] = updated;
      writeQuickCopyData({ ...current, tags: nextTags });
      return { status: "updated", targetLabel, title: cleanTitle };
    }
    return { status: "duplicate", targetLabel, title: existingTitle || undefined };
  }

  const resolvedTitle = cleanTitle || nextAutoPresetTitle(
    section === "quality" ? "새 품질" : "새 제외",
    current.tags.map((item) => item.title || ""),
  );
  const entry: StoredTag = {
    title: resolvedTitle,
    prompt: cleanPrompt,
    category,
    aliases: "",
    note: "",
    pinned: false,
  };
  writeQuickCopyData({ ...current, tags: [entry, ...current.tags] });
  return { status: "saved", targetLabel, title: resolvedTitle };
}

export async function saveSectionPresetWithDefaults(
  section: PromptSectionKey,
  rawPrompt: string,
  rawTitle?: string,
): Promise<SavePresetResult> {
  let defaultTags: StoredTag[] = [];
  if ((section === "quality" || section === "negative") && readQuickCopyData().tags.length === 0) {
    defaultTags = await fetchDefaultDictionaryTags();
  }
  return saveSectionPreset(section, rawPrompt, rawTitle, defaultTags);
}

export async function fetchDefaultDictionaryTags(): Promise<StoredTag[]> {
  try {
    const res = await fetch("/data/tag-dictionary.json");
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? (rows as StoredTag[]) : [];
  } catch {
    return [];
  }
}

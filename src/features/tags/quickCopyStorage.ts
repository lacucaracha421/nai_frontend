/**
 * Shared localStorage persistence for the QuickCopy / Tag Dictionary
 * (`artist-tag-quick-copy.v4`), keeping full compatibility with existing
 * user entries and backup export/import.
 */

export type StoredArtist = { name: string; note?: string; pinned?: boolean };
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

export const TAG_CATEGORIES = ["시점", "렌즈·원근", "프레이밍", "구도", "초점", "화면 효과"];

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

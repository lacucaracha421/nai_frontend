import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "../adapters/novelai/client";

const BACKUP_FORMAT = "nai-v5-studio-backup";
const BACKUP_VERSION = 1;
const QUICKCOPY_KEYS = new Set(["artist-tag-quick-copy.v4", "artist-quick-copy.v1"]);

export type NaiBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  storage: Record<string, unknown>;
  novelAiToken?: string | null;
};

export type BackupPreview = {
  createdAt: string;
  generationSettings: boolean;
  promptSections: number;
  activeCharacters: number;
  favoriteTags: number;
  characterSeries: number;
  characterCount: number;
  quickCopyArtists: number;
  quickCopyActions: number;
  quickCopyTags: number;
  includesToken: boolean;
};

function isAppStorageKey(key: string) {
  return key.startsWith("nai-v5-") || QUICKCOPY_KEYS.has(key) || key.startsWith("artist-tag-quick-copy.");
}

function safeParse(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function serializeStorageValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function collectStorage() {
  const storage: Record<string, unknown> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isAppStorageKey(key)) continue;
    storage[key] = safeParse(localStorage.getItem(key));
  }
  return storage;
}

function formatFilename(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `NAI_Backup_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

function validateBackup(value: unknown): NaiBackup {
  if (!value || typeof value !== "object") throw new Error("백업 파일 형식이 올바르지 않습니다.");
  const candidate = value as Partial<NaiBackup>;
  if (candidate.format !== BACKUP_FORMAT) throw new Error("NAI V5 Studio 백업 파일이 아닙니다.");
  if (candidate.version !== BACKUP_VERSION) throw new Error(`지원하지 않는 백업 버전입니다. (${candidate.version ?? "?"})`);
  if (!candidate.storage || typeof candidate.storage !== "object" || Array.isArray(candidate.storage)) {
    throw new Error("백업 데이터가 손상되었습니다.");
  }
  return candidate as NaiBackup;
}

async function readBrowserFile() {
  return new Promise<string | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    };
    input.click();
  });
}

export async function exportFullBackup(includeToken: boolean) {
  const now = new Date();
  const payload: NaiBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    storage: collectStorage(),
  };

  if (includeToken && isTauriRuntime()) {
    payload.novelAiToken = await invoke<string | null>("export_novelai_token");
  }

  const text = `${JSON.stringify(payload, null, 2)}\n`;
  const filename = formatFilename(now);

  if (isTauriRuntime()) {
    const target = await save({ defaultPath: filename, filters: [{ name: "NAI backup", extensions: ["json"] }] });
    if (!target) return null;
    await writeTextFile(target, text);
    return target;
  }

  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export async function chooseBackupFile(): Promise<NaiBackup | null> {
  let text: string | null = null;
  if (isTauriRuntime()) {
    const selected = await open({ multiple: false, directory: false, filters: [{ name: "NAI backup", extensions: ["json"] }] });
    if (!selected) return null;
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return null;
    text = await readTextFile(path);
  } else {
    text = await readBrowserFile();
  }
  if (!text) return null;
  return validateBackup(JSON.parse(text));
}

function persistedState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const object = value as Record<string, unknown>;
  const state = object.state;
  return state && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : object;
}

export function previewBackup(backup: NaiBackup): BackupPreview {
  const generation = persistedState(backup.storage["nai-v5-s11-generation-v0.3"]);
  const favorites = persistedState(backup.storage["nai-v5-local-tag-favorites"]);
  const library = persistedState(backup.storage["nai-v5-character-library-v1"]);
  const quickCopyValue = backup.storage["artist-tag-quick-copy.v4"];
  const quickCopy = quickCopyValue && typeof quickCopyValue === "object" && !Array.isArray(quickCopyValue)
    ? quickCopyValue as Record<string, unknown>
    : {};
  const characters = Array.isArray(generation.characters) ? generation.characters : [];
  const entries = Array.isArray(library.entries) ? library.entries as Array<{ series?: unknown }> : [];
  const series = new Set(entries.map((entry) => String(entry.series ?? "미분류")));
  const promptKeys = ["artistPrompt", "otherPrompt", "qualityPrompt", "negativePrompt"];

  return {
    createdAt: backup.createdAt,
    generationSettings: Boolean(generation.settings),
    promptSections: promptKeys.filter((key) => typeof generation[key] === "string" && String(generation[key]).trim()).length,
    activeCharacters: characters.length,
    favoriteTags: Array.isArray(favorites.favorites) ? favorites.favorites.length : 0,
    characterSeries: series.size,
    characterCount: entries.length,
    quickCopyArtists: Array.isArray(quickCopy.artists) ? quickCopy.artists.length : 0,
    quickCopyActions: Array.isArray(quickCopy.actions) ? quickCopy.actions.length : 0,
    quickCopyTags: Array.isArray(quickCopy.tags) ? quickCopy.tags.length : 0,
    includesToken: Object.prototype.hasOwnProperty.call(backup, "novelAiToken"),
  };
}

export async function restoreFullBackup(backup: NaiBackup) {
  validateBackup(backup);
  const currentKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => typeof key === "string" && isAppStorageKey(key));
  const affected = new Set([...currentKeys, ...Object.keys(backup.storage)]);
  const snapshot = new Map<string, string | null>();
  for (const key of affected) snapshot.set(key, localStorage.getItem(key));
  const previousToken = isTauriRuntime() && Object.prototype.hasOwnProperty.call(backup, "novelAiToken")
    ? await invoke<string | null>("export_novelai_token")
    : undefined;

  try {
    for (const key of currentKeys) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(backup.storage)) {
      if (!isAppStorageKey(key) || value === null || value === undefined) continue;
      localStorage.setItem(key, serializeStorageValue(value));
    }

    if (isTauriRuntime() && Object.prototype.hasOwnProperty.call(backup, "novelAiToken")) {
      const token = backup.novelAiToken?.trim() ?? "";
      if (token) await invoke("set_novelai_token", { token });
      else await invoke("clear_novelai_token");
    }
  } catch (error) {
    for (const key of affected) {
      const previous = snapshot.get(key);
      if (previous === null || previous === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    }
    if (isTauriRuntime() && previousToken !== undefined) {
      if (previousToken) await invoke("set_novelai_token", { token: previousToken }).catch(() => undefined);
      else await invoke("clear_novelai_token").catch(() => undefined);
    }
    throw error;
  }

  window.location.reload();
}

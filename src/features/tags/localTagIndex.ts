import { invoke } from "@tauri-apps/api/core";

export type TagCategory = "general" | "artist" | "copyright" | "character" | "meta" | "unknown";
export type LocalTag = {
  raw: string;
  display: string;
  category: TagCategory;
  count: number;
};

type SourceTag = {
  name?: unknown;
  tag?: unknown;
  category?: unknown;
  type_name?: unknown;
  post_count?: unknown;
  count?: unknown;
  aliases?: unknown;
};

const isTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const unescapeDisplay = (value: string) => value.replace(/\\+([(){}\[\]])/g, "$1").replace(/_/g, " ");
const norm = (value: string) => unescapeDisplay(value).toLowerCase().replace(/\s+/g, " ").trim();

const mapCategory = (value: unknown): TagCategory => {
  if (value === 1 || value === "artist") return "artist";
  if (value === 3 || value === "copyright") return "copyright";
  if (value === 4 || value === "character") return "character";
  if (value === 5 || value === "meta") return "meta";
  if (value === 0 || value === "general") return "general";
  return "unknown";
};

let previewPromise: Promise<Array<LocalTag & { aliases: string[] }>> | null = null;
async function previewTags() {
  if (!previewPromise) {
    previewPromise = fetch("/data/danbooru-tags.json")
      .then(async (response) => (response.ok ? ((await response.json()) as SourceTag[]) : []))
      .catch(() => [])
      .then((rows) =>
        rows.map((item) => {
          const raw = String(item.name ?? item.tag ?? "").trim();
          return {
            raw,
            display: unescapeDisplay(raw),
            category: mapCategory(item.category ?? item.type_name),
            count: Number(item.post_count ?? item.count ?? 0) || 0,
            aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
          };
        }).filter((tag) => tag.raw),
      );
  }
  return previewPromise;
}

function previewScore(tag: LocalTag & { aliases: string[] }, query: string) {
  const name = norm(tag.display);
  const aliases = tag.aliases.map(norm);
  const tokens = [name, ...aliases].flatMap((value) => value.split(/[\s()\-:]+/)).filter(Boolean);
  if (name === query) return 1000;
  if (name.startsWith(query)) return 900;
  if (tokens.some((token) => token === query)) return 850;
  if (tokens.some((token) => token.startsWith(query))) return 800;
  if (aliases.some((alias) => alias === query)) return 780;
  if (aliases.some((alias) => alias.startsWith(query))) return 740;
  if ([name, ...aliases].some((value) => value.includes(query))) return 500;
  return 0;
}

async function previewSearch(query: string, categories?: TagCategory[], limit = 36): Promise<LocalTag[]> {
  const q = norm(query);
  if (q.length < 2) return [];
  const allowed = categories?.length ? new Set(categories) : null;
  return (await previewTags())
    .filter((tag) => !allowed || allowed.has(tag.category))
    .map((tag) => ({ tag, score: previewScore(tag, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.tag.count - a.tag.count)
    .slice(0, limit)
    .map(({ tag }) => ({ raw: tag.raw, display: tag.display, category: tag.category, count: tag.count }));
}

export async function searchLocalTags(query: string, categories?: TagCategory[], limit = 36): Promise<LocalTag[]> {
  const q = norm(query);
  if (q.length < 2) return [];
  if (!isTauriRuntime()) return previewSearch(q, categories, limit);
  try {
    return await invoke<LocalTag[]>("search_local_tags", { query: q, categories, limit });
  } catch (error) {
    console.error("[tags] SQLite search failed; using tiny browser preview index instead.", error);
    return previewSearch(q, categories, limit);
  }
}

export async function favoriteLocalTags(keys: string[], categories?: TagCategory[]): Promise<LocalTag[]> {
  if (!keys.length) return [];
  if (!isTauriRuntime()) {
    const order = new Map(keys.map((key, index) => [key, index]));
    const allowed = categories?.length ? new Set(categories) : null;
    return (await previewTags())
      .filter((tag) => order.has(tag.raw) && (!allowed || allowed.has(tag.category)))
      .sort((a, b) => (order.get(a.raw) ?? 0) - (order.get(b.raw) ?? 0))
      .map(({ raw, display, category, count }) => ({ raw, display, category, count }));
  }
  try {
    return await invoke<LocalTag[]>("favorite_local_tags", { keys, categories });
  } catch (error) {
    console.error("[tags] Favorite lookup failed.", error);
    return [];
  }
}

export type DanbooruTagSuggestion = {
  name: string;
  category: number;
  postCount?: number;
};

// Placeholder boundary. Real network requests move to the Tauri side so the UI
// does not become coupled to CORS, credentials, or remote response quirks.
export async function searchDanbooruTags(_query: string): Promise<DanbooruTagSuggestion[]> {
  return [];
}

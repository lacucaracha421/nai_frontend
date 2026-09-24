/** "불러오기": reads NovelAI metadata from picked image bytes and applies it to the generation store. */
import { useGenerationStore, type LoadSnapshot } from "../../../stores/generationStore";
import { mapNovelAiMetadata } from "./mapNovelAiMetadata";
import { readImageMetadata, type MetadataSource, type StealthReader } from "./readImageMetadata";

export type LoadOutcome =
  | { kind: "none" }
  | { kind: "applied"; source: MetadataSource; snapshot: LoadSnapshot; skipped: string[] };

export async function loadImageIntoStudio(bytes: Uint8Array, readStealth: StealthReader): Promise<LoadOutcome> {
  const metadata = await readImageMetadata(bytes, readStealth);
  const store = useGenerationStore.getState();
  const loaded = metadata ? mapNovelAiMetadata(metadata.fields, { qualityPrompt: store.qualityPrompt }) : null;
  if (!metadata || !loaded) return { kind: "none" };
  const snapshot = store.applyLoadedGeneration(loaded);
  return { kind: "applied", source: metadata.source, snapshot, skipped: loaded.skipped };
}

export function undoImageLoad(snapshot: LoadSnapshot) {
  useGenerationStore.getState().restoreLoadSnapshot(snapshot);
}

import type { CharacterPrompt, GenerationSettings } from "../../types/generation";

export type GenerationDraft = {
  beginningPrompt: string;
  endingPrompt: string;
  negativePrompt: string;
  characters: CharacterPrompt[];
  aiPosition: boolean;
  settings: GenerationSettings;
};

export type NovelAiImageRequest = Record<string, unknown>;

export type NovelAiGeneratedImage = {
  image: string;
  index: number;
  seed: number | null;
};

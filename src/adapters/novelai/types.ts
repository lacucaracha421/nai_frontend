import type { CharacterPrompt, GenerationSettings, NovelAiV5Model, PreciseReference, ReferenceMode } from "../../types/generation";

export type GenerationDraft = {
  artistPrompt: string;
  otherPrompt: string;
  qualityPrompt: string;
  negativePrompt: string;
  characters: CharacterPrompt[];
  useCharacterCoords: boolean;
  references?: PreciseReference[];
  settings: GenerationSettings;
};

export type V5DirectorReferenceDescription = {
  caption: { base_caption: ReferenceMode; char_captions: [] };
  legacy_uc: false;
};

export type V5DirectorReferenceCached = {
  cache_secret_key: string;
  data: string;
};

export type V5Center = { x: number; y: number };
export type V5CharacterCaption = { char_caption: string; centers: V5Center[] };
export type V5StructuredPrompt = {
  caption: { base_caption: string; char_captions: V5CharacterCaption[] };
  use_coords: boolean;
  use_order: boolean;
  legacy_uc: boolean;
};

export type NovelAiImageParameters = {
  params_version: 4;
  width: number;
  height: number;
  steps: number;
  scale: number;
  cfg_rescale: number;
  sampler: string;
  noise_schedule: string;
  n_samples: 1;
  negative_prompt: string;
  qualityToggle: false;
  ucPreset: 0;
  dynamic_thresholding: false;
  legacy: false;
  legacy_v3_extend: false;
  add_original_image: true;
  v4_prompt: V5StructuredPrompt;
  v4_negative_prompt: V5StructuredPrompt;
  tag_hint_transparent_background: boolean;
  seed?: number;
  extra_noise_seed?: number;
  deliberate_euler_ancestral_bug?: false;
  prefer_brownian?: true;
  normalize_reference_strength_multiple?: true;
  director_reference_descriptions?: V5DirectorReferenceDescription[];
  director_reference_information_extracted?: number[];
  director_reference_strength_values?: number[];
  director_reference_secondary_strength_values?: number[];
  director_reference_images_cached?: V5DirectorReferenceCached[];
};

export type NovelAiImageRequest = {
  action: "generate";
  input: string;
  model: NovelAiV5Model;
  parameters: NovelAiImageParameters;
};

export type NovelAiGeneratedImage = {
  path: string;
  index: number;
  seed: number | null;
  width: number;
  height: number;
};

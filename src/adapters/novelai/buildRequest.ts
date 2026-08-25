import type { GenerationDraft, NovelAiImageRequest } from "./types";

function cleanPart(value: string) {
  return value
    .trim()
    .replace(/_+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",");
}

const BASE_SUBJECT_TAG = /^(?:1girl|1boy|1other|[2-9]\d*\+?(?:girls|boys|others)|multiple (?:girls|boys|others)|solo|no humans)$/i;

function splitBaseSubjectTags(value: string) {
  const subject: string[] = [];
  const rest: string[] = [];

  for (const raw of cleanPart(value).split(",")) {
    const tag = raw.trim();
    if (!tag) continue;
    if (BASE_SUBJECT_TAG.test(tag)) subject.push(tag);
    else rest.push(tag);
  }

  return {
    subject: subject.join(", "),
    rest: rest.join(", "),
  };
}

export function joinPositivePrompt(
  draft: Pick<GenerationDraft, "artistPrompt" | "otherPrompt" | "qualityPrompt">,
) {
  const other = splitBaseSubjectTags(draft.otherPrompt);

  // NovelAI's official tagging guidance expects subject/count tags at the start.
  // Style/media tags are most effective near the front, while automatic quality
  // tags on recent models are appended at the end. Keep user-entered Other order
  // intact apart from lifting unambiguous base subject tags to the front.
  return [other.subject, draft.artistPrompt, other.rest, draft.qualityPrompt]
    .map(cleanPart)
    .filter(Boolean)
    .join(", ")
    .replace(/,\s*,+/g, ", ");
}

export function buildNovelAiRequest(draft: GenerationDraft): NovelAiImageRequest {
  const prompt = joinPositivePrompt(draft);
  const enabled = draft.characters.filter((c) => c.enabled && c.prompt.trim());

  // NovelAI V4/V5 structured character captions expect a center entry even when
  // AI's Choice is active. `use_coords: false` tells the model to ignore those
  // centers and choose placement itself. Omitting centers can produce a server 500.
  const chars = enabled.map((c) => ({
    char_caption: cleanPart(c.prompt),
    centers: [{ x: c.position.x, y: c.position.y }],
  }));

  // Keep the negative caption array index-aligned with the positive characters.
  // Empty per-character UC is valid, but the center still needs to be present.
  const negs = enabled.map((c) => ({
    char_caption: cleanPart(c.negative),
    centers: [{ x: c.position.x, y: c.position.y }],
  }));

  const parameters: NovelAiImageRequest["parameters"] = {
    params_version: 4,
    width: draft.settings.width,
    height: draft.settings.height,
    steps: draft.settings.steps,
    scale: draft.settings.guidance,
    cfg_rescale: draft.settings.guidanceRescale,
    sampler: draft.settings.sampler,
    noise_schedule: draft.settings.noiseSchedule,
    n_samples: 1,
    negative_prompt: cleanPart(draft.negativePrompt),
    qualityToggle: false,
    ucPreset: 0,
    dynamic_thresholding: false,
    legacy: false,
    legacy_v3_extend: false,
    add_original_image: true,
    v4_prompt: {
      caption: {
        base_caption: prompt,
        char_captions: chars,
      },
      use_coords: draft.useCharacterCoords,
      use_order: true,
      legacy_uc: false,
    },
    v4_negative_prompt: {
      caption: {
        base_caption: cleanPart(draft.negativePrompt),
        char_captions: negs,
      },
      // Current NovelAI clients keep negative character coordinates disabled;
      // centers remain index-aligned with the positive captions.
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    },
    tag_hint_transparent_background: /(transparent background|has alpha|alpha transparency)/i.test(
      prompt,
    ),
  };

  if (draft.settings.seed !== null) {
    parameters.seed = draft.settings.seed;
    parameters.extra_noise_seed = draft.settings.seed;
  }

  if (draft.settings.sampler === "k_euler_ancestral") {
    parameters.deliberate_euler_ancestral_bug = false;
    parameters.prefer_brownian = true;
  }

  return {
    action: "generate",
    input: prompt,
    model: draft.settings.model,
    parameters,
  };
}

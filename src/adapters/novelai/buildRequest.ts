import type { GenerationDraft, NovelAiImageRequest } from "./types";

function joinPrompt(...parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+,/g, ",")
    .trim();
}

export function buildNovelAiRequest(draft: GenerationDraft): NovelAiImageRequest {
  const prompt = joinPrompt(draft.beginningPrompt, draft.endingPrompt);
  const enabledCharacters = draft.characters.filter((item) => item.enabled && item.prompt.trim());
  const charCaptions = enabledCharacters.map((item) => ({
    char_caption: item.prompt.trim(),
    centers: [{ x: item.position.x, y: item.position.y }],
  }));
  const negativeCharCaptions = enabledCharacters.map((item) => ({
    char_caption: item.negative.trim(),
    centers: [{ x: item.position.x, y: item.position.y }],
  }));

  const parameters: Record<string, unknown> = {
    params_version: 3,
    width: draft.settings.width,
    height: draft.settings.height,
    steps: draft.settings.steps,
    scale: draft.settings.guidance,
    cfg_rescale: draft.settings.guidanceRescale,
    sampler: draft.settings.sampler,
    noise_schedule: draft.settings.noiseSchedule,
    negative_prompt: draft.negativePrompt,
    n_samples: draft.settings.count,
    qualityToggle: true,
    ucPreset: 0,
    dynamic_thresholding: false,
    legacy: false,
    add_original_image: false,
    v4_prompt: {
      caption: {
        base_caption: prompt,
        char_captions: charCaptions,
      },
      use_coords: !draft.aiPosition,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: {
        base_caption: draft.negativePrompt,
        char_captions: negativeCharCaptions,
      },
      use_coords: !draft.aiPosition,
      use_order: true,
    },
  };

  if (draft.settings.seed !== null) {
    parameters.seed = draft.settings.seed;
  }

  if (draft.settings.sampler === "k_euler_ancestral") {
    parameters.deliberate_euler_ancestral_bug = false;
    parameters.prefer_brownian = true;
  }

  // V4.5's Variety+ value is known. V5 may use a different threshold, so do not
  // force the V4.5 value onto an unknown/new model.
  if (draft.settings.varietyPlus && draft.settings.model.includes("4-5")) {
    parameters.skip_cfg_above_sigma = 59.04722600415217;
  }

  return {
    action: "generate",
    input: prompt,
    model: draft.settings.model,
    parameters,
  };
}

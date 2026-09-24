/**
 * Maps NovelAI's generation metadata (`Comment` JSON, V3 … V5) onto the app's prompt model and
 * settings. Pure: the store applies the result and keeps the previous state for undo.
 *
 * Prompt mapping keeps the text faithful instead of guessing categories. The app sends
 * `subject tags (lifted from Other) + Artist + Other + Quality` (see `joinPositivePrompt`), so:
 * - Quality: if the base prompt ends with the current Quality text it is left as is and cut from the
 *   base; otherwise Quality is emptied so nothing is added that the image did not have.
 * - Artist: plain `artist:` tags right after the leading subject tags (the app's own layout).
 * - Other: everything else, in order.
 * - Negative: the V4+ negative base caption (NovelAI's stored UC already contains its preset text,
 *   and the app sends ucPreset 0 / qualityToggle false, so the text is used as is).
 */
import { BASE_SUBJECT_TAG, cleanPart } from "../../../adapters/novelai/buildRequest";
import { SAMPLERS } from "../../../adapters/novelai/models";
import type { GenerationSettings } from "../../../types/generation";

export type LoadedCharacter = { prompt: string; negative: string; position: { x: number; y: number } };

export type LoadedGeneration = {
  artistPrompt: string;
  otherPrompt: string;
  qualityPrompt: string;
  negativePrompt: string;
  characters: LoadedCharacter[];
  useCharacterCoords: boolean;
  settings: Partial<GenerationSettings>;
  /** Korean labels of features in the image that the app cannot reproduce. */
  skipped: string[];
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const nonEmpty = (value: unknown) =>
  value !== null && value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0) && value !== "";

const tokens = (value: string) => cleanPart(value).split(",").map((part) => part.trim()).filter(Boolean);
const PLAIN_ARTIST_TAG = /^artist:[^:{}[\]]+$/i;

export function splitBasePrompt(base: string, currentQuality: string) {
  let parts = tokens(base);
  const quality = tokens(currentQuality);
  let qualityPrompt = "";
  if (quality.length && parts.length >= quality.length && quality.every((tag, i) => parts[parts.length - quality.length + i] === tag)) {
    qualityPrompt = currentQuality;
    parts = parts.slice(0, parts.length - quality.length);
  }
  let subjectEnd = 0;
  while (subjectEnd < parts.length && BASE_SUBJECT_TAG.test(parts[subjectEnd])) subjectEnd += 1;
  let artistEnd = subjectEnd;
  while (artistEnd < parts.length && PLAIN_ARTIST_TAG.test(parts[artistEnd])) artistEnd += 1;
  return {
    artistPrompt: parts.slice(subjectEnd, artistEnd).join(", "),
    otherPrompt: [...parts.slice(0, subjectEnd), ...parts.slice(artistEnd)].join(", "),
    qualityPrompt,
  };
}

function captionOf(structured: unknown) {
  const caption = isObject(structured) && isObject(structured.caption) ? structured.caption : null;
  return {
    base: caption ? str(caption.base_caption) : undefined,
    chars: caption && Array.isArray(caption.char_captions) ? caption.char_captions.filter(isObject) : [],
  };
}

const clamp01 = (value: number | undefined, fallback: number) =>
  value === undefined ? fallback : Math.min(1, Math.max(0, value));

function modelFrom(fields: Record<string, string>, comment: Json): GenerationSettings["model"] | undefined {
  const name = `${str(comment.model_name) ?? ""} ${fields.Source ?? ""}`;
  if (/curated/i.test(name)) return "nai-diffusion-5-curated";
  // Only the Full hash seen in real V5 files is trusted; an unknown V5 variant keeps the current model.
  if (/\bfull\b/i.test(name) || /0ADF9AB7/i.test(name)) return "nai-diffusion-5-full";
  return undefined;
}

function parseComment(text: string | undefined): Json | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Null when the fields contain no prompt at all. */
export function mapNovelAiMetadata(fields: Record<string, string>, current: { qualityPrompt: string }): LoadedGeneration | null {
  const comment = parseComment(fields.Comment) ?? {};
  const positive = captionOf(comment.v4_prompt);
  const negative = captionOf(comment.v4_negative_prompt);
  const base = positive.base ?? str(comment.prompt) ?? fields.Description;
  if (base === undefined) return null;

  const skipped: string[] = [];
  const settings: Partial<GenerationSettings> = {};

  const seed = num(comment.seed);
  if (seed !== undefined && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) settings.seed = seed;
  const steps = num(comment.steps);
  if (steps !== undefined && steps >= 1) settings.steps = Math.round(steps);
  const scale = num(comment.scale);
  if (scale !== undefined) settings.guidance = scale;
  const rescale = num(comment.cfg_rescale);
  if (rescale !== undefined) settings.guidanceRescale = rescale;
  const width = num(comment.width);
  const height = num(comment.height);
  if (width !== undefined && height !== undefined && width >= 64 && height >= 64) {
    settings.width = Math.round(width);
    settings.height = Math.round(height);
  }
  const noiseSchedule = str(comment.noise_schedule);
  if (noiseSchedule) settings.noiseSchedule = noiseSchedule;
  const sampler = str(comment.sampler);
  if (sampler) {
    if (SAMPLERS.some((item) => item.value === sampler)) settings.sampler = sampler;
    else skipped.push(`샘플러 ${sampler}`);
  }
  const model = modelFrom(fields, comment);
  if (model) settings.model = model;
  else {
    const modelName = str(comment.model_name) ?? fields.Source;
    if (modelName && !/V5/i.test(modelName)) skipped.push(`모델 ${modelName}`);
  }

  if (nonEmpty(comment.reference_image_multiple) || nonEmpty(comment.reference_information_extracted_multiple)) {
    skipped.push("바이브 트랜스퍼");
  }
  if (nonEmpty(comment.director_reference_images) || nonEmpty(comment.director_reference_descriptions)) {
    skipped.push("캐릭터 레퍼런스");
  }
  if (nonEmpty(comment.image) || /img2img|infill/i.test(str(comment.request_type) ?? "")) skipped.push("이미지 투 이미지 원본");
  if (nonEmpty(comment.mask)) skipped.push("인페인트 마스크");
  if (nonEmpty(comment.controlnet_model)) skipped.push("ControlNet");
  if (comment.sm === true || comment.sm_dyn === true) skipped.push("SMEA");
  if (num(comment.skip_cfg_above_sigma) !== undefined) skipped.push("Variety+");
  if (comment.dynamic_thresholding === true) skipped.push("Decrisp");

  const characters: LoadedCharacter[] = positive.chars.map((caption, index) => {
    const center = Array.isArray(caption.centers) && isObject(caption.centers[0]) ? caption.centers[0] : {};
    return {
      prompt: str(caption.char_caption) ?? "",
      negative: str(negative.chars[index]?.char_caption) ?? "",
      position: { x: clamp01(num(center.x), 0.5), y: clamp01(num(center.y), 0.5) },
    };
  });
  const coords = isObject(comment.v4_prompt) ? comment.v4_prompt.use_coords : undefined;

  return {
    ...splitBasePrompt(base, current.qualityPrompt),
    negativePrompt: negative.base ?? str(comment.uc) ?? str(comment.negative_prompt) ?? "",
    characters,
    useCharacterCoords: coords === true,
    settings,
    skipped,
  };
}

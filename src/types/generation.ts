export type NovelAiV5Model="nai-diffusion-5-full"|"nai-diffusion-5-curated";
export type PromptSectionKey="artist"|"other"|"quality"|"negative";
export type CharacterPrompt={id:string;name:string;prompt:string;negative:string;enabled:boolean;position:{x:number;y:number}};
export type GenerationSettings={model:NovelAiV5Model;width:number;height:number;steps:number;guidance:number;guidanceRescale:number;sampler:string;noiseSchedule:string;seed:number|null};
export type GenerationImage={src:string;filePath:string;index:number;seed:number|null;width:number;height:number;positivePrompt:string;kind:"generation"|"upscale";createdAt:number;
  /** The character the 🎲 drew for this image (random character mode). */
  randomCharacter?:{display:string;series:string}};
export type GenerationStatus="idle"|"generating"|"upscaling"|"success"|"error";

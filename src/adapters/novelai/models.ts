import type { NovelAiV5Model } from "../../types/generation";
export const V5_MODELS:{label:string;value:NovelAiV5Model}[]=[{label:"V5 Full",value:"nai-diffusion-5-full"},{label:"V5 Curated",value:"nai-diffusion-5-curated"}];
export const SAMPLERS=[{label:"Euler Ancestral",value:"k_euler_ancestral"},{label:"DPM++ 2M",value:"k_dpmpp_2m"},{label:"DPM++ SDE",value:"k_dpmpp_sde"},{label:"Euler",value:"k_euler"}] as const;
export function isV5FullModel(value:NovelAiV5Model){return value==="nai-diffusion-5-full"||value==="nai-diffusion-5-full-medium";}
export function isMediumEffortModel(value:NovelAiV5Model){return value==="nai-diffusion-5-full-medium";}
export function modelLabel(value:NovelAiV5Model){if(value==="nai-diffusion-5-full-medium")return "V5 Full (Medium)";return V5_MODELS.find(x=>x.value===value)?.label??value;}
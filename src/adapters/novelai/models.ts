export const NOVELAI_MODELS = [
  { label: "NAI Diffusion V5", value: "nai-diffusion-5", experimental: true },
  { label: "NAI Diffusion V4.5 Full", value: "nai-diffusion-4-5-full" },
  { label: "NAI Diffusion V4.5 Curated", value: "nai-diffusion-4-5-curated" },
  { label: "NAI Diffusion V4 Full", value: "nai-diffusion-4-full" },
  { label: "NAI Diffusion V4 Curated", value: "nai-diffusion-4-curated-preview" },
] as const;

export function getModelLabel(value: string) {
  return NOVELAI_MODELS.find((item) => item.value === value)?.label ?? value;
}

export const SAMPLERS = [
  { label: "Euler Ancestral", value: "k_euler_ancestral" },
  { label: "Euler", value: "k_euler" },
  { label: "DPM++ 2M", value: "k_dpmpp_2m" },
  { label: "DPM++ SDE", value: "k_dpmpp_sde" },
] as const;

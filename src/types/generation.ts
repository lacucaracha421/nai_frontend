export type SidebarTab = "prompt" | "generator" | "options" | "automation";
export type WorkspaceTab = "generate" | "characters";

export type CharacterPrompt = {
  id: string;
  prompt: string;
  negative: string;
  enabled: boolean;
  position: { x: number; y: number };
  positionLabel: string;
};

export type GenerationSettings = {
  model: string;
  preset: string;
  width: number;
  height: number;
  steps: number;
  guidance: number;
  guidanceRescale: number;
  varietyPlus: boolean;
  sampler: string;
  noiseSchedule: string;
  seed: number | null;
  count: number;
};

export type GenerationImage = {
  dataUrl: string;
  index: number;
  seed: number | null;
};

export type GenerationStatus = "idle" | "generating" | "success" | "error";

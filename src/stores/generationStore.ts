import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buildNovelAiRequest } from "../adapters/novelai/buildRequest";
import { generateNovelAiImage } from "../adapters/novelai/client";
import type { CharacterPrompt, GenerationImage, GenerationSettings, GenerationStatus } from "../types/generation";

const createCharacter = (index: number): CharacterPrompt => ({
  id: crypto.randomUUID(),
  prompt: index === 0 ? "1girl, long hair, blue eyes" : "",
  negative: "",
  enabled: index === 0,
  position: { x: 0.5, y: 0.5 },
  positionLabel: index === 0 ? "C3" : "B3",
});

type GenerationState = {
  beginningPrompt: string;
  endingPrompt: string;
  negativePrompt: string;
  characters: CharacterPrompt[];
  aiPosition: boolean;
  settings: GenerationSettings;
  status: GenerationStatus;
  images: GenerationImage[];
  activeImage: number;
  errorMessage: string | null;
  lastGeneratedAt: number | null;
  setBeginningPrompt: (value: string) => void;
  setEndingPrompt: (value: string) => void;
  setNegativePrompt: (value: string) => void;
  setAiPosition: (value: boolean) => void;
  setSetting: <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => void;
  addCharacter: () => void;
  removeCharacter: (id: string) => void;
  updateCharacter: (id: string, patch: Partial<CharacterPrompt>) => void;
  insertPromptText: (value: string) => void;
  setActiveImage: (index: number) => void;
  clearError: () => void;
  generate: () => Promise<void>;
};

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set, get) => ({
      beginningPrompt: "1girl,",
      endingPrompt: ", meta:golden era,",
      negativePrompt: "anime screenshot, anime coloring, censored, bar censor",
      characters: [createCharacter(0), createCharacter(1)],
      aiPosition: false,
      settings: {
        model: "nai-diffusion-4-5-full",
        preset: "Normal Portrait",
        width: 832,
        height: 1216,
        steps: 28,
        guidance: 5.5,
        guidanceRescale: 0.15,
        varietyPlus: false,
        sampler: "k_euler_ancestral",
        noiseSchedule: "karras",
        seed: null,
        count: 1,
      },
      status: "idle",
      images: [],
      activeImage: 0,
      errorMessage: null,
      lastGeneratedAt: null,
      setBeginningPrompt: (beginningPrompt) => set({ beginningPrompt }),
      setEndingPrompt: (endingPrompt) => set({ endingPrompt }),
      setNegativePrompt: (negativePrompt) => set({ negativePrompt }),
      setAiPosition: (aiPosition) => set({ aiPosition }),
      setSetting: (key, value) => set((state) => ({ settings: { ...state.settings, [key]: value } })),
      addCharacter: () => set((state) => ({ characters: [...state.characters, createCharacter(state.characters.length)] })),
      removeCharacter: (id) => set((state) => ({ characters: state.characters.filter((item) => item.id !== id) })),
      updateCharacter: (id, patch) => set((state) => ({
        characters: state.characters.map((item) => item.id === id ? { ...item, ...patch } : item),
      })),
      insertPromptText: (value) => set((state) => ({
        beginningPrompt: state.beginningPrompt.trim()
          ? `${state.beginningPrompt.replace(/\s+$/, "")}${state.beginningPrompt.trim().endsWith(",") ? " " : ", "}${value}`
          : value,
      })),
      setActiveImage: (activeImage) => set({ activeImage }),
      clearError: () => set({ errorMessage: null, status: "idle" }),
      generate: async () => {
        const state = get();
        set({ status: "generating", errorMessage: null });
        try {
          const request = buildNovelAiRequest({
            beginningPrompt: state.beginningPrompt,
            endingPrompt: state.endingPrompt,
            negativePrompt: state.negativePrompt,
            characters: state.characters,
            aiPosition: state.aiPosition,
            settings: state.settings,
          });
          const result = await generateNovelAiImage(request);
          const images = result.map((item) => ({
            dataUrl: item.image.startsWith("data:") ? item.image : `data:image/png;base64,${item.image}`,
            index: item.index,
            seed: item.seed,
          }));
          if (!images.length) throw new Error("NovelAI 응답에 이미지가 없답니다.");
          set({
            status: "success",
            images,
            activeImage: 0,
            errorMessage: null,
            lastGeneratedAt: Date.now(),
          });
        } catch (error) {
          set({
            status: "error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      },
    }),
    {
      name: "nai-frontend-generation-v0.2",
      partialize: (state) => ({
        beginningPrompt: state.beginningPrompt,
        endingPrompt: state.endingPrompt,
        negativePrompt: state.negativePrompt,
        characters: state.characters,
        aiPosition: state.aiPosition,
        settings: state.settings,
      }),
    },
  ),
);

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buildNovelAiRequest, joinPositivePrompt } from "../adapters/novelai/buildRequest";
import { cachedImageSrc, generateNovelAiImage, upscaleNovelAiImage } from "../adapters/novelai/client";
import type {
  CharacterPrompt,
  GenerationImage,
  GenerationSettings,
  GenerationStatus,
  PromptSectionKey,
} from "../types/generation";

const DEFAULT_SETTINGS: GenerationSettings = {
  model: "nai-diffusion-5-full",
  width: 832,
  height: 1216,
  steps: 28,
  guidance: 5,
  guidanceRescale: 0.15,
  sampler: "k_euler_ancestral",
  noiseSchedule: "karras",
  seed: null,
};

const newCharacter = (index: number): CharacterPrompt => ({
  id: crypto.randomUUID(),
  name: "",
  prompt: "",
  negative: "",
  enabled: true,
  position: {
    x: Math.min(0.85, 0.3 + (index % 3) * 0.2),
    y: Math.min(0.85, 0.35 + Math.floor(index / 3) * 0.18),
  },
});

const isBusy = (status: GenerationStatus) => status === "generating" || status === "upscaling";

type State = {
  artistPrompt: string;
  otherPrompt: string;
  qualityPrompt: string;
  negativePrompt: string;
  characters: CharacterPrompt[];
  useCharacterCoords: boolean;
  settings: GenerationSettings;
  status: GenerationStatus;
  images: GenerationImage[];
  activeImage: number;
  errorMessage: string | null;
  setPrompt: (key: PromptSectionKey, value: string) => void;
  appendPrompt: (key: PromptSectionKey, value: string) => void;
  setSetting: <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => void;
  addCharacter: () => void;
  removeCharacter: (id: string) => void;
  updateCharacter: (id: string, patch: Partial<CharacterPrompt>) => void;
  setUseCharacterCoords: (value: boolean) => void;
  setActiveImage: (index: number) => void;
  clearSessionImages: () => void;
  clearError: () => void;
  useSeed: (seed: number | null) => void;
  positivePrompt: () => string;
  generate: () => Promise<void>;
  upscaleActive: () => Promise<void>;
};

const append = (base: string, value: string) => {
  const clean = value.replace(/_/g, " ").trim();
  if (!clean) return base;
  return base.trim() ? `${base.trim().replace(/,\s*$/, "")}, ${clean}` : clean;
};

function migratePersistedState(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const persisted = value as Partial<State>;
  const characters = Array.isArray(persisted.characters)
    ? persisted.characters.map((character, index) => ({
        ...newCharacter(index),
        ...character,
        name: /^Character \d+$/.test(character?.name ?? "") ? "" : (character?.name ?? ""),
        position: { ...newCharacter(index).position, ...(character?.position ?? {}) },
      }))
    : [newCharacter(0)];
  return {
    ...persisted,
    characters,
    settings: { ...DEFAULT_SETTINGS, ...(persisted.settings ?? {}) },
  };
}

export const useGenerationStore = create<State>()(
  persist(
    (set, get) => ({
      artistPrompt: "",
      otherPrompt: "",
      qualityPrompt: "high complexity",
      negativePrompt: "",
      characters: [newCharacter(0)],
      useCharacterCoords: false,
      settings: { ...DEFAULT_SETTINGS },
      status: "idle",
      images: [],
      activeImage: 0,
      errorMessage: null,

      setPrompt: (key, value) => set({ [`${key}Prompt`]: value } as Partial<State>),
      appendPrompt: (key, value) =>
        set((state) => ({
          [`${key}Prompt`]: append((state as unknown as Record<string, string>)[`${key}Prompt`], value),
        } as Partial<State>)),
      setSetting: (key, value) => set((state) => ({ settings: { ...state.settings, [key]: value } })),
      addCharacter: () => set((state) => ({ characters: [...state.characters, newCharacter(state.characters.length)] })),
      removeCharacter: (id) => set((state) => ({ characters: state.characters.filter((character) => character.id !== id) })),
      updateCharacter: (id, patch) =>
        set((state) => ({ characters: state.characters.map((character) => character.id === id ? { ...character, ...patch } : character) })),
      setUseCharacterCoords: (useCharacterCoords) => set({ useCharacterCoords }),
      setActiveImage: (activeImage) => set({ activeImage }),
      clearSessionImages: () => set({ images: [], activeImage: 0 }),
      clearError: () => set({ errorMessage: null, status: "idle" }),
      useSeed: (seed) => set((state) => ({ settings: { ...state.settings, seed } })),
      positivePrompt: () => joinPositivePrompt(get()),

      generate: async () => {
        const snapshot = get();
        if (isBusy(snapshot.status)) return;
        set({ status: "generating", errorMessage: null });
        try {
          const request = buildNovelAiRequest(snapshot);
          const result = await generateNovelAiImage(request);
          const positivePrompt = joinPositivePrompt(snapshot);
          const createdAt = Date.now();
          const incoming = result.map((image) => ({
            src: cachedImageSrc(image.path),
            filePath: image.path,
            index: image.index,
            seed: image.seed,
            width: image.width,
            height: image.height,
            positivePrompt,
            kind: "generation" as const,
            createdAt,
          }));
          if (!incoming.length) throw new Error("NovelAI 응답에 이미지가 없사와요.");
          set((state) => ({
            status: "success",
            images: [...state.images, ...incoming],
            activeImage: state.images.length,
            errorMessage: null,
          }));
        } catch (error) {
          set({ status: "error", errorMessage: error instanceof Error ? error.message : String(error) });
        }
      },

      upscaleActive: async () => {
        const snapshot = get();
        if (isBusy(snapshot.status)) return;
        const image = snapshot.images[snapshot.activeImage];
        if (!image) return;
        if (image.width * image.height > 1024 * 1024) {
          set({
            status: "error",
            errorMessage: "전용 Upscale은 1024×1024 픽셀 면적 이하 원본에서 사용하도록 공식 문서에 안내되어 있사와요.",
          });
          return;
        }
        set({ status: "upscaling", errorMessage: null });
        try {
          const result = await upscaleNovelAiImage(image.filePath);
          const createdAt = Date.now();
          const incoming = result.map((upscaled) => ({
            src: cachedImageSrc(upscaled.path),
            filePath: upscaled.path,
            index: upscaled.index,
            seed: image.seed,
            width: upscaled.width,
            height: upscaled.height,
            positivePrompt: image.positivePrompt,
            kind: "upscale" as const,
            createdAt,
          }));
          if (!incoming.length) throw new Error("Upscale 응답에 이미지가 없사와요.");
          set((state) => ({
            status: "success",
            images: [...state.images, ...incoming],
            activeImage: state.images.length,
            errorMessage: null,
          }));
        } catch (error) {
          set({ status: "error", errorMessage: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
    {
      name: "nai-v5-s11-generation-v0.3",
      version: 1,
      migrate: (persisted) => migratePersistedState(persisted) as State,
      merge: (persisted, current) => {
        const migrated = migratePersistedState(persisted) as Partial<State>;
        return {
          ...current,
          ...migrated,
          settings: { ...DEFAULT_SETTINGS, ...(migrated.settings ?? {}) },
          // Session output is deliberately never restored across app launches.
          images: [],
          activeImage: 0,
          status: "idle",
          errorMessage: null,
        };
      },
      partialize: (state) => ({
        artistPrompt: state.artistPrompt,
        otherPrompt: state.otherPrompt,
        qualityPrompt: state.qualityPrompt,
        negativePrompt: state.negativePrompt,
        characters: state.characters,
        useCharacterCoords: state.useCharacterCoords,
        settings: state.settings,
      }),
    },
  ),
);

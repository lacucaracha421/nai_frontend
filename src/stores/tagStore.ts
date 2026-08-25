import { create } from "zustand";
import { persist } from "zustand/middleware";

type State = {
  favorites: string[];
  toggleFavorite: (tag: string) => void;
  removeFavorites: (tags: string[]) => void;
  isFavorite: (tag: string) => boolean;
};

export const useTagStore = create<State>()(
  persist(
    (set, get) => ({
      favorites: [],
      toggleFavorite: (tag) => set((state) => ({
        favorites: state.favorites.includes(tag)
          ? state.favorites.filter((value) => value !== tag)
          : [tag, ...state.favorites],
      })),
      removeFavorites: (tags) => set((state) => {
        const removing = new Set(tags);
        return { favorites: state.favorites.filter((value) => !removing.has(value)) };
      }),
      isFavorite: (tag) => get().favorites.includes(tag),
    }),
    { name: "nai-v5-local-tag-favorites" },
  ),
);

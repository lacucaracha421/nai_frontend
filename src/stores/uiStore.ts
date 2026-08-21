import { create } from "zustand";
import type { SidebarTab, WorkspaceTab } from "../types/generation";

type UiState = {
  sidebarTab: SidebarTab;
  workspaceTab: WorkspaceTab;
  libraryOpen: boolean;
  setSidebarTab: (tab: SidebarTab) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  setLibraryOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  sidebarTab: "prompt",
  workspaceTab: "generate",
  libraryOpen: false,
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
}));

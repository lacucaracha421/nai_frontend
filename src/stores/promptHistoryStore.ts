import { create } from "zustand";

export type PromptSnapshot = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

type PromptHistory = {
  past: PromptSnapshot[];
  future: PromptSnapshot[];
};

type State = {
  histories: Record<string, PromptHistory>;
  checkpoint: (key: string, snapshot: PromptSnapshot) => void;
  clearFuture: (key: string) => void;
  undo: (key: string, current: PromptSnapshot) => PromptSnapshot | null;
  redo: (key: string, current: PromptSnapshot) => PromptSnapshot | null;
  reset: (key: string) => void;
};

const HISTORY_LIMIT = 100;
const EMPTY_HISTORY: PromptHistory = { past: [], future: [] };

function sameSnapshot(a: PromptSnapshot | undefined, b: PromptSnapshot) {
  return !!a && a.value === b.value && a.selectionStart === b.selectionStart && a.selectionEnd === b.selectionEnd;
}
export const usePromptHistoryStore = create<State>((set, get) => ({
  histories: {},

  checkpoint: (key, snapshot) => {
    const history = get().histories[key] ?? EMPTY_HISTORY;
    if (sameSnapshot(history.past[history.past.length - 1], snapshot)) {
      if (history.future.length) {
        set((state) => ({
          histories: { ...state.histories, [key]: { ...history, future: [] } },
        }));
      }
      return;
    }
    set((state) => ({
      histories: {
        ...state.histories,
        [key]: {
          past: [...history.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
        },
      },
    }));
  },

  clearFuture: (key) => {
    const history = get().histories[key];
    if (!history?.future.length) return;
    set((state) => ({
      histories: { ...state.histories, [key]: { ...history, future: [] } },
    }));
  },
  undo: (key, current) => {
    const history = get().histories[key] ?? EMPTY_HISTORY;
    const target = history.past[history.past.length - 1];
    if (!target) return null;
    set((state) => ({
      histories: {
        ...state.histories,
        [key]: {
          past: history.past.slice(0, -1),
          future: [...history.future, current].slice(-HISTORY_LIMIT),
        },
      },
    }));
    return target;
  },

  redo: (key, current) => {
    const history = get().histories[key] ?? EMPTY_HISTORY;
    const target = history.future[history.future.length - 1];
    if (!target) return null;
    set((state) => ({
      histories: {
        ...state.histories,
        [key]: {
          past: [...history.past, current].slice(-HISTORY_LIMIT),
          future: history.future.slice(0, -1),
        },
      },
    }));
    return target;
  },

  reset: (key) => set((state) => {
    const histories = { ...state.histories };
    delete histories[key];
    return { histories };
  }),
}));

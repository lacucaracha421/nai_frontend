import { create } from "zustand"; import { persist } from "zustand/middleware";
type State={showFixedPrompts:boolean;setShowFixedPrompts:(v:boolean)=>void};
export const useUiStore=create<State>()(persist(set=>({showFixedPrompts:false,setShowFixedPrompts:(showFixedPrompts)=>set({showFixedPrompts})}),{name:"nai-v5-s11-ui"}));
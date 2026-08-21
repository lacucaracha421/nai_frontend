import { invoke } from "@tauri-apps/api/core";
import type { NovelAiGeneratedImage, NovelAiImageRequest } from "./types";

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function setNovelAiToken(token: string) {
  if (!isTauriRuntime()) {
    throw new Error("NovelAI 연결은 데스크톱(Tauri) 모드에서만 사용할 수 있답니다. npm.cmd run tauri:dev 로 실행해주시와요.");
  }
  await invoke("set_novelai_token", { token });
}

export async function clearNovelAiToken() {
  if (!isTauriRuntime()) return;
  await invoke("clear_novelai_token");
}

export async function testNovelAiConnection() {
  if (!isTauriRuntime()) {
    throw new Error("현재는 브라우저 미리보기 모드랍니다. npm.cmd run tauri:dev 로 실행해야 NovelAI에 연결할 수 있사와요.");
  }
  return invoke<string>("test_novelai_connection");
}

export async function generateNovelAiImage(request: NovelAiImageRequest) {
  if (!isTauriRuntime()) {
    throw new Error("현재는 브라우저 미리보기 모드랍니다. npm.cmd run tauri:dev 로 실행해야 실제 생성이 가능하와요.");
  }
  return invoke<NovelAiGeneratedImage[]>("novelai_generate", { request });
}

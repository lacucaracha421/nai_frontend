import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { NovelAiGeneratedImage, NovelAiImageRequest } from "./types";
import type { NovelAiV5Model } from "../../types/generation";

export type NovelAiQuota = {
  anlas: number | null;
  subscriptionAnlas: number | null;
  paidAnlas: number | null;
  tier: number | null;
};


export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function cachedImageSrc(path: string) {
  return isTauriRuntime() ? convertFileSrc(path) : path;
}

export async function setNovelAiToken(token: string) {
  if (!isTauriRuntime()) throw new Error("실제 NovelAI 연결은 Tauri 앱에서 사용할 수 있사와요.");
  await invoke("set_novelai_token", { token });
}

export async function restoreNovelAiToken() {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("restore_novelai_token");
}

export async function clearNovelAiToken() {
  if (isTauriRuntime()) await invoke("clear_novelai_token");
}

export async function testNovelAiConnection() {
  if (!isTauriRuntime()) throw new Error("브라우저는 UI 미리보기 모드랍니다.");
  return invoke<string>("test_novelai_connection");
}


export async function getNovelAiQuota() {
  if (!isTauriRuntime()) return null;
  return invoke<NovelAiQuota>("novelai_quota");
}

export async function generateNovelAiImage(request: NovelAiImageRequest) {
  if (!isTauriRuntime()) throw new Error("브라우저 미리보기에서는 실제 생성 요청을 보내지 않사와요.");
  return invoke<NovelAiGeneratedImage[]>("novelai_generate", { request });
}

export async function upscaleNovelAiImage(imagePath: string) {
  if (!isTauriRuntime()) throw new Error("브라우저 미리보기에서는 업스케일 요청을 보내지 않사와요.");
  return invoke<NovelAiGeneratedImage[]>("novelai_upscale", { imagePath });
}


export async function saveNovelAiImage(imageSrc: string, filename: string) {
  if (!isTauriRuntime()) {
    const blob = await fetch(imageSrc).then((response) => response.blob());
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return filename;
  }

  const target = await save({
    defaultPath: filename,
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (!target) return null;

  const response = await fetch(imageSrc);
  if (!response.ok) {
    throw new Error(`저장할 이미지를 읽지 못했습니다. (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(target, bytes);
  return target;
}

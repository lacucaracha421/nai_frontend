import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { apiJson, isTauriRuntime, isWebServerRuntime } from "../webApi";
import type { NovelAiGeneratedImage, NovelAiImageRequest } from "./types";
import type { NovelAiV5Model } from "../../types/generation";

export { isTauriRuntime, isWebServerRuntime };

/** V5 usage limit ("battery") from `/user/subscription`; any field may be missing. */
export type NovelAiUsage = {
  percent: number | null;
  isNegative: boolean | null;
  /** Unit not documented by NovelAI; observed values look like seconds. */
  timeUntilNextPercent: number | null;
};

export type NovelAiQuota = {
  anlas: number | null;
  subscriptionAnlas: number | null;
  paidAnlas: number | null;
  tier: number | null;
  usage?: NovelAiUsage | null;
};

export function cachedImageSrc(path: string) {
  return isTauriRuntime() ? convertFileSrc(path) : path;
}

export async function setNovelAiToken(token: string) {
  if (isTauriRuntime()) {
    await invoke("set_novelai_token", { token });
    return;
  }
  if (isWebServerRuntime()) {
    await apiJson("/api/novelai/token", { method: "POST", body: JSON.stringify({ token }) });
    return;
  }
  throw new Error("실제 NovelAI 연결은 Tauri 앱이나 웹 서버에서 사용할 수 있사와요.");
}

export async function restoreNovelAiToken() {
  if (isTauriRuntime()) return invoke<boolean>("restore_novelai_token");
  if (isWebServerRuntime()) {
    const res = await apiJson<{ connected: boolean }>("/api/novelai/token/status");
    return Boolean(res.connected);
  }
  return false;
}

export async function exportNovelAiToken() {
  if (isTauriRuntime()) return invoke<string | null>("export_novelai_token");
  if (isWebServerRuntime()) {
    const res = await apiJson<{ token: string | null }>("/api/novelai/token/export");
    return res.token ?? null;
  }
  return null;
}

export async function clearNovelAiToken() {
  if (isTauriRuntime()) {
    await invoke("clear_novelai_token");
    return;
  }
  if (isWebServerRuntime()) {
    await apiJson("/api/novelai/token", { method: "DELETE" });
  }
}

export async function testNovelAiConnection() {
  if (isTauriRuntime()) return invoke<string>("test_novelai_connection");
  if (isWebServerRuntime()) {
    const res = await apiJson<{ message: string }>("/api/novelai/test", { method: "POST" });
    return res.message;
  }
  throw new Error("브라우저는 UI 미리보기 모드랍니다.");
}

export async function getNovelAiQuota() {
  if (isTauriRuntime()) return invoke<NovelAiQuota>("novelai_quota");
  if (isWebServerRuntime()) return apiJson<NovelAiQuota>("/api/novelai/quota");
  return null;
}

export async function generateNovelAiImage(request: NovelAiImageRequest, referenceImages?: string[]) {
  if (isTauriRuntime()) {
    return invoke<NovelAiGeneratedImage[]>("novelai_generate", {
      request,
      ...(referenceImages && referenceImages.length > 0 ? { referenceImages } : {}),
    });
  }
  if (isWebServerRuntime()) {
    return apiJson<NovelAiGeneratedImage[]>("/api/novelai/generate", {
      method: "POST",
      body: JSON.stringify({
        request,
        ...(referenceImages && referenceImages.length > 0 ? { referenceImages } : {}),
      }),
    });
  }
  throw new Error("브라우저 미리보기에서는 실제 생성 요청을 보내지 않사와요.");
}

export async function upscaleNovelAiImage(imagePath: string) {
  if (isTauriRuntime()) return invoke<NovelAiGeneratedImage[]>("novelai_upscale", { imagePath });
  if (isWebServerRuntime()) {
    return apiJson<NovelAiGeneratedImage[]>("/api/novelai/upscale", {
      method: "POST",
      body: JSON.stringify({ imagePath }),
    });
  }
  throw new Error("브라우저 미리보기에서는 업스케일 요청을 보내지 않사와요.");
}


export async function readImageBytes(imageSrc: string) {
  const response = await fetch(imageSrc);
  if (!response.ok) {
    throw new Error(`저장할 이미지를 읽지 못했습니다. (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Saves PNG or WebP bytes straight into the app save folder (no file picker).
 * Desktop: Pictures/NAI V5 Studio. Android: shared Pictures/NAI V5 Studio.
 * Returns the saved path; an existing name gets a numeric suffix.
 */
export async function saveImageBytes(bytes: Uint8Array, filename: string) {
  if (!isTauriRuntime()) {
    const type = /\.webp$/i.test(filename) ? "image/webp" : "image/png";
    const blob = new Blob([bytes as BlobPart], { type });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return filename;
  }
  // Android IPC is JSON-only. Encode in bounded chunks to avoid spreading a
  // full upscaled image onto the JS stack; Rust decodes before format detection.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return invoke<string>("save_image", { imageBase64: btoa(chunks.join("")), filename });
}

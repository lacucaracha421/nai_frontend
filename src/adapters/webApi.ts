export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isWebServerRuntime() {
  if (typeof window === "undefined" || isTauriRuntime()) return false;
  const protocol = window.location?.protocol ?? "";
  return protocol === "http:" || protocol === "https:";
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : typeof parsed === "string" && parsed.trim()
          ? parsed.trim()
          : `서버 요청 실패 (${response.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

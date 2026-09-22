import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Exercise the actual Rust-injected script; no copy of the bridge implementation.
const source = readFileSync(new URL("../../../src-tauri/src/prombot.rs", import.meta.url), "utf8");
const script = source.match(/const PROMBOT_BRIDGE_SCRIPT: &str = r#"([\s\S]*?)"#;/)[1];

function bridge(origin = "https://prombot.net", topLevel = true) {
  class Storage {
    data = new Map();
    getItem(key) { return this.data.get(key) ?? null; }
    setItem(key, value) { this.data.set(key, value); }
    removeItem(key) { this.data.delete(key); }
    clear() { this.data.clear(); }
  }
  const localStorage = new Storage();
  const location = { origin, href: "" };
  const window = {};
  window.top = topLevel ? window : {};
  runInNewContext(script, {
    window, location, localStorage, Storage, encodeURIComponent,
    addEventListener() {}, setInterval() {}, setTimeout(fn) { fn(); },
  });
  return { localStorage, location };
}

describe("Prombot bridge security and updates", () => {
  it("reads only the favorites key and publishes changes immediately, including removal", () => {
    const { localStorage, location } = bridge();
    expect(new URL(location.href).searchParams.get("payload")).toBe("[]");
    localStorage.setItem("unrelated-secret", "not exported");
    expect(location.href).not.toContain("not exported");
    localStorage.setItem("prombot:charFavorites", '["miku"]');
    expect(new URL(location.href).searchParams.get("payload")).toBe('["miku"]');
    localStorage.removeItem("prombot:charFavorites");
    expect(new URL(location.href).searchParams.get("payload")).toBe("[]");
    localStorage.setItem("prombot:charFavorites", '["reimu"]');
    localStorage.clear();
    expect(new URL(location.href).searchParams.get("payload")).toBe("[]");
  });

  it("does not install the bridge on other origins or subframes", () => {
    for (const [origin, top] of [["https://evil.test", true], ["https://prombot.net", false]]) {
      const { localStorage, location } = bridge(origin, top);
      localStorage.setItem("prombot:charFavorites", '["miku"]');
      expect(location.href).toBe("");
    }
  });

  it("keeps clipboard and IPC capability confined to the main local window", () => {
    const capability = JSON.parse(readFileSync(new URL("../../../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
    expect(capability.windows).toEqual(["main"]);
    expect(capability.remote).toBeUndefined();
    expect(capability.permissions).toContain("clipboard-manager:allow-write-text");
  });
});

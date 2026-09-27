import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps the removed website name only in catalog provenance and the image source", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const needle = new RegExp("prom" + "bot", "i");
  const unexpected = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(?:ts|tsx|mjs|rs|css)$/.test(path)) {
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (needle.test(line) && !(path.endsWith("character_catalog.rs") && (line.startsWith("//! ") || line.includes("include_bytes!") || line.includes("https://huggingface.co/")))) unexpected.push(path + ": " + line);
        }
      }
    }
  }
  scan(join(root, "src")); scan(join(root, "src-tauri/src"));
  expect(unexpected).toEqual([]);
});

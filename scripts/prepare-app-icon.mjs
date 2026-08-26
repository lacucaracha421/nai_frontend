import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const encodedPath = path.join(root, "src-tauri", "icons", "nai-v5-studio-source.b64");
const pngPath = path.join(root, "src-tauri", "icons", "nai-v5-studio-source.png");

const encoded = fs.readFileSync(encodedPath, "utf8").trim();
if (!encoded) throw new Error("App icon base64 source is empty.");

const png = Buffer.from(encoded, "base64");
if (png.length < 1000 || png.subarray(1, 4).toString("ascii") !== "PNG") {
  throw new Error("Decoded app icon is not a valid PNG.");
}

fs.writeFileSync(pngPath, png);
console.log(`Prepared app icon source: ${pngPath} (${png.length} bytes)`);

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";

const input = process.argv[2];
const output = process.argv[3] ?? path.resolve("public/data/danbooru-tags.json");
if (!input) {
  console.error("Usage: node scripts/import-danbooru.mjs <tags.json|jsonl|csv[.gz]> [output.json]");
  process.exit(1);
}

const normalize = (row) => {
  const name = String(row.name ?? row.tag ?? row.tag_name ?? "").trim();
  if (!name) return null;
  const categoryRaw = row.category ?? row.category_id ?? row.type ?? 0;
  const category = /^-?\d+$/.test(String(categoryRaw)) ? Number(categoryRaw) : categoryRaw;
  const post_count = Number(row.post_count ?? row.count ?? row.posts ?? 0) || 0;
  let aliases = row.aliases ?? row.alias ?? [];
  if (typeof aliases === "string") aliases = aliases.split(/[|;]/).map((x) => x.trim()).filter(Boolean);
  if (!Array.isArray(aliases)) aliases = [];
  return { name, category, post_count, aliases };
};

function csvLine(line) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { out.push(value); value = ""; }
    else value += ch;
  }
  out.push(value);
  return out;
}

function openStream(file) {
  const raw = fs.createReadStream(file);
  return file.toLowerCase().endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
}

async function parseLines(file, format) {
  const rl = readline.createInterface({ input: openStream(file), crlfDelay: Infinity });
  const rows = [];
  let headers = null;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (format === "jsonl") {
      const item = normalize(JSON.parse(trimmed));
      if (item) rows.push(item);
      continue;
    }
    const cols = csvLine(line);
    if (!headers) { headers = cols.map((x) => x.trim()); continue; }
    const row = Object.fromEntries(headers.map((key, i) => [key, cols[i] ?? ""]));
    const item = normalize(row);
    if (item) rows.push(item);
  }
  return rows;
}

const lower = input.toLowerCase().replace(/\.gz$/, "");
let rows;
if (lower.endsWith(".json")) {
  const bytes = fs.readFileSync(input);
  const text = input.toLowerCase().endsWith(".gz")
    ? (await import("node:zlib")).gunzipSync(bytes).toString("utf8")
    : bytes.toString("utf8");
  const parsed = JSON.parse(text);
  const source = Array.isArray(parsed) ? parsed : (parsed.tags ?? parsed.data ?? []);
  rows = source.map(normalize).filter(Boolean);
} else if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
  rows = await parseLines(input, "jsonl");
} else if (lower.endsWith(".csv")) {
  rows = await parseLines(input, "csv");
} else {
  throw new Error(`Unsupported input: ${input}`);
}

rows.sort((a, b) => b.post_count - a.post_count || a.name.localeCompare(b.name));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(rows));
console.log(`Imported ${rows.length.toLocaleString()} tags -> ${output}`);

import { rm } from "node:fs/promises";
import { resolve } from "node:path";

// Production uses the bundled SQLite index through Rust. Do not ship the 65+ MiB
// source JSON shards a second time inside frontendDist.
await rm(resolve("dist/data/danbooru"), { recursive: true, force: true });

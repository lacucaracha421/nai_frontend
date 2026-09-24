/** Test-only builders for PNG text chunks, WebP containers and stealth alpha images. */
import type { RgbaImage } from "../finish/finishFilter";

const ascii = (text: string) => new TextEncoder().encode(text);

export async function compress(text: string, format: "gzip" | "deflate") {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(ascii(type), 4);
  out.set(data, 8);
  return out; // CRC left zero: the reader does not check it.
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export type PngText =
  | { type: "tEXt"; keyword: string; text: string }
  | { type: "zTXt"; keyword: string; text: string }
  | { type: "iTXt"; keyword: string; text: string; compressed?: boolean };

export async function pngWithText(fields: PngText[]) {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 1);
  new DataView(ihdr.buffer).setUint32(4, 1);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const text: Uint8Array[] = [];
  for (const field of fields) {
    const keyword = concat(ascii(field.keyword), new Uint8Array([0]));
    if (field.type === "tEXt") text.push(chunk("tEXt", concat(keyword, new TextEncoder().encode(field.text))));
    else if (field.type === "zTXt") text.push(chunk("zTXt", concat(keyword, new Uint8Array([0]), await compress(field.text, "deflate"))));
    else {
      const body = field.compressed ? await compress(field.text, "deflate") : new TextEncoder().encode(field.text);
      text.push(chunk("iTXt", concat(keyword, new Uint8Array([field.compressed ? 1 : 0, 0, 0, 0]), body)));
    }
  }
  return concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...text, chunk("IEND", new Uint8Array()));
}

/** A simple-format lossy WebP shell (VP8 payload is not a real bitstream; only the container matters). */
export function simpleWebp() {
  const vp8 = new Uint8Array([1, 2, 3, 4]);
  const body = concat(ascii("WEBP"), ascii("VP8 "), new Uint8Array([4, 0, 0, 0]), vp8);
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, body.length, true);
  return concat(ascii("RIFF"), size, body);
}

/** Writes magic + 32-bit big-endian bit length + payload into alpha LSBs, column-major, MSB first. */
export async function stealthImage(magic: "stealth_pngcomp" | "stealth_pnginfo", json: string, width = 64, height = 48): Promise<RgbaImage> {
  const payload = magic === "stealth_pngcomp" ? await compress(json, "gzip") : new TextEncoder().encode(json);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length * 8, false);
  const bytes = concat(ascii(magic), length, payload);
  const data = new Uint8ClampedArray(width * height * 4).fill(180);
  for (let i = 3; i < data.length; i += 4) data[i] = 254;
  if (bytes.length * 8 > width * height) throw new Error("stealth fixture too small");
  for (let bit = 0; bit < bytes.length * 8; bit += 1) {
    const value = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
    const x = Math.floor(bit / height);
    const y = bit % height;
    data[(y * width + x) * 4 + 3] = 254 | value;
  }
  return { data, width, height };
}

/** A NovelAI V5 Comment JSON with two characters (shape copied from a real V5 file). */
export function v5Comment(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    prompt: "1girl, solo, artist:foo, beach, high complexity",
    steps: 23,
    height: 1216,
    width: 832,
    scale: 4.5,
    uncond_scale: 0.0,
    cfg_rescale: 0.2,
    seed: 2181637352,
    n_samples: 1,
    noise_schedule: "exponential",
    reference_information_extracted_multiple: [],
    reference_strength_multiple: [],
    v4_prompt: {
      caption: {
        base_caption: "1girl, solo, artist:foo, beach, high complexity",
        char_captions: [
          { char_caption: "hinata natsumi, red hair", centers: [{ x: 0.29686946, y: 0.38612437 }] },
          { char_caption: "keroro", centers: [{ x: 0.7, y: 0.9 }] },
        ],
      },
      use_coords: true,
      use_order: true,
      legacy_uc: false,
    },
    v4_negative_prompt: {
      caption: {
        base_caption: "worst quality, 1.5::official art ::",
        char_captions: [
          { char_caption: "bad hands", centers: [{ x: 0.29686946, y: 0.38612437 }] },
          { char_caption: "", centers: [{ x: 0.7, y: 0.9 }] },
        ],
      },
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    },
    sampler: "k_dpmpp_2m",
    dynamic_thresholding: false,
    sm: false,
    sm_dyn: false,
    skip_cfg_above_sigma: null,
    uc: "worst quality, 1.5::official art ::",
    model_name: "NovelAI Diffusion V5",
    ...overrides,
  });
}

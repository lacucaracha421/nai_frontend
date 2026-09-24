/** NovelAI PNG text fields → XMP packet (the layout the NovelAI site reads from WebP files). */
import { readPngChunks } from "../finish/pngMetadata";

export type TextField = { keyword: string; text: string };

const latin1 = new TextDecoder("latin1");
const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const utf8 = new TextDecoder("utf-8");

/** tEXt is Latin-1 by spec, but some writers put UTF-8 there; ASCII decodes the same either way. */
function decodeText(bytes: Uint8Array) {
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

/** Uncompressed tEXt / iTXt fields in file order (compressed iTXt and zTXt are skipped). */
export function pngTextFields(png: Uint8Array): TextField[] {
  const fields: TextField[] = [];
  for (const chunk of readPngChunks(png)) {
    if (chunk.type !== "tEXt" && chunk.type !== "iTXt") continue;
    const data = png.subarray(chunk.start + 8, chunk.end - 4);
    const keywordEnd = data.indexOf(0);
    if (keywordEnd <= 0) continue;
    const keyword = latin1.decode(data.subarray(0, keywordEnd));
    if (chunk.type === "tEXt") {
      fields.push({ keyword, text: decodeText(data.subarray(keywordEnd + 1)) });
      continue;
    }
    // iTXt: keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
    if (data[keywordEnd + 1] !== 0) continue;
    const languageEnd = data.indexOf(0, keywordEnd + 3);
    const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) continue;
    fields.push({ keyword, text: utf8.decode(data.subarray(translatedEnd + 1)) });
  }
  return fields;
}

// XML 1.0 forbids most C0 controls even as character references.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function escapeXml(value: string) {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** PNG keywords may contain spaces or punctuation; element names may not. */
export function xmlElementName(keyword: string) {
  const name = keyword.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(name) ? name : `_${name}`;
}

export function buildXmpPacket(fields: TextField[]) {
  const body = fields
    .map(({ keyword, text }) => {
      const name = `nai:${xmlElementName(keyword)}`;
      return `<${name}>${escapeXml(text)}</${name}>`;
    })
    .join("");
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:nai="https://novelai.net/ns/1.0/">' +
    body +
    "</rdf:Description></rdf:RDF></x:xmpmeta>" +
    '<?xpacket end="w"?>'
  );
}

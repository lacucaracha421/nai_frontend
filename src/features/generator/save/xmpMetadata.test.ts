import { describe, expect, it } from "vitest";
import { buildXmpPacket, escapeXml, pngTextFields, xmlElementName } from "./xmpMetadata";

function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out; // CRC is not checked by the reader
}
function png(...chunks: Uint8Array[]) {
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
const utf8 = (text: string) => new TextEncoder().encode(text);

describe("XMP metadata", () => {
  it("escapes XML special characters and drops invalid control characters", () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
    expect(escapeXml("x\u0000y\u0007z\ttab\nline")).toBe("xyz\ttab\nline");
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
    expect(xmlElementName("Generation_time")).toBe("Generation_time");
    expect(xmlElementName("Generation time")).toBe("Generation_time");
    expect(xmlElementName("1st")).toBe("_1st");
  });

  it("reads tEXt and uncompressed iTXt fields in order and skips compressed ones", () => {
    const bytes = png(
      chunk("IHDR", new Uint8Array(13)),
      chunk("tEXt", utf8("Title\0AI generated image")),
      chunk("tEXt", new Uint8Array([...utf8("Software\0caf"), 0xe9])), // Latin-1 é
      chunk("iTXt", utf8("Description\0\0\0ko\0설명\u00001girl, 한글")),
      chunk("iTXt", new Uint8Array([...utf8("Packed\0"), 1, 0, 0, 0, 0x78, 0x9c])),
      chunk("zTXt", new Uint8Array([...utf8("Z\0"), 0, 0x78])),
      chunk("tEXt", utf8('Comment\0{"prompt": "a & b", "seed": 1}')),
      chunk("IEND", new Uint8Array()),
    );
    expect(pngTextFields(bytes)).toEqual([
      { keyword: "Title", text: "AI generated image" },
      { keyword: "Software", text: "café" },
      { keyword: "Description", text: "1girl, 한글" },
      { keyword: "Comment", text: '{"prompt": "a & b", "seed": 1}' },
    ]);
  });

  it("builds the packet layout verified on the NovelAI site", () => {
    const xmp = buildXmpPacket([
      { keyword: "Title", text: "AI generated image" },
      { keyword: "Comment", text: '{"prompt": "<a>"}' },
    ]);
    expect(xmp).toBe(
      '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        '<rdf:Description rdf:about="" xmlns:nai="https://novelai.net/ns/1.0/">' +
        "<nai:Title>AI generated image</nai:Title>" +
        "<nai:Comment>{&quot;prompt&quot;: &quot;&lt;a&gt;&quot;}</nai:Comment>" +
        '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
    );
    // The BOM is inside the begin attribute, as UTF-8 EF BB BF.
    expect([...new TextEncoder().encode(xmp).subarray(17, 20)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

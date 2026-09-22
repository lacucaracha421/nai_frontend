import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrombotSheet } from "./PrombotSheet";

describe("PrombotSheet", () => {
  it("uses the native Prombot WebView controls instead of embedding an iframe", () => {
    const html = renderToStaticMarkup(
      <PrombotSheet destination="other" onInsert={() => {}} onClose={() => {}} />,
    );

    expect(html).not.toContain("<iframe");
    expect(html).toContain("Prombot 열기");
    expect(html).toContain("북마크 가져오기");
    expect(html).toContain("붙여넣기");
  });
});

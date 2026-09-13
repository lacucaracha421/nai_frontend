import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrombotSheet } from "./PrombotSheet";

describe("PrombotSheet", () => {
  it("grants the embedded Prombot frame clipboard access", () => {
    const html = renderToStaticMarkup(
      <PrombotSheet destination="other" onInsert={() => {}} onClose={() => {}} />,
    );

    expect(html).toContain('allow="clipboard-read; clipboard-write"');
  });
});

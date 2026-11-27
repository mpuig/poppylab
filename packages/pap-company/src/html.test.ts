import { expect, it } from "vitest";
import { escapeHtml } from "./html.ts";

it("escapes what could end an element or an attribute, and nothing else", () => {
  expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a> · é`)).toBe(
    "&#60;a href=&#34;x&#34; title=&#39;y&#39;&#62;Tom &#38; Jerry&#60;/a&#62; · é",
  );
});

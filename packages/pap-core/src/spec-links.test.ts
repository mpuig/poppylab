import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OPERATIONS_ANCHORS,
  OPERATIONS_URL,
  SPEC_ANCHORS,
  SPEC_URL,
  specRefHtml,
  specRefParts,
  specSectionUrl,
} from "./spec-links.ts";

const pinned = (file: string) =>
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../spec/1.0",
      file,
    ),
    "utf8",
  );
/** The numbered headings of a pinned document: "## 3. Discovery", "### 3.1 Fields". */
const numbered = (text: string) =>
  [...text.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? /gm)].map((m) => m[1]!);

describe("links into the published text", () => {
  it("has an anchor for every numbered section of the pinned spec, and no others", () => {
    expect(Object.keys(SPEC_ANCHORS).sort()).toEqual(
      numbered(pinned("spec.md")).sort(),
    );
  });

  it("has an anchor for every numbered section of the pinned Operations extension", () => {
    expect(Object.keys(OPERATIONS_ANCHORS).sort()).toEqual(
      numbered(pinned("extensions-operations.md")).sort(),
    );
  });

  it("uses each anchor once in a document", () => {
    for (const anchors of [SPEC_ANCHORS, OPERATIONS_ANCHORS]) {
      const ids = Object.values(anchors);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("links a section by its published id, not by its title", () => {
    expect(specSectionUrl("5.2")).toBe(`${SPEC_URL}#session-header`);
    expect(specSectionUrl("8.11")).toBe(`${SPEC_URL}#conversation-sign-in`);
    expect(specSectionUrl("4", "operations")).toBe(
      `${OPERATIONS_URL}#approval-required`,
    );
  });

  it("links the document when it does not know the section", () => {
    expect(specSectionUrl("12.9")).toBe(SPEC_URL);
  });

  it("links each number of a list and both ends of a range", () => {
    expect(specRefParts("§3.4, §5.2–5.3")).toEqual([
      { text: "§3.4", href: `${SPEC_URL}#versions` },
      { text: ", " },
      { text: "§5.2", href: `${SPEC_URL}#session-header` },
      { text: "–" },
      { text: "5.3", href: `${SPEC_URL}#session-verification` },
    ]);
  });

  it("reads numbers after Operations as the extension's, up to the next separator", () => {
    expect(specRefParts("§8.4 · Operations §4")).toEqual([
      { text: "§8.4", href: `${SPEC_URL}#message-fields` },
      { text: " · " },
      { text: "Operations " },
      { text: "§4", href: `${OPERATIONS_URL}#approval-required` },
    ]);
    expect(specRefParts("Operations §4–6").map((p) => p.href)).toEqual([
      undefined,
      `${OPERATIONS_URL}#approval-required`,
      undefined,
      `${OPERATIONS_URL}#sending-approval`,
    ]);
  });

  it("links a version of the extension to the extension, not to a section", () => {
    expect(specRefParts("Operations v3")).toEqual([
      { text: "Operations v3", href: OPERATIONS_URL },
    ]);
  });

  it("leaves a number that is not a section alone", () => {
    expect(specRefParts("Poppy 1.0")).toEqual([{ text: "Poppy 1.0" }]);
  });

  it("writes links that open in a new tab", () => {
    expect(specRefHtml("§7")).toBe(
      `<a href="${SPEC_URL}#apis" target="_blank" rel="noopener noreferrer">§7</a>`,
    );
    expect(specRefHtml("")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  LEARN_PAGES,
  imageSize,
  learnHref,
  renderMarkdown,
  renderPage,
  slugify,
  subsections,
} from "./learn";

describe("learn links", () => {
  it("maps pages, anchors, code and external links", () => {
    expect(learnHref("one-task.md")).toBe("/learn/one-task");
    expect(learnHref("README.md")).toBe("/learn");
    expect(learnHref("one-task.md#2-find-the-authorization-server")).toBe(
      "/learn/one-task#2-find-the-authorization-server",
    );
    expect(learnHref("../../packages/pap-company")).toBe(
      "https://github.com/mpuig/poppylab/tree/main/packages/pap-company",
    );
    expect(learnHref("../conversations.md")).toBe(
      "https://github.com/mpuig/poppylab/blob/main/docs/conversations.md",
    );
    expect(learnHref("https://example.com/x")).toBe("https://example.com/x");
    expect(learnHref("#top")).toBe("#top");
  });

  it("makes GitHub-style heading anchors", () => {
    expect(slugify("2. Find the authorization server")).toBe(
      "2-find-the-authorization-server",
    );
    expect(slugify("Milestone 0: be found")).toBe("milestone-0-be-found");
    expect(slugify("Verifying the <code>Poppy-Session</code> header")).toBe(
      "verifying-the-poppy-session-header",
    );
  });

  it("renders every page, and every link between pages lands on a heading", async () => {
    const rendered = new Map<string, string>();
    for (const page of LEARN_PAGES)
      rendered.set(
        page.slug ? `/learn/${page.slug}` : "/learn",
        (await renderPage(page)).html,
      );
    for (const [from, html] of rendered) {
      for (const [, href] of html.matchAll(/href="(\/learn[^"]*)"/g)) {
        const [path, anchor] = href!.split("#");
        expect(rendered.has(path!), `${from} → ${href}`).toBe(true);
        if (anchor)
          expect(rendered.get(path!), `${from} → ${href}`).toContain(
            `id="${anchor}"`,
          );
      }
    }
  });

  it("resolves a subsection's links from its own folder", () => {
    const page = LEARN_PAGES.find(
      (p) => p.slug === "how-it-works/changing-an-order",
    )!;
    expect(page.parent).toBe("how-it-works");
    expect(
      subsections(LEARN_PAGES.find((p) => p.slug === "how-it-works")!),
    ).toContain(page);
    expect(learnHref("changing-an-order.md", "how-it-works")).toBe(
      "/learn/how-it-works/changing-an-order",
    );
    expect(learnHref("README.md", "how-it-works")).toBe("/learn/how-it-works");
    expect(learnHref("../one-task.md#top", "how-it-works")).toBe(
      "/learn/one-task#top",
    );
    // A file the playground serves is linked where it is served.
    expect(
      learnHref(
        "../../../apps/playground/public/learn-media/x/y.webp",
        "how-it-works",
      ),
    ).toBe("/learn-media/x/y.webp");
  });

  it("reads the size of a PNG and of the three kinds of WebP", () => {
    const bytes = (...values: number[]) => Uint8Array.from(values);
    const text = (value: string) => [...value].map((c) => c.charCodeAt(0));
    const pad = (values: number[], length: number) => [
      ...values,
      ...Array<number>(length - values.length).fill(0),
    ];
    // PNG: the signature, then IHDR with width and height big-endian.
    expect(
      imageSize(
        bytes(
          ...pad(
            [
              137,
              80,
              78,
              71,
              13,
              10,
              26,
              10,
              0,
              0,
              0,
              13,
              ...text("IHDR"),
              0,
              0,
              6,
              184,
              0,
              0,
              7,
              8,
            ],
            32,
          ),
        ),
      ),
    ).toEqual({ width: 1720, height: 1800 });
    const webp = (kind: string, rest: number[]) =>
      bytes(
        ...pad(
          [
            ...text("RIFF"),
            0,
            0,
            0,
            0,
            ...text("WEBP"),
            ...text(kind),
            ...rest,
          ],
          40,
        ),
      );
    // Lossless: 14 bits of width minus one, then 14 of height minus one.
    expect(
      imageSize(webp("VP8L", [0, 0, 0, 0, 0x2f, 0xb7, 0xc6, 0xc1, 0x01])),
    ).toEqual({ width: 1720, height: 1800 });
    // Extended: 24 bits each, minus one.
    expect(
      imageSize(
        webp("VP8X", [10, 0, 0, 0, 0, 0, 0, 0, 0xb7, 0x06, 0, 0x07, 0x07, 0]),
      ),
    ).toEqual({ width: 1720, height: 1800 });
    // Lossy: 14 bits each after the frame tag and start code.
    expect(
      imageSize(
        webp(
          "VP8 ",
          [0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 0xb8, 0x06, 0x08, 0x07],
        ),
      ),
    ).toEqual({ width: 1720, height: 1800 });
    expect(imageSize(bytes(1, 2, 3))).toBeUndefined();
  });

  it("splits a walk-through into its steps and leaves the rest whole", () => {
    const markdown = [
      "Intro.",
      "",
      "## Who does what",
      "",
      "Words.",
      "",
      "## Step by step",
      "",
      "### 1. Pick the company",
      "",
      "First.",
      "",
      "<details>",
      "<summary>What travelled</summary>",
      "",
      "```http",
      "GET /x",
      "```",
      "",
      "</details>",
      "",
      "### 2. Sign in at `Lantern`",
      "",
      "Second.",
      "",
      "## Afterwards",
      "",
      "Last.",
    ].join("\n");
    const { html, parts } = renderMarkdown(markdown);
    expect(parts!.steps.map((step) => [step.id, step.title])).toEqual([
      ["1-pick-the-company", "Pick the company"],
      ["2-sign-in-at-lantern", "Sign in at <code>Lantern</code>"],
    ]);
    // A step has what follows its heading, and not the heading.
    expect(parts!.steps[0]!.html).toContain("<p>First.</p>");
    expect(parts!.steps[0]!.html).toContain(
      "<summary>What travelled</summary>",
    );
    expect(parts!.steps[0]!.html).toContain("GET /x");
    expect(parts!.steps[0]!.html).not.toContain("<h3");
    expect(parts!.steps[1]!.html).toBe("<p>Second.</p>\n");
    // The section's own heading opens it; what follows the steps stays.
    expect(parts!.before).toContain('<h2 id="step-by-step">Step by step</h2>');
    expect(parts!.before).not.toContain("Pick the company");
    expect(parts!.after).toBe(
      '<h2 id="afterwards">Afterwards</h2>\n<p>Last.</p>\n',
    );
    // Everything in order, as GitHub shows it, with each step's own anchor.
    expect(html).toContain(
      '<h3 id="1-pick-the-company">1. Pick the company</h3>',
    );
    expect(html.indexOf("First.")).toBeLessThan(html.indexOf("Second."));
    // A page without the section comes whole.
    expect(
      renderMarkdown("## Other\n\n### 1. Not a step").parts,
    ).toBeUndefined();
  });

  it("draws a screenshot as a figure with its caption, sized from the file", async () => {
    const page = LEARN_PAGES.find(
      (p) => p.slug === "how-it-works/changing-an-order",
    )!;
    const { parts } = await renderPage(page);
    const first = parts!.steps[0]!.html;
    expect(first).toMatch(
      /^<figure class="learn-shot"><img src="\/learn-media\/how-it-works\/changing-an-order\/01-pick-a-company\.webp" alt="[^"]+" width="\d+" height="\d+" loading="lazy" decoding="async"><figcaption>[^<]+<\/figcaption><\/figure>/,
    );
    // The figure is not wrapped in a paragraph.
    expect(first).not.toContain("<p><figure");
    // An image from anywhere else is refused at build time.
    expect(() => renderMarkdown("![x](https://example.com/x.png)")).toThrow();
  });
});

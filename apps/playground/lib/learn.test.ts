import { describe, expect, it } from "vitest";
import { LEARN_PAGES, learnHref, renderPage, slugify } from "./learn";

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
});

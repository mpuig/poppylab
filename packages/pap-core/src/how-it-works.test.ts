import { describe, expect, it } from "vitest";
import {
  annotatedJsonHtml,
  approvalSequenceSvg,
  breakablePath,
  guideExcluded,
  guideOperations,
  jsonLines,
} from "./how-it-works.ts";

const text = (lines: ReturnType<typeof jsonLines>) =>
  lines.map((line) => `${"  ".repeat(line.depth)}${line.text}`).join("\n");

describe("what the Companies' How it works pages share", () => {
  const document = {
    protocol_version: "1.0",
    auth: {
      issuer: "https://shop.example",
      scopes: {
        read: "See your orders: dishes, delivery slot, address and price. Read only, nothing changes.",
        write: "Change an order.",
      },
    },
    web: {},
    extensions: { operations: [{ version: "3" }] },
  };

  it("lays a document out as the same JSON, short values on their line", () => {
    const lines = jsonLines(document);
    expect(JSON.parse(text(lines))).toEqual(document);
    expect(lines.map((line) => line.text)).toContain('"web": {},');
    expect(lines.map((line) => line.text)).toContain(
      '"extensions": { "operations": [{ "version": "3" }] }',
    );
    // The long description opens its object up.
    expect(lines.find((line) => line.text === '"scopes": {')?.depth).toBe(2);
  });

  it("opens a value up sooner when the line is narrower", () => {
    const narrow = jsonLines(document, { width: 30 }).map((line) => line.text);
    expect(narrow).toContain('"extensions": {');
    expect(JSON.parse(text(jsonLines(document, { width: 30 })))).toEqual(
      document,
    );
  });

  it("says a folded value in words, and marks the line as not JSON", () => {
    const lines = jsonLines(document, {
      fold: { "auth.scopes": "{ 2 permissions }" },
    });
    expect(lines.find((line) => line.folded)).toEqual({
      depth: 2,
      text: '"scopes": { 2 permissions }',
      folded: true,
    });
    expect(lines.some((line) => line.text.includes("See your orders"))).toBe(
      false,
    );
    expect(
      annotatedJsonHtml(document, [], {
        fold: { "auth.scopes": "{ 2 permissions }" },
      }),
    ).toContain(
      '<span class="k">&#34;scopes&#34;</span>: <i class="fold">{ 2 permissions }</i>',
    );
  });

  it("numbers the marked top-level keys in the order given, and no nested key", () => {
    const html = annotatedJsonHtml(document, ["auth", "extensions"]);
    expect(html).toContain(
      '<span class="ln d1 hit"><b class="mark">1</b><span class="k">&#34;auth&#34;</span>: {</span>',
    );
    expect(html).toContain(
      '<b class="mark">2</b><span class="k">&#34;extensions&#34;',
    );
    expect(html.match(/class="mark"/g)).toHaveLength(2);
    expect(html).toContain(
      '<span class="ln d1"><span class="k">&#34;web&#34;</span>: {},</span>',
    );
  });

  it("reads the operations as the API describes them, then the Company's agent", () => {
    const operations = guideOperations(
      {
        "/api/menu": {
          get: {
            operationId: "menu",
            summary: "Read the menu: dishes and prices.",
          },
        },
        "/api/orders/{order_id}/changes": {
          post: {
            operationId: "change_order",
            summary: "Propose changing an order. Read it first.",
            "x-poppy-scopes": ["orders:write"],
            "x-poppy-proposal": true,
          },
        },
      },
      {
        agent: {
          protocols: [
            {
              endpoint: "https://shop.example/poppy/conversations",
              description: "The shop's agent: hours and delivery. Send help.",
            },
          ],
        },
      },
    );
    expect(operations).toEqual([
      {
        name: "menu",
        where: "GET /api/menu",
        text: "Read the menu",
        signedIn: false,
        approval: false,
      },
      {
        name: "change order",
        where: "POST /api/orders/{order_id}/changes",
        text: "Propose changing an order",
        signedIn: true,
        approval: true,
      },
      {
        name: "ask our agent",
        where: "POST /poppy/conversations",
        text: "The shop's agent: hours and delivery",
        signedIn: false,
        approval: false,
      },
    ]);
    expect(guideOperations({}, {})).toEqual([]);
  });

  it("lets a path break after a slash and escapes it", () => {
    expect(breakablePath("GET /api/<x>")).toBe(
      "GET /<wbr>api/<wbr>&#60;x&#62;",
    );
  });

  it("says the excluded tasks as the end of a sentence to the customer", () => {
    expect(guideExcluded(["Cancel an order"])).toBe("cancel an order");
    expect(
      guideExcluded([
        "Get a refund",
        "Cancel a placed order",
        "Delete my account",
      ]),
    ).toBe("get a refund, cancel a placed order or delete your account");
    expect(guideExcluded([])).toBe("");
  });

  it("draws the approval twice with ids of their own, the customer's step in the accent", () => {
    const look = {
      id: "shop-approval",
      company: "Shop & Co",
      request: "Change order",
      held: "The ticket waits",
      ink: "#111111",
      ground: "#eeeeee",
      paper: "#ffffff",
      line: "#cccccc",
      accent: "#ffaa00",
    };
    const wide = approvalSequenceSvg(look);
    const narrow = approvalSequenceSvg(look, true);
    expect(wide).toContain('class="wide" viewBox="0 0 640 410"');
    expect(narrow).toContain('class="narrow" viewBox="0 0 360 410"');
    expect(wide).toContain(
      'aria-labelledby="shop-approval-title shop-approval-desc"',
    );
    expect(narrow).toContain('id="shop-approval-narrow-title"');
    // Six messages, one of them the customer's.
    expect(wide.match(/marker-end=/g)).toHaveLength(6);
    expect(
      wide.match(/marker-end="url\(#shop-approval-accent\)"/g),
    ).toHaveLength(1);
    expect(wide).toContain(">4 · Approve<");
    expect(wide).toContain(">2 · Change order<");
    expect(wide).toContain("Shop &#38; Co");
  });
});

import { describe, expect, it } from "vitest";
import { codeBlock, highlight, readNotes } from "./learn-code";
import { renderMarkdown } from "./learn";

/** The text a reader sees: the markup taken out, the entities put back. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

describe("colour for code", () => {
  it("tells a JSON key from a value, and a number from a string", () => {
    const html = highlight(
      '{ "a": "x", "n": 3, "ok": true, "z": null }',
      "json",
    );
    expect(html).toContain('<span class="tk-k">&#34;a&#34;</span>');
    expect(html).toContain('<span class="tk-s">&#34;x&#34;</span>');
    expect(html).toContain('<span class="tk-n">3</span>');
    expect(html).toContain('<span class="tk-n">true</span>');
    expect(html).toContain('<span class="tk-n">null</span>');
    expect(html).toContain('<span class="tk-p">:</span>');
  });

  it("keeps a colon inside a string, a digit inside a word and our ellipsis", () => {
    const html = highlight(
      '"u": "https://x/y:80", "id": "op_9J3", "t": …',
      "json",
    );
    expect(html).toContain(
      '<span class="tk-s">&#34;https://x/y:80&#34;</span>',
    );
    expect(html).not.toContain('<span class="tk-n">9</span>');
    expect(html).toContain('<span class="tk-p">…</span>');
  });

  it("shows comments, and never lets code through as markup", () => {
    const html = highlight('// GET /a?b=1&c=2\n{ "k": "<script>" }', "json");
    expect(html).toContain('<span class="tk-c">// GET /a?b=1&#38;c=2</span>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&#60;script&#62;");
  });

  it("colours the first line and the headers of an HTTP message, and its JSON body", () => {
    const request = highlight(
      'POST https://x.dev/api\nAccept: "a"\n\n{ "k": 1 }',
      "http",
    );
    expect(request).toContain('<span class="tk-m">POST</span>');
    expect(request).toContain('<span class="tk-k">Accept</span>');
    expect(request).toContain('<span class="tk-s">&#34;a&#34;</span>');
    expect(request).toContain('<span class="tk-k">&#34;k&#34;</span>');
    const response = highlight(
      "HTTP/1.1 403 Forbidden\nContent-Type: application/json",
      "http",
    );
    expect(response).toContain('<span class="tk-p">HTTP/1.1</span>');
    expect(response).toContain('<span class="tk-m">403</span>');
    expect(text(response)).toBe(
      "HTTP/1.1 403 Forbidden\nContent-Type: application/json",
    );
  });

  it("colours tags, attributes and comments of XML", () => {
    const html = highlight(
      '<feed xmlns="urn:x"><!-- c --><id>1</id></feed>',
      "xml",
    );
    expect(html).toContain('<span class="tk-k">feed</span>');
    expect(html).toContain('<span class="tk-n">xmlns</span>');
    expect(html).toContain('<span class="tk-s">&#34;urn:x&#34;</span>');
    expect(html).toContain('<span class="tk-c">&#60;!-- c --&#62;</span>');
  });

  it("colours comments, strings and flags of a shell script", () => {
    const html = highlight('curl -LO "https://x" # fetch', "sh");
    expect(html).toContain('<span class="tk-n">-LO</span>');
    expect(html).toContain('<span class="tk-s">&#34;https://x&#34;</span>');
    expect(html).toContain('<span class="tk-c"># fetch</span>');
  });

  it("changes nothing a reader reads, in any language", () => {
    const samples: [string, string][] = [
      ['{ "a": [1, 2, {"b": "c"}], // x\n "d": …}', "json"],
      ["GET https://x/y HTTP/1.1\nA: b\n\n{}", "http"],
      ['<a b="c">\n  <d/>\n</a>', "xml"],
      ["const a = 'b'; // c", "ts"],
      ["a < b && c > d", "text"],
      ["no language at all", undefined as unknown as string],
    ];
    for (const [code, lang] of samples)
      expect(text(highlight(code, lang))).toBe(code);
  });

  it("splits a token that crosses lines into one span for each line", () => {
    const html = highlight("<!-- a\nb -->", "xml");
    expect(html.split("\n")).toEqual([
      '<span class="tk-c">&#60;!-- a</span>',
      '<span class="tk-c">b --&#62;</span>',
    ]);
  });
});

describe("numbered notes", () => {
  it("takes the notes off the code and says on which line each was", () => {
    const { code, notes } = readNotes(
      '{\n  "a": 1, // (1)\n  "b": 2 // (2)\n}',
    );
    expect(code).toBe('{\n  "a": 1,\n  "b": 2\n}');
    expect(notes).toEqual([
      { line: 1, n: 1 },
      { line: 2, n: 2 },
    ]);
    expect(readNotes("<a/> <!-- (3) -->").notes).toEqual([{ line: 0, n: 3 }]);
    expect(readNotes("echo hi # (4)").notes).toEqual([{ line: 0, n: 4 }]);
    expect(readNotes("// GET /a (and more)").notes).toEqual([]);
  });

  it("draws a mark on the line of a note, and leaves the comment out of the code", () => {
    const html = codeBlock('{\n  "a": 1 // (1)\n}', "json", true);
    expect(html).toContain('<pre class="learn-code learn-annotated">');
    expect(html).toContain('<span class="mk" data-n="1"');
    expect(html).toContain("ln has-note");
    expect(text(html)).not.toContain("(1)");
    expect(text(html)).toContain('"a": 1');
  });

  it("makes an annotated block and its legend from a block with notes and the list after it", () => {
    const { html } = renderMarkdown(
      [
        "```json",
        '{ "a": 1, // (1)',
        '  "b": 2 } // (2)',
        "```",
        "",
        "1. The first.",
        "2. The second.",
        "",
      ].join("\n"),
    );
    expect(html).toContain("learn-annotated");
    expect(html).toContain('<ol class="learn-legend">');
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it("leaves a list that follows an ordinary block alone", () => {
    const { html } = renderMarkdown(
      ["```json", '{ "a": 1 }', "```", "", "1. One.", "2. Two.", ""].join("\n"),
    );
    expect(html).not.toContain("learn-annotated");
    expect(html).not.toContain("learn-legend");
    expect(html).toContain("<ol>");
  });

  it("refuses notes that don't match their legend", () => {
    const block = (list: string[]) =>
      [
        "```json",
        '{ "a": 1, // (1)',
        '  "b": 2 } // (2)',
        "```",
        "",
        ...list,
        "",
      ].join("\n");
    // No list, a bulleted list, a list of the wrong length.
    expect(() => renderMarkdown(block([]))).toThrow(/ordered list/);
    expect(() => renderMarkdown(block(["- one", "- two"]))).toThrow(
      /ordered list/,
    );
    expect(() => renderMarkdown(block(["1. one"]))).toThrow(/list of 1 items/);
    // Notes out of order.
    expect(() =>
      renderMarkdown(
        [
          "```json",
          '{ "a": 1, // (2)',
          '  "b": 2 } // (1)',
          "```",
          "",
          "1. a",
          "2. b",
          "",
        ].join("\n"),
      ),
    ).toThrow(/numbered 2/);
  });
});

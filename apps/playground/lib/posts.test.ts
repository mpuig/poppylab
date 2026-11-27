import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  POSTS_DIR,
  loadPosts,
  postDate,
  readFrontMatter,
  readPost,
  renderPost,
} from "./posts";

const post = (front: string, body = "Text.\n") =>
  `---\n${front}\n---\n\n${body}`;

let dirs: string[] = [];
const folder = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "posts-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
};
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("front matter", () => {
  it("reads every field, quoted or not, and the tags as a list", () => {
    const p = readPost(
      "2026-12-01-what-an-approval-is.md",
      post(
        [
          'title: "What an approval is"',
          "subtitle: Why a change waits for the person.",
          "date: 2026-12-01",
          "tags: [approvals, 'operations']",
          "learn: /learn/operations",
        ].join("\n"),
        "# What an approval is\n\nThe text.\n",
      ),
    );
    expect(p).toMatchObject({
      slug: "what-an-approval-is",
      title: "What an approval is",
      subtitle: "Why a change waits for the person.",
      date: "2026-12-01",
      tags: ["approvals", "operations"],
      learn: "/learn/operations",
      canonical: "https://poppylab.dev/posts/what-an-approval-is",
    });
    expect(p.body).toBe("\n# What an approval is\n\nThe text.\n");
  });

  it("keeps a canonical address given for a post first published elsewhere", () => {
    expect(
      readPost(
        "2026-12-01-a.md",
        post("title: A\ncanonical: https://example.com/a"),
      ).canonical,
    ).toBe("https://example.com/a");
  });

  it("stops the build on a mistake rather than publishing it", () => {
    expect(() => readPost("2026-12-01-a.md", "No front matter.")).toThrow(
      /no front matter/,
    );
    expect(() => readPost("2026-12-01-a.md", post("subtitle: x"))).toThrow(
      /no title/,
    );
    expect(() =>
      readPost("2026-12-01-a.md", post("title: A\ntitel: B")),
    ).toThrow(/unknown front matter "titel"/);
    expect(() =>
      readPost("2026-12-01-a.md", post("title: A\ndate: 2026-12-02")),
    ).toThrow(/is not the file's 2026-12-01/);
    expect(() =>
      readPost("2026-12-01-a.md", post("title: A\nlearn: https://x.dev")),
    ).toThrow(/not a \/learn address/);
    expect(() =>
      readPost("2026-12-01-a.md", post("title: A\ncanonical: http://x.dev")),
    ).toThrow(/not an https URL/);
    expect(() => readPost("notes.md", post("title: A"))).toThrow(
      /YYYY-MM-DD-slug/,
    );
  });

  it("skips blank lines and comments", () => {
    expect(readFrontMatter(post("# a note\n\ntitle: A")).fields).toEqual({
      title: "A",
    });
  });
});

describe("loading the folder", () => {
  it("lists posts oldest first, the order of the series", () => {
    const dir = folder({
      "2026-12-09-third.md": post("title: Third"),
      "2026-12-01-first.md": post("title: First"),
      "2026-12-05-second.md": post("title: Second"),
    });
    expect(loadPosts(dir).map((p) => p.slug)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("reads only files named as posts directly in the folder", () => {
    const outside = folder({ "2026-12-02-draft.md": post("title: Draft") });
    const dir = folder({
      "2026-12-01-first.md": post("title: First"),
      "README.md": "# Posts\n",
      "notes.md": post("title: Notes"),
      "2026-12-03-Upper.md": post("title: Upper"),
      "drafts/2026-12-04-nested.md": post("title: Nested"),
      "2026-12-05-first.md.bak": post("title: Backup"),
    });
    symlinkSync(
      path.join(outside, "2026-12-02-draft.md"),
      path.join(dir, "2026-12-02-draft.md"),
    );
    expect(loadPosts(dir).map((p) => p.slug)).toEqual(["first"]);
  });

  it("refuses two posts with one address", () => {
    const dir = folder({
      "2026-12-01-same.md": post("title: One"),
      "2026-12-02-same.md": post("title: Two"),
    });
    expect(() => loadPosts(dir)).toThrow(/Two posts are called same/);
  });

  it("has no posts when the folder is missing", () => {
    expect(loadPosts(path.join(tmpdir(), "no-such-posts-folder"))).toEqual([]);
  });

  it("publishes the tracked folder in the playground and nothing else", () => {
    expect(path.relative(process.cwd(), POSTS_DIR)).toBe(
      path.join("content", "posts"),
    );
    for (const p of loadPosts()) expect(p.file).toMatch(/^\d{4}-\d{2}-\d{2}-/);
  });
});

describe("rendering", () => {
  it("uses Learn's renderer, with links that work on GitHub and on the site", () => {
    const html = renderPost(
      readPost(
        "2026-12-01-a.md",
        post(
          "title: A",
          [
            "# A",
            "",
            "See [approvals](../../../../docs/learn/operations.md#what-is-proposed),",
            "[the playground](/playground) and",
            "[the gateway](../../../../packages/pap-company/src/gateway.ts).",
          ].join("\n"),
        ),
      ),
    );
    expect(html).not.toContain("<h1");
    expect(html).toContain('href="/learn/operations#what-is-proposed"');
    expect(html).toContain('href="/playground"');
    expect(html).toContain(
      'href="https://github.com/mpuig/poppylab/blob/main/packages/pap-company/src/gateway.ts"',
    );
  });

  it("writes the date the same for every reader", () => {
    expect(postDate("2026-12-01")).toBe("1 December 2026");
  });
});

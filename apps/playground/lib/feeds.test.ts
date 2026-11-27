import { describe, expect, it } from "vitest";
import { rssFeed } from "./feeds";
import { readPost } from "./posts";

const posts = [
  readPost(
    "2026-12-01-first.md",
    "---\ntitle: First & foremost\nsubtitle: <Why> it starts\ntags: [a, b]\n---\n\nSome *text*.\n\nTry [the playground](/playground).\n",
  ),
  readPost(
    "2026-12-08-second.md",
    "---\ntitle: Second\ncanonical: https://example.com/second\n---\n\nMore.\n",
  ),
];

/**
 * Well-formed XML: every tag closed in order, one root, no stray `&` or
 * `<` in text. Enough to catch an unescaped title or a broken template.
 */
function wellFormed(document: string) {
  const body = document.replace(/^<\?xml[^?]*\?>\s*/, "");
  const open: string[] = [];
  let roots = 0;
  for (const [token] of body.matchAll(/<[^>]*>|[^<]+/g)) {
    if (!token.startsWith("<")) {
      if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(token)) return false;
      if (!open.length && token.trim()) return false;
      continue;
    }
    const name = /^<\/?([A-Za-z][\w:.-]*)/.exec(token)?.[1];
    if (!name) return false;
    if (token.startsWith("</")) {
      if (open.pop() !== name) return false;
    } else if (!token.endsWith("/>")) {
      if (!open.length) roots++;
      open.push(name);
    } else if (!open.length) roots++;
  }
  return open.length === 0 && roots === 1;
}

describe("RSS feed", () => {
  it("is well-formed RSS 2.0 with the newest post first", () => {
    const feed = rssFeed(posts);
    expect(wellFormed(feed)).toBe(true);
    expect(feed).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/,
    );
    expect(feed).toContain(
      '<atom:link href="https://poppylab.dev/posts/rss.xml" rel="self" type="application/rss+xml"/>',
    );
    expect(feed.indexOf("<title>Second</title>")).toBeLessThan(
      feed.indexOf("<title>First &amp; foremost</title>"),
    );
    expect(feed).toContain("<description>&lt;Why&gt; it starts</description>");
    expect(feed).toContain(
      '<guid isPermaLink="true">https://poppylab.dev/posts/first</guid>',
    );
    expect(feed).toContain("<pubDate>Tue, 01 Dec 2026 00:00:00 GMT</pubDate>");
    expect(feed).toContain("<category>a</category>");
    // The whole text, escaped so it is character data.
    expect(feed).toContain(
      "<content:encoded>&lt;p&gt;Some &lt;em&gt;text&lt;/em&gt;.&lt;/p&gt;",
    );
    // A reader elsewhere follows the post's links to the site.
    expect(feed).toContain(
      "&lt;a href=&quot;https://poppylab.dev/playground&quot;&gt;",
    );
  });

  it("is a valid, empty channel before the first post", () => {
    const feed = rssFeed([]);
    expect(wellFormed(feed)).toBe(true);
    expect(feed).not.toContain("<item>");
    expect(feed).toContain("<link>https://poppylab.dev/posts</link>");
  });
});

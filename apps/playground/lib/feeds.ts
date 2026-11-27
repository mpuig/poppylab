/**
 * What the site tells feed readers and search engines: the RSS feed of the
 * posts, the sitemap of every public page and post, and robots.txt. Built
 * at build time from the same lists the pages are, so a new Learn page or
 * post is listed without anything else to change.
 */
import { LEARN_PAGES } from "./learn";
import { renderPost, type Post } from "./posts";
import { FEED_PATH, SITE_NAME, SITE_URL, absolute } from "./site";

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

/** The day as RFC 822 wants it, at midnight UTC. */
const rfc822 = (date: string) => new Date(`${date}T00:00:00Z`).toUTCString();

/** A post's HTML for a reader elsewhere: its links to the site made absolute. */
const standalone = (html: string) =>
  html.replace(/\b(href|src)="\/(?!\/)/g, `$1="${SITE_URL}/`);

/** RSS 2.0, newest post first, each with its whole text. */
export function rssFeed(posts: readonly Post[]) {
  const newest = [...posts].reverse();
  const items = newest.map(
    (post) => `    <item>
      <title>${xml(post.title)}</title>
      <link>${xml(absolute(`/posts/${post.slug}`))}</link>
      <guid isPermaLink="true">${xml(absolute(`/posts/${post.slug}`))}</guid>
      <pubDate>${rfc822(post.date)}</pubDate>
${post.subtitle ? `      <description>${xml(post.subtitle)}</description>\n` : ""}${post.tags.map((tag) => `      <category>${xml(tag)}</category>\n`).join("")}      <content:encoded>${xml(standalone(renderPost(post)))}</content:encoded>
    </item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xml(`${SITE_NAME} posts`)}</title>
    <link>${xml(absolute("/posts"))}</link>
    <description>${xml(`Posts from ${SITE_NAME} on Personal Agent Protocol 1.0.`)}</description>
    <language>en</language>
    <atom:link href="${xml(absolute(FEED_PATH))}" rel="self" type="application/rss+xml"/>
${newest[0] ? `    <lastBuildDate>${rfc822(newest[0].date)}</lastBuildDate>\n` : ""}${items.map((item) => `${item}\n`).join("")}  </channel>
</rss>
`;
}

/** Every public page, by its path: the site's own pages, Learn and the posts. */
export function publicPages(posts: readonly Post[]) {
  return [
    { path: "/" },
    { path: "/playground" },
    { path: "/developers" },
    { path: "/developers/api" },
    { path: "/developers/native-client" },
    ...LEARN_PAGES.map((p) => ({
      path: p.slug ? `/learn/${p.slug}` : "/learn",
    })),
    { path: "/posts" },
    // A post first published elsewhere belongs to its original's sitemap.
    ...posts
      .filter((post) => post.canonical === absolute(`/posts/${post.slug}`))
      .map((post) => ({ path: `/posts/${post.slug}`, modified: post.date })),
    { path: "/about" },
    { path: "/privacy" },
  ];
}

export function sitemap(posts: readonly Post[]) {
  const urls = publicPages(posts).map(
    (page) =>
      `  <url><loc>${xml(absolute(page.path))}</loc>${"modified" in page ? `<lastmod>${page.modified}</lastmod>` : ""}</url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

/** The public pages are open to crawlers; the API is not a page. */
export function robots() {
  return `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

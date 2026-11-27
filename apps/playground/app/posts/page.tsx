import type { Metadata } from "next";
import { loadPosts, postDate } from "@/lib/posts";
import { FEED_PATH, SITE_NAME, pageMetadata } from "@/lib/site";
import { SiteBar, SiteFoot } from "../site-chrome";
import "../site.css";

export const metadata: Metadata = pageMetadata({
  title: `Posts · ${SITE_NAME}`,
  description: `Posts from ${SITE_NAME} on Personal Agent Protocol 1.0: what the lab shows about each part of it.`,
  path: "/posts",
  image: "posts",
});

export default function Posts() {
  // Newest first; the series reads oldest first from each post.
  const posts = loadPosts().reverse();
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar current="posts" />
      <main id="main" className="reading">
        <article className="learn-article">
          <h1>Posts</h1>
          {posts.length === 0 ? (
            <p className="lead reading-lead">
              The first post is coming. It will be here and in the{" "}
              <a href={FEED_PATH}>RSS feed</a>.
            </p>
          ) : (
            <>
              <p className="lead reading-lead">
                Posts on Personal Agent Protocol 1.0, one part of it at a time,
                also as an <a href={FEED_PATH}>RSS feed</a>.
              </p>
              <dl className="facts post-list">
                {posts.map((post) => (
                  <div key={post.slug}>
                    <dt>
                      <time dateTime={post.date}>{postDate(post.date)}</time>
                    </dt>
                    <dd>
                      <a href={`/posts/${post.slug}`}>{post.title}</a>
                      {post.subtitle && <p>{post.subtitle}</p>}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}

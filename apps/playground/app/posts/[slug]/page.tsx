import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEARN_PAGES } from "@/lib/learn";
import { loadPosts, postDate, renderPost } from "@/lib/posts";
import { SITE_NAME, pageMetadata } from "@/lib/site";
import { SiteBar, SiteFoot } from "../../site-chrome";
import "../../site.css";

// Every post is built from content/posts at build time; nothing else exists.
export const dynamicParams = false;

export function generateStaticParams() {
  return loadPosts().map((post) => ({ slug: post.slug }));
}

type Props = { params: Promise<{ slug: string }> };

const find = async (params: Props["params"]) => {
  const { slug } = await params;
  return loadPosts().find((post) => post.slug === slug);
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await find(params);
  if (!post) return {};
  return {
    ...pageMetadata({
      title: `${post.title} · ${SITE_NAME}`,
      description: post.subtitle || post.title,
      path: `/posts/${post.slug}`,
      image: "posts",
      type: "article",
      published: post.date,
      canonical: post.canonical,
    }),
    ...(post.tags.length ? { keywords: post.tags } : {}),
  };
}

/** The label of the Learn page a post points to, or its address. */
const learnLabel = (href: string) => {
  const slug = href.replace(/^\/learn\/?/, "").replace(/#.*$/, "");
  return LEARN_PAGES.find((p) => p.slug === slug)?.label ?? href;
};

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const posts = loadPosts();
  const index = posts.findIndex((p) => p.slug === slug);
  const post = posts[index];
  if (!post) notFound();
  const previous = posts[index - 1];
  const next = posts[index + 1];
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteBar current="posts" />
      <main id="main" className="reading">
        <article className="learn-article">
          <h1>{post.title}</h1>
          {post.subtitle && (
            <p className="lead reading-lead">{post.subtitle}</p>
          )}
          <p className="reading-meta">
            <time dateTime={post.date}>{postDate(post.date)}</time>
            {post.tags.length > 0 && <> · {post.tags.join(", ")}</>}
          </p>
          {/* Our own Markdown from content/posts, converted at build time. */}
          <div
            className="learn-body"
            dangerouslySetInnerHTML={{ __html: renderPost(post) }}
          />
          {post.learn && (
            <p className="reading-learn">
              More in Learn: <a href={post.learn}>{learnLabel(post.learn)}</a>
            </p>
          )}
          <footer className="learn-foot">
            {previous ? (
              <a href={`/posts/${previous.slug}`}>Previous: {previous.title}</a>
            ) : (
              <span />
            )}
            {next && (
              <a className="learn-next" href={`/posts/${next.slug}`}>
                Next: {next.title}
              </a>
            )}
          </footer>
          <p className="reading-meta">
            {SITE_NAME} is a personal project; views are my own.
          </p>
        </article>
      </main>
      <SiteFoot />
    </div>
  );
}

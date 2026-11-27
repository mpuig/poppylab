/**
 * What every public page of poppylab.dev says about itself: the site's name
 * and address, who signs /about, and the tags a search engine or a shared
 * link reads (title, description, canonical address, Open Graph and Twitter
 * card). Pages build their `metadata` with `pageMetadata`, so each one names
 * its own address and image and none inherits the home's.
 */
import type { Metadata } from "next";
import { LAB_AUTHOR } from "@poppy-lab/pap-core";

export const SITE_NAME = "Poppy Lab";
/** The address the site is published at, whatever origin serves the page. */
export const SITE_URL = "https://poppylab.dev";
export const FEEDBACK_URL = "https://github.com/mpuig/poppylab/issues";

/**
 * Who signs /about: the footer's signature. Set `ABOUT_AUTHOR` to
 * `undefined` and /about reads without a name.
 */
export const ABOUT_AUTHOR: { handle: string; url: string } | undefined =
  LAB_AUTHOR;

/** The feed of posts, linked from the head of every page. */
export const FEED_PATH = "/posts/rss.xml";

/**
 * The share images, 1200x630, under `public/share/`: one for each main
 * section and a default for every other page, each with the headline it
 * shows as its alt text. They are checked in; `scripts/share-images.html`
 * draws them.
 */
export const SHARE_IMAGES = {
  default: "How AI agents and companies agree on the rules.",
  playground:
    "Playground: Watch Iris, a Personal Agent, work with five fictional companies.",
  learn: "Learn: How Personal Agent Protocol 1.0 works, request by request.",
  developers:
    "Developers: Test your own Company or Personal Agent against the lab.",
  posts: "Posts: Notes on Personal Agent Protocol 1.0 from the lab.",
} as const;
export type ShareImage = keyof typeof SHARE_IMAGES;

export const absolute = (path: string) => new URL(path, SITE_URL).toString();

/**
 * A page's tags. `path` is its address on the site; `title` is what a tab
 * and a shared link show, so it already names the site.
 */
export function pageMetadata({
  title,
  description,
  path,
  image = "default",
  type = "website",
  published,
  canonical,
}: {
  title: string;
  description: string;
  path: string;
  image?: ShareImage;
  type?: "website" | "article";
  /** For an article: the day it was published, `YYYY-MM-DD`. */
  published?: string;
  /** Where the original lives, when it is not this page. */
  canonical?: string;
}): Metadata {
  const url = canonical ?? absolute(path);
  const images = [
    {
      url: absolute(`/share/${image}.png`),
      width: 1200,
      height: 630,
      alt: SHARE_IMAGES[image],
    },
  ];
  return {
    title,
    description,
    alternates: {
      canonical: url,
      types: {
        "application/rss+xml": [
          { url: absolute(FEED_PATH), title: `${SITE_NAME} posts` },
        ],
      },
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en",
      images,
      ...(type === "article"
        ? { type, ...(published ? { publishedTime: published } : {}) }
        : { type }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: images.map((i) => i.url),
    },
  };
}

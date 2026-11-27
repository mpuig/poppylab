import { rssFeed } from "@/lib/feeds";
import { loadPosts } from "@/lib/posts";

// Built once from content/posts, like the posts themselves.
export const dynamic = "force-static";

export function GET() {
  return new Response(rssFeed(loadPosts()), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}

import { sitemap } from "@/lib/feeds";
import { loadPosts } from "@/lib/posts";

// Built once, from the same lists as the pages.
export const dynamic = "force-static";

export function GET() {
  return new Response(sitemap(loadPosts()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

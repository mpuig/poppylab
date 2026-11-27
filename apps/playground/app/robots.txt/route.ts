import { robots } from "@/lib/feeds";

export const dynamic = "force-static";

export function GET() {
  return new Response(robots(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

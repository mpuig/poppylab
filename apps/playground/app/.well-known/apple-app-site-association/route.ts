import { appleAppSiteAssociation } from "@/lib/apple-app-site";
export const dynamic = "force-dynamic";
/**
 * The apps that may use this site's passkeys and its sign-in end page
 * (Associated Domains, `webcredentials:`). Apple reads it from its own
 * cache; a developer build can read it directly with `?mode=developer`.
 */
export function GET() {
  const body = appleAppSiteAssociation();
  if (!body) return new Response("Not found", { status: 404 });
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

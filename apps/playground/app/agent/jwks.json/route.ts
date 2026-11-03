import { identity } from "@/lib/runtime";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    { keys: [(await identity()).publicKey] },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

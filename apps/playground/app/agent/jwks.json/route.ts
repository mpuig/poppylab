import { identity } from "@poppy-lab/pap-agent/runtime";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    { keys: [(await identity()).publicKey] },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

import { agentOrigin } from "@/lib/runtime";
import { publicMode } from "@/lib/deployment";
export function GET(request: Request) {
  const origin =
    publicMode() ||
    request.headers.get("x-pap-public-identity") === "1" ||
    new URL(request.url).origin === agentOrigin
      ? agentOrigin
      : "http://localhost:3000";
  return Response.json(
    {
      client_id: `${origin}/agent/client.json`,
      client_name: "Poppy Lab",
      jwks_uri: `${origin}/agent/jwks.json`,
      redirect_uris: [`${origin}/api/account/callback`],
      extensions: { operations: { version: "2" } },
      token_endpoint_auth_method: "private_key_jwt",
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

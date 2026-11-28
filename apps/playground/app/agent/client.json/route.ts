import { agentOrigin } from "@poppy-lab/pap-agent/runtime";
import { publicMode } from "@poppy-lab/pap-agent/deployment";
import { LOCAL_AGENT_ORIGIN } from "@poppy-lab/pap-core";
export function GET(request: Request) {
  const origin =
    publicMode() ||
    request.headers.get("x-pap-public-identity") === "1" ||
    new URL(request.url).origin === agentOrigin
      ? agentOrigin
      : LOCAL_AGENT_ORIGIN;
  return Response.json(
    {
      client_id: `${origin}/agent/client.json`,
      client_name: "Iris",
      jwks_uri: `${origin}/agent/jwks.json`,
      redirect_uris: [`${origin}/api/account/callback`],
      token_endpoint_auth_method: "private_key_jwt",
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

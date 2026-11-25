import { operatorDirectoryResponse } from "@poppy-lab/pap-client";
import { agentOrigin, operatorKey } from "@/lib/runtime";
import { publicMode } from "@/lib/deployment";
export const dynamic = "force-dynamic";
/**
 * §5.3, Web Bot Auth §5.5: the operator key directory that Iris's
 * Signature-Agent names. Each key also signs the response (Appendix B.1),
 * over the public authority and the body's digest.
 */
export async function GET(request: Request) {
  const authority = publicMode()
    ? new URL(agentOrigin).host
    : new URL(request.url).host;
  const { body, headers } = await operatorDirectoryResponse({
    keys: [await operatorKey()],
    authority,
  });
  return new Response(body, { headers });
}

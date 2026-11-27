/**
 * Where a Company's consent page sends the browser back (§4.2). The sign-in
 * is completed by the agent core (`@poppy-lab/pap-agent/sign-in-callback`).
 */
import "@/lib/agent";
import { cookies } from "next/headers";
import { signInCallback } from "@poppy-lab/pap-agent/sign-in-callback";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return signInCallback(request, await cookies());
}

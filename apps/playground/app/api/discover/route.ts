/**
 * Discovery of a Company, which starts a conversation with it or adds it
 * to the one the header names (docs/chat-continuity.md). The work is the
 * agent core's (`@poppy-lab/pap-agent/discover`).
 */
import "@/lib/agent";
import { cookies } from "next/headers";
import { discover } from "@poppy-lab/pap-agent/discover";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return discover(request, cookies);
}

/**
 * The chat, as the page speaks it (docs/chat-continuity.md). The turn
 * itself is the agent core's (`@poppy-lab/pap-agent/chat`).
 */
import "@/lib/agent";
import { cookies } from "next/headers";
import { chat } from "@poppy-lab/pap-agent/chat";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return chat(request, await cookies());
}

/**
 * The visitor's conversations, and the action that starts the demo over.
 * The work is the agent core's (`@poppy-lab/pap-agent/conversation-list`).
 */
import "@/lib/agent";
import { cookies } from "next/headers";
import {
  conversationAction,
  conversationList,
} from "@poppy-lab/pap-agent/conversation-list";

export const runtime = "nodejs";

export async function GET() {
  return conversationList(await cookies());
}

export async function POST(request: Request) {
  return conversationAction(request, await cookies());
}

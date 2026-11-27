/**
 * A conversation's Companies and account actions, as the page speaks them
 * (docs/chat-continuity.md). The work is the agent core's
 * (`@poppy-lab/pap-agent/account`).
 */
import "@/lib/agent";
import { cookies } from "next/headers";
import { account, accountView } from "@poppy-lab/pap-agent/account";

export const runtime = "nodejs";

/** One conversation, named by `?conversation=`: running, or ended and read-only. */
export async function GET(request: Request) {
  return accountView(request, await cookies());
}

export async function POST(request: Request) {
  return account(request, await cookies());
}

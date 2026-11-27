/**
 * The agent's channel-neutral API, versioned: conversations, messages,
 * choices, proposals, sign-in and events, for a client app
 * (`/api/v1/openapi.json`, docs/pap-agent.md). The work is the agent
 * core's (`@poppy-lab/pap-agent/api-http`).
 */
import "@/lib/agent";
import { cookies } from "next/headers";
import { v1 } from "@poppy-lab/pap-agent/api-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return v1(request, await cookies());
}

export async function POST(request: Request) {
  return v1(request, await cookies());
}

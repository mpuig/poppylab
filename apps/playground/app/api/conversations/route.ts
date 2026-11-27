/**
 * The visitor's conversations: a list for the Conversations view, and the
 * one action that starts the demo over. Only names and times leave here;
 * a conversation's words come from `/api/account?conversation=`.
 */
import "@/lib/agent";
import { toResponse } from "@poppy-lab/pap-agent/web";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  listConversations,
  resetDemo,
  visitorOf,
} from "@poppy-lab/pap-agent/runs";
import { overBudget } from "@poppy-lab/pap-agent/limits";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const visitor = visitorOf(await cookies());
  return NextResponse.json(
    { conversations: visitor ? await listConversations(visitor) : [] },
    { headers },
  );
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json(
      { error: "Same-origin requests required" },
      { status: 403, headers },
    );
  const visitor = visitorOf(await cookies(), true);
  const limited = await overBudget(
    request.headers.get("cf-connecting-ip"),
    visitor,
    "account",
  );
  if (limited) return toResponse(limited);
  let action: unknown;
  try {
    action = ((await request.json()) as { action?: unknown }).action;
  } catch {
    action = undefined;
  }
  if (action !== "reset-demo")
    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400, headers },
    );
  await resetDemo(visitor);
  return NextResponse.json({ reset: true }, { headers });
}

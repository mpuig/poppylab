/**
 * The visitor's conversations: a list for the Conversations view, and the
 * one action that starts the demo over. Only names and times leave here;
 * a conversation's words come from `/api/account?conversation=`.
 */
import { serving } from "./deployment";
import { listConversations, resetDemo, visitorOf } from "./runs";
import { overBudget } from "./limits";
import { browserCaller, readJson, toResponse, type CookieStore } from "./web";

const headers = { "Cache-Control": "no-store" };
const disabled = () =>
  Response.json(
    { error: "Conversations are disabled on this deployment." },
    { status: 403, headers },
  );

/** `GET /api/conversations`. */
export async function conversationList(cookies: CookieStore) {
  if (!serving()) return disabled();
  const visitor = visitorOf(cookies);
  return Response.json(
    { conversations: visitor ? await listConversations(visitor) : [] },
    { headers },
  );
}

/** `POST /api/conversations`, `{ action: "reset-demo" }`. */
export async function conversationAction(
  request: Request,
  cookies: CookieStore,
) {
  if (!serving()) return disabled();
  const caller = browserCaller(request, cookies);
  if (!caller.authentic)
    return Response.json(
      { error: "Same-origin requests required" },
      { status: 403, headers },
    );
  const visitor = caller.user(true);
  const limited = await overBudget(caller.ip, visitor, "account");
  if (limited) return toResponse(limited);
  let action: unknown;
  try {
    action = ((await readJson(request, 1024)) as { action?: unknown } | null)
      ?.action;
  } catch {
    action = undefined;
  }
  if (action !== "reset-demo")
    return Response.json({ error: "Unknown action" }, { status: 400, headers });
  await resetDemo(visitor);
  return Response.json({ reset: true }, { headers });
}

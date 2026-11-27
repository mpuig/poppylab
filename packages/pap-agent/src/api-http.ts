/**
 * The channel-neutral API (`api.ts`) over HTTP, versioned under
 * `/api/v1`: the routes the playground serves for a client app, and
 * which `openapi.ts` describes. Today a request is the visitor's, by the
 * playground's cookie, from the playground's own origin; a bearer API
 * session for each device of a client app comes next (`identity.ts`) and
 * is refused until then.
 */
import {
  answerChoice,
  decideProposal,
  getConversation,
  sendMessage,
  startConversation,
  startSignIn,
  type ApiError,
  type Result,
} from "./api";
import { conversationEvents } from "./api-events";
import { serving } from "./deployment";
import { openApiDocument } from "./openapi";
import { UserFacingError } from "./user-error";
import { browserCaller, readJson, type Caller, type CookieStore } from "./web";

export const API_PREFIX = "/api/v1";

/** Every route, as `openapi.ts` lists it: the test holds the two together. */
export const ROUTES = [
  { method: "GET", path: "/openapi.json", operation: "getOpenApi" },
  { method: "POST", path: "/conversations", operation: "startConversation" },
  { method: "GET", path: "/conversations/{id}", operation: "getConversation" },
  {
    method: "POST",
    path: "/conversations/{id}/messages",
    operation: "sendMessage",
  },
  {
    method: "POST",
    path: "/conversations/{id}/answers",
    operation: "answerChoice",
  },
  {
    method: "POST",
    path: "/conversations/{id}/proposals/{proposal}/decision",
    operation: "decideProposal",
  },
  {
    method: "POST",
    path: "/conversations/{id}/sign-ins",
    operation: "startSignIn",
  },
  {
    method: "GET",
    path: "/conversations/{id}/events",
    operation: "conversationEvents",
  },
] as const;
type Operation = (typeof ROUTES)[number]["operation"];

const headers = { "Cache-Control": "no-store" };
const error = (failure: ApiError) =>
  Response.json(
    { ...(failure.code ? { code: failure.code } : {}), error: failure.error },
    { status: failure.status, headers },
  );
const answer = <T>(result: Result<T>, status = 200) =>
  result.ok ? Response.json(result.value, { status, headers }) : error(result);

/** The route a request is for, and the names in its path. */
export function match(method: string, pathname: string) {
  if (!pathname.startsWith(API_PREFIX)) return undefined;
  const parts = pathname.slice(API_PREFIX.length).split("/");
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const want = route.path.split("/");
    if (want.length !== parts.length) continue;
    const names: Record<string, string> = {};
    if (
      want.every((part, i) => {
        if (!part.startsWith("{")) return part === parts[i];
        names[part.slice(1, -1)] = decodeURIComponent(parts[i]!);
        return /^[A-Za-z0-9_-]{1,128}$/.test(parts[i]!);
      })
    )
      return { operation: route.operation as Operation, names };
  }
  return undefined;
}

/** A JSON object body, or why it isn't one. */
async function body(request: Request): Promise<Record<string, unknown>> {
  let read: unknown;
  try {
    read = await readJson(request, 6000);
  } catch (failure) {
    throw failure instanceof UserFacingError
      ? failure
      : new UserFacingError("Send a JSON object.");
  }
  if (!read || typeof read !== "object" || Array.isArray(read))
    throw new UserFacingError("Send a JSON object.");
  return read as Record<string, unknown>;
}
const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

/** `/api/v1/…` for a browser request with the playground's cookies. */
export async function v1(request: Request, cookies: CookieStore) {
  const url = new URL(request.url);
  const route = match(request.method, url.pathname);
  if (!route)
    return error({
      status: 404,
      code: "not_found",
      error: "No such route. See /api/v1/openapi.json.",
    });
  if (route.operation === "getOpenApi")
    return Response.json(openApiDocument(), { headers });
  if (request.headers.get("authorization"))
    return error({
      status: 401,
      code: "api_session_unsupported",
      error:
        "API sessions aren't offered yet. Use this API from the playground's own origin.",
    });
  return serve(route, request, browserCaller(request, cookies));
}

async function serve(
  route: NonNullable<ReturnType<typeof match>>,
  request: Request,
  caller: Caller,
): Promise<Response> {
  const id = route.names.id ?? "";
  // A deployment without its configuration serves no route, whatever
  // each function would check, and reads no body.
  if (!serving())
    return error({
      status: 403,
      code: "disabled",
      error: "The agent is disabled on this deployment.",
    });
  // Reads need only the user; anything else must come from the user's own
  // page, as the playground's other routes require.
  if (request.method !== "GET" && !caller.authentic)
    return error({
      status: 403,
      code: "forbidden",
      error: "Same-origin requests required.",
    });
  try {
    switch (route.operation) {
      case "getConversation":
        return answer(await getConversation(caller, id));
      case "conversationEvents":
        return events(caller, id, request.signal);
      case "startConversation": {
        const input = await body(request);
        const company = text(input.company);
        return answer(
          await startConversation(caller, company ? { company } : {}),
          201,
        );
      }
      case "sendMessage": {
        const input = await body(request);
        return answer(
          await sendMessage(caller, id, {
            text: text(input.text) ?? "",
            ...(text(input.company) ? { company: text(input.company)! } : {}),
            ...model(input.model),
          }),
        );
      }
      case "answerChoice": {
        const input = await body(request);
        return answer(
          await answerChoice(caller, id, {
            answer: input.answer as never,
            ...model(input.model),
          }),
        );
      }
      case "decideProposal": {
        const input = await body(request);
        return answer(
          await decideProposal(caller, id, {
            proposal: route.names.proposal ?? "",
            company: text(input.company) ?? "",
            revision: text(input.revision) ?? "",
            decision: input.decision as "approve" | "decline",
          }),
        );
      }
      case "startSignIn": {
        const input = await body(request);
        return answer(
          await startSignIn(caller, id, {
            company: text(input.company) ?? "",
            access: input.access === "write" ? "write" : "read",
          }),
        );
      }
    }
  } catch (failure) {
    return error({
      status: 400,
      code: "invalid_request",
      error:
        failure instanceof UserFacingError
          ? failure.message
          : "The request couldn't be read.",
    });
  }
  return error({ status: 404, code: "not_found", error: "No such route." });
}

const model = (value: unknown) => {
  if (!value || typeof value !== "object") return {};
  const m = value as Record<string, unknown>;
  return {
    model: {
      provider: (text(m.provider) ?? "demo") as "demo",
      ...(text(m.apiKey) !== undefined ? { apiKey: text(m.apiKey)! } : {}),
      ...(text(m.model) !== undefined ? { model: text(m.model)! } : {}),
    },
  };
};

/**
 * The conversation's events as Server-Sent Events: `state` first, then
 * each change, named by its `type`, with a comment every reading so a
 * proxy keeps the stream open. It closes after five minutes or when the
 * conversation ends; the client opens it again and starts from `state`.
 */
async function events(caller: Caller, id: string, signal: AbortSignal) {
  const first = await getConversation(caller, id);
  if (!first.ok) return error(first);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away.
        }
      };
      write("retry: 3000\n\n");
      try {
        for await (const event of conversationEvents(caller, id, {
          signal,
          onRead: () => write(": read\n\n"),
        }))
          write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } finally {
        try {
          controller.close();
        } catch {
          // Closed already.
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

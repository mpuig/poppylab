/**
 * The channel-neutral API (`api.ts`) over HTTP, versioned under
 * `/api/v1`: the routes the playground serves for a client app, and
 * which `openapi.ts` describes. A request is the browser's, by the
 * playground's cookies, from the playground's own origin; or a client
 * app's, by `Authorization: Bearer <access token>` of the API session
 * its device signed in with (`api-sessions.ts`); or, for an app's
 * sign-in link, the browser the app opened it in, by its ticket
 * (`sign-in-links.ts`). The account's own routes are
 * `agent-account-http.ts`.
 */
import type { ZodType } from "zod";
import {
  answerChoice,
  decideProposal,
  getConversation,
  listPending,
  sendMessage,
  startConversation,
  startSignIn,
  type ApiError,
  type Result,
  type TurnOptions,
  type TurnResult,
} from "./api";
import {
  accountOperations,
  conversationOperations,
  pathSegmentSchema,
} from "./api-contract/index.ts";
import { answerStream, turnEvents, wantsEvents } from "./answer-stream";
import {
  conversationEvents,
  holdStream,
  MAX_STREAMS,
  MAX_VISITOR_STREAMS,
} from "./api-events";
import { overAccountBudget } from "./account-limits";
import {
  ACCOUNT_OPERATIONS,
  accountOperation,
  OPEN_OPERATIONS,
  openOperation,
  redeemOverHttp,
  type AccountOperation,
  type OpenOperation,
} from "./agent-account-http";
import { sessionOfAccessToken, stillSignedIn } from "./api-sessions";
import { apiSessionCaller } from "./identity";
import { serving } from "./deployment";
import openApiDocumentJson from "../openapi.json" with { type: "json" };
import { readPublicInput } from "./public-input";
import { storage } from "./runs";
import { createSignInLink, openSignInLink } from "./sign-in-links";
import { UserFacingError } from "./user-error";
import {
  accountCookie,
  browserCaller,
  toResponse,
  type Caller,
  type CookieStore,
} from "./web";

export const API_PREFIX = "/api/v1";

/** Every route, as `openapi.ts` lists it: the test holds the two together. */
export const ROUTES = [
  { method: "GET", path: "/openapi.json", operation: "getOpenApi" },
  { method: "POST", path: "/conversations", operation: "startConversation" },
  { method: "GET", path: "/pending", operation: "listPending" },
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
  { method: "GET", path: "/sign-ins/{ticket}", operation: "openSignInLink" },
  { method: "POST", path: "/accounts/options", operation: "accountOptions" },
  { method: "POST", path: "/accounts", operation: "createAccount" },
  { method: "POST", path: "/sessions/options", operation: "signInOptions" },
  { method: "POST", path: "/sessions", operation: "signIn" },
  { method: "POST", path: "/sessions/refresh", operation: "refreshSession" },
  { method: "GET", path: "/account", operation: "getAccount" },
  {
    method: "POST",
    path: "/account/passkeys/options",
    operation: "passkeyOptions",
  },
  { method: "POST", path: "/account/passkeys", operation: "addPasskey" },
  {
    method: "DELETE",
    path: "/account/passkeys/{passkey}",
    operation: "removePasskey",
  },
  { method: "GET", path: "/account/sessions", operation: "listSessions" },
  {
    method: "DELETE",
    path: "/account/sessions/{session}",
    operation: "revokeSession",
  },
  {
    method: "DELETE",
    path: "/account/sessions",
    operation: "revokeAllSessions",
  },
  { method: "POST", path: "/account/sign-out", operation: "signOut" },
  {
    method: "POST",
    path: "/account/claim",
    operation: "claimConversations",
  },
  { method: "POST", path: "/account/link-codes", operation: "createLinkCode" },
  {
    method: "POST",
    path: "/link-codes/redeem",
    operation: "redeemLinkCode",
  },
] as const;
type Operation = (typeof ROUTES)[number]["operation"];

const ROUTE_PARAMETERS: Partial<Record<Operation, ZodType>> = {
  getConversation: conversationOperations.getConversation.parameters,
  sendMessage: conversationOperations.sendMessage.parameters,
  answerChoice: conversationOperations.answerChoice.parameters,
  decideProposal: conversationOperations.decideProposal.parameters,
  startSignIn: conversationOperations.startSignIn.parameters,
  conversationEvents: conversationOperations.conversationEvents.parameters,
  openSignInLink: conversationOperations.openSignInLink.parameters,
  removePasskey: accountOperations.removePasskey.parameters,
  revokeSession: accountOperations.revokeSession.parameters,
};

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
        const value = parts[i] ?? "";
        if (!pathSegmentSchema.safeParse(value).success) return false;
        names[part.slice(1, -1)] = value;
        return true;
      })
    ) {
      const parameters = ROUTE_PARAMETERS[route.operation];
      if (parameters && !parameters.safeParse(names).success) continue;
      return { operation: route.operation, names };
    }
  }
  return undefined;
}

const isOpen = (operation: Operation): operation is OpenOperation =>
  (OPEN_OPERATIONS as readonly string[]).includes(operation);
const ofAccount = (operation: Operation): operation is AccountOperation =>
  (ACCOUNT_OPERATIONS as readonly string[]).includes(operation);
const bearer = (authorization: string) =>
  /^Bearer ([A-Za-z0-9._-]{1,200})$/.exec(authorization)?.[1];

/**
 * `/api/v1/…`: a browser's request with the playground's cookies, or a
 * client app's with its bearer token.
 */
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
    return Response.json(openApiDocumentJson, { headers });
  // A deployment without its configuration serves no route, whatever
  // each function would check, and reads no body.
  if (!serving())
    return error({
      status: 403,
      code: "disabled",
      error: "The agent is disabled on this deployment.",
    });
  // A page of another origin is refused everything that changes
  // something, whatever it carries: its requests always say where they
  // come from. A client app sends no Origin at all.
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin !== null && origin !== url.origin)
    return error({
      status: 403,
      code: "forbidden",
      error: "Same-origin requests required.",
    });
  const authorization = request.headers.get("authorization");
  if (route.operation === "redeemLinkCode")
    return guarded(redeemOverHttp(request));
  // Opened in an app's browser: the ticket says whose sign-in it is.
  if (route.operation === "openSignInLink")
    return openSignInLink(request, cookies, route.names.ticket ?? "");
  if (authorization) {
    const token = bearer(authorization);
    const session = token ? await sessionOfAccessToken(token) : undefined;
    if (!session)
      return new Response(
        JSON.stringify({
          code: "invalid_token",
          error:
            "This access token isn't valid any more. Refresh it, or sign in again with your passkey.",
        }),
        {
          status: 401,
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "WWW-Authenticate": 'Bearer error="invalid_token"',
          },
        },
      );
    return serve(route, request, apiSessionCaller(request, session), cookies);
  }
  return serve(route, request, await browserCaller(request, cookies), cookies);
}

/** A handler's answer, or 400 for a body it couldn't read. */
async function guarded(work: Promise<Response>) {
  try {
    return await work;
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
}

async function serve(
  route: NonNullable<ReturnType<typeof match>>,
  request: Request,
  caller: Caller,
  cookies: CookieStore,
): Promise<Response> {
  const id = route.names.id ?? "";
  const operation = route.operation;
  // Creating an account and signing in need no one to be signed in: a
  // client app has nothing yet to show, and the browser's page has been
  // held to its origin above.
  if (isOpen(operation))
    return guarded(openOperation(operation, request, cookies, caller.origin));
  // Reads need only the user; anything else must come from the user's own
  // page, as the playground's other routes require, or carry a token.
  if (request.method !== "GET" && !caller.authentic)
    return error({
      status: 403,
      code: "forbidden",
      error: "Same-origin requests required.",
    });
  if (ofAccount(operation))
    return guarded(
      accountOperation(operation, request, caller, cookies, route.names),
    );
  try {
    switch (operation) {
      case "getConversation":
        return answer(await getConversation(caller, id));
      case "listPending":
        return answer(await listPending(caller));
      case "conversationEvents":
        return events(caller, id, request, cookies);
      case "startConversation": {
        const contract = conversationOperations.startConversation;
        const parsed = await readPublicInput(
          request,
          6000,
          contract.body,
          contract.messages,
        );
        if (!parsed.ok) return error(parsed.error);
        return answer(
          await startConversation(
            caller,
            parsed.value.company === undefined
              ? {}
              : { company: parsed.value.company },
          ),
          201,
        );
      }
      case "sendMessage": {
        const contract = conversationOperations.sendMessage;
        const parsed = await readPublicInput(
          request,
          6000,
          contract.body,
          contract.messages,
        );
        if (!parsed.ok) return error(parsed.error);
        const message = {
          text: parsed.value.text,
          ...(parsed.value.company === undefined
            ? {}
            : { company: parsed.value.company }),
          ...(parsed.value.model === undefined
            ? {}
            : { model: parsed.value.model }),
        };
        return turned(request, (options) =>
          sendMessage(caller, id, message, options),
        );
      }
      case "answerChoice": {
        const contract = conversationOperations.answerChoice;
        const parsed = await readPublicInput(
          request,
          6000,
          contract.body,
          contract.messages,
        );
        if (!parsed.ok) return error(parsed.error);
        const choice = {
          answer: parsed.value.answer,
          ...(parsed.value.model === undefined
            ? {}
            : { model: parsed.value.model }),
        };
        return turned(request, (options) =>
          answerChoice(caller, id, choice, options),
        );
      }
      case "decideProposal": {
        const contract = conversationOperations.decideProposal;
        const parsed = await readPublicInput(
          request,
          6000,
          contract.body,
          contract.messages,
        );
        if (!parsed.ok) return error(parsed.error);
        return answer(
          await decideProposal(caller, id, {
            proposal: route.names.proposal ?? "",
            ...parsed.value,
          }),
        );
      }
      case "startSignIn": {
        const contract = conversationOperations.startSignIn;
        const parsed = await readPublicInput(
          request,
          6000,
          contract.body,
          contract.messages,
        );
        if (!parsed.ok) return error(parsed.error);
        const access = parsed.value.access ?? "read";
        // The Company's consent page comes back to a browser, which binds
        // the sign-in to itself with a cookie. An app's session has none,
        // so it is given a link that starts the sign-in in the browser it
        // opens the link in (`sign-in-links.ts`).
        if (caller.account?.via === "bearer")
          return answer(
            await createSignInLink(caller, id, {
              company: parsed.value.company,
              access,
            }),
          );
        return answer(
          await startSignIn(caller, id, {
            company: parsed.value.company,
            access,
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

/**
 * A turn's answer: its result as JSON, or, for a client that accepts
 * `text/event-stream`, the agent's sentences as they are written
 * (`message.delta`), then `turn` with the same result, each of the agent's
 * messages in it with the `id` its sentences named. What the turn says at
 * once (demo mode, the agent's own lines) comes the same way, whole. A
 * turn refused before it said anything is answered as without the
 * stream, with its status; one that fails after ends with `error`.
 */
async function turned(
  request: Request,
  run: (options: TurnOptions) => Promise<Result<TurnResult>>,
) {
  if (!wantsEvents(request)) return answer(await run({}));
  return turnEvents(async (send) => {
    const said = answerStream(send);
    const result = await run({ stream: said.stream });
    if (!result.ok)
      return {
        last: {
          type: "error",
          status: result.status,
          ...(result.code ? { code: result.code } : {}),
          error: result.error,
        },
        instead: () => error(result),
      };
    return {
      last: {
        type: "turn",
        result: {
          ...result.value,
          messages: said.finish(result.value.messages),
        },
      },
    };
  });
}

/**
 * The conversation's events as Server-Sent Events: `state` first, then
 * each change, named by its `type`, with a comment every reading so a
 * proxy keeps the stream open. It closes after five minutes or when the
 * conversation ends; the client opens it again and starts from `state`.
 * A signed-in request's stream ends with `session.ended` within seconds
 * of its session ending or its access token running out. Opening one is
 * counted per source and per account; a signed-in account holds at most
 * `MAX_STREAMS` open at once, and an anonymous visitor holds at most
 * `MAX_VISITOR_STREAMS`.
 */
async function events(
  caller: Caller,
  id: string,
  request: Request,
  cookies: CookieStore,
) {
  const signed = caller.account;
  const over = await overAccountBudget("events", {
    ip: caller.ip,
    ...(signed ? { account: signed.id } : {}),
  });
  if (over) return toResponse(over);
  const first = await getConversation(caller, id);
  if (!first.ok) return error(first);
  const visitor = signed ? undefined : caller.user();
  const held = signed
    ? await holdStream(signed.id)
    : visitor
      ? await holdStream({
          bucket: visitor,
          backend: storage(),
          limit: MAX_VISITOR_STREAMS,
        })
      : undefined;
  if (!held)
    return Response.json(
      {
        code: "too_many_streams",
        error: signed
          ? `This account has ${MAX_STREAMS} event streams open already. Close one, or wait a minute and try again.`
          : `This browser has ${MAX_VISITOR_STREAMS} event streams open already. Close one, or wait a minute and try again.`,
      },
      { status: 429, headers: { ...headers, "Retry-After": "60" } },
    );
  // What signed the request in, to ask again while the stream lasts.
  const credential =
    signed?.via === "cookie"
      ? cookies.get(accountCookie())?.value
      : bearer(request.headers.get("authorization") ?? "");
  const stop = new AbortController();
  if (request.signal.aborted) stop.abort();
  else
    request.signal.addEventListener("abort", () => stop.abort(), {
      once: true,
    });
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
          signal: stop.signal,
          onRead: () => write(": read\n\n"),
          ...(signed
            ? { signedIn: () => stillSignedIn(signed.via, credential) }
            : {}),
        }))
          write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } finally {
        await held.release();
        try {
          controller.close();
        } catch {
          // Closed already.
        }
      }
    },
    cancel() {
      stop.abort();
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

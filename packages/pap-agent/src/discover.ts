import {
  browserUser,
  readJson,
  setCookie,
  toResponse,
  type CookieStore,
} from "./web";
import { discoverCompany } from "@poppy-lab/pap-client";
import { LOCAL_COMPANY_ORIGINS, PapDiscoveryError } from "@poppy-lab/pap-core";
import {
  acquireRun,
  createRun,
  pendingSignIns,
  releaseRun,
  type Held,
} from "./runs";
import { signInCookie, signInCookieOptions } from "./sign-in-cookie";
import { connectionAt } from "./connections";
import { connectCompany } from "./connecting";
import { conversationEnded, overBudget } from "./limits";
import { notSaved } from "./run-size";
import { publicMode, serving } from "./deployment";

// Single-process safeguards, not a substitute for shared edge rate limiting.
let activeRequests = 0;
let windowStarted = Date.now();
let requestsInWindow = 0;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Connects one more Company to a conversation that is going on, and
 * answers with its discovery as a new conversation's is answered. What
 * the conversation holds stays as it is: its words, its other Companies,
 * a sign-in under way at one of them. Refused, with words the page can
 * show, for a Company it is already connected to, for a fourth one, and
 * for one whose documents the stored conversation has no room for.
 *
 * The Company counts as connected once the conversation is saved with it:
 * a save that fails is answered as such, not as a connection the next
 * request wouldn't find.
 */
async function addTo(
  held: Held,
  visitor: string,
  url: string,
  allowedPrivateOrigins: string[],
) {
  let added: Awaited<ReturnType<typeof connectCompany>>;
  try {
    added = await connectCompany(held.run, url, allowedPrivateOrigins);
  } catch (error) {
    await releaseRun(visitor, held).catch(() => {});
    throw error;
  }
  if ("code" in added) {
    await releaseRun(visitor, held).catch(() => {});
    return json(added, 409);
  }
  try {
    await releaseRun(visitor, held);
  } catch (error) {
    const { status, ...refusal } = notSaved(error);
    return json(refusal, status);
  }
  const response = json(added.company);
  response.headers.set("X-Poppy-Conversation", held.id);
  return response;
}

/**
 * `POST /api/discover`: discovery of a Company, which connects it to the
 * conversation the header names or starts one with it.
 */
export async function discover(
  request: Request,
  /** Read only once the request is let in, as Next's `cookies()`. */
  jar: () => Promise<CookieStore>,
) {
  if (!serving())
    return json({ error: "Discovery is disabled on this deployment." }, 403);
  // As on every route that changes something: the page's own requests
  // always carry its Origin, so one without it is refused too.
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return json(
      { error: "Cross-origin discovery requests are not allowed" },
      403,
    );
  }
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return json({ error: "Use application/json" }, 415);
  }
  if (Date.now() - windowStarted > 60_000) {
    windowStarted = Date.now();
    requestsInWindow = 0;
  }
  const isolate = process.env.POPPY_PUBLIC === "true" ? 10 : 1;
  if (activeRequests >= 4 * isolate || requestsInWindow >= 30 * isolate) {
    const response = json({ error: "Discovery is busy. Retry shortly." }, 429);
    response.headers.set("Retry-After", "60");
    return response;
  }
  const limited =
    publicMode() &&
    (await overBudget(
      request.headers.get("cf-connecting-ip"),
      await browserUser(await jar(), true),
      "discover",
    ));
  if (limited) return toResponse(limited);
  activeRequests += 1;
  requestsInWindow += 1;
  try {
    let body: unknown;
    try {
      body = await readJson(request, 4096);
    } catch {
      return json(
        { error: "Request must be valid JSON no larger than 4096 bytes" },
        400,
      );
    }
    const url =
      typeof body === "object" && body && "url" in body ? body.url : null;
    if (typeof url !== "string" || !url.trim() || url.length > 2048) {
      return json({ error: "Enter a valid Company URL" }, 400);
    }
    const allowedPrivateOrigins =
      process.env.NODE_ENV === "development" &&
      process.env.PAP_ALLOW_PRIVATE_NETWORK === "true"
        ? [...LOCAL_COMPANY_ORIGINS]
        : [];
    // A request that names a running conversation adds the Company to it.
    // One that names none, or one unknown here, starts a conversation.
    const named = request.headers.get("x-poppy-conversation");
    if (named) {
      const visitor = await browserUser(await jar(), true);
      const held = await acquireRun(visitor, named);
      if (held === "busy")
        return json(
          { error: "Wait for the current response.", code: "busy" },
          409,
        );
      if (held) return await addTo(held, visitor, url, allowedPrivateOrigins);
      // One that ended is still on the page that names it: the page is
      // told, and no new conversation starts in its place.
      const over = await conversationEnded(visitor, named);
      if (over) return toResponse(over);
    }
    // §9: tasks need a Session, so Iris reads them when it connects.
    const result = await discoverCompany(url, { allowedPrivateOrigins });
    const response = json(result);
    // Connecting starts a conversation; its ID becomes the page's address.
    try {
      const visitor = await browserUser(await jar(), true);
      // A sign-in started before, in a conversation the page no longer
      // shows, doesn't complete behind the new one: its cookie goes.
      for (const state of await pendingSignIns(visitor)) {
        const cookie = signInCookie(state);
        if (cookie) setCookie(response, cookie, "", signInCookieOptions(0));
      }
      const held = await createRun(visitor, result.requestedUrl);
      const connection = connectionAt(held.run, result.requestedUrl);
      if (connection) connection.company = result;
      await releaseRun(visitor, held);
      response.headers.set("X-Poppy-Conversation", held.id);
    } catch {
      // Without one the first message or sign-in starts it instead.
    }
    return response;
  } catch (error) {
    if (error instanceof PapDiscoveryError) {
      return json(
        { error: error.message, code: error.code, trace: error.trace },
        422,
      );
    }
    return json({ error: "Discovery failed safely" }, 500);
  } finally {
    activeRequests -= 1;
  }
}

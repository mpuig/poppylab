import { discoverCompany } from "@poppy-lab/pap-client";
import { LOCAL_COMPANY_ORIGINS, PapDiscoveryError } from "@poppy-lab/pap-core";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  acquireRun,
  createRun,
  pendingSignIns,
  releaseRun,
  visitorOf,
  type Held,
} from "@/lib/runs";
import { signInCookie, signInCookieOptions } from "@/lib/sign-in-cookie";
import { connectionAt } from "@/lib/connections";
import { connectCompany } from "@/lib/connecting";
import { conversationEnded, overBudget } from "@/lib/limits";
import { notSaved } from "@poppy-lab/pap-agent/run-size";
import { publicMode } from "@poppy-lab/pap-agent/deployment";

export const runtime = "nodejs";

// Single-process safeguards, not a substitute for shared edge rate limiting.
let activeRequests = 0;
let windowStarted = Date.now();
let requestsInWindow = 0;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Body timed out")), 3000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("Body too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    clearTimeout(timer!);
    void reader.cancel();
  }
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

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
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
    (await overBudget(request, visitorOf(await cookies(), true), "discover"));
  if (limited) return limited;
  activeRequests += 1;
  requestsInWindow += 1;
  try {
    let body: unknown;
    try {
      body = await readBody(request);
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
      const visitor = visitorOf(await cookies(), true);
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
      if (over) return over;
    }
    // §9: tasks need a Session, so Iris reads them when it connects.
    const result = await discoverCompany(url, { allowedPrivateOrigins });
    const response = json(result);
    // Connecting starts a conversation; its ID becomes the page's address.
    try {
      const visitor = visitorOf(await cookies(), true);
      // A sign-in started before, in a conversation the page no longer
      // shows, doesn't complete behind the new one: its cookie goes.
      for (const state of await pendingSignIns(visitor)) {
        const cookie = signInCookie(state);
        if (cookie) response.cookies.set(cookie, "", signInCookieOptions(0));
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

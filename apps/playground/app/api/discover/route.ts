import { discoverCompany, fetchExcludedTasks } from "@poppy-lab/pap-client";
import { LOCAL_COMPANY_ORIGINS, PapDiscoveryError } from "@poppy-lab/pap-core";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { visitorOf } from "@/lib/runs";
import { overBudget } from "@/lib/limits";
import { publicMode } from "@/lib/deployment";

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
    const result = await discoverCompany(url, { allowedPrivateOrigins });
    if (result.profile?.excludedTasksUrl) {
      try {
        result.excludedTasks = await fetchExcludedTasks(result, {
          allowedPrivateOrigins,
        });
      } catch {
        // Optional and advisory: discovery stays valid; never invent a list.
        result.excludedTasksError =
          "Excluded tasks are listed but could not be read.";
      }
    }
    const response = json(result);
    response.cookies.set("pap_oauth", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/account/callback",
      maxAge: 0,
    });
    response.cookies.set("pap_run", "", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
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

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { allow, type Limit } from "./runs";
import { publicMode } from "./deployment";

const minute = 60000,
  day = 86400000;
const l = (name: string, limit: number, windowMs: number): Limit => ({
  name,
  limit,
  windowMs,
});
/**
 * Public-mode budgets. Model calls use the visitor's own key, so these
 * protect the Companies and this deployment's compute, not model spend.
 * The visitor cookie is the client's to rotate, so per-visitor budgets only
 * bound honest users; the per-IP (Cloudflare's `cf-connecting-ip`) and
 * global budgets are the ones that hold against abuse.
 */
const budgets = {
  chat: {
    visitor: [l("chat:m", 8, minute), l("chat:d", 150, day)],
    ip: [l("chat:ip", 20, minute)],
    global: [l("chat:g", 600, minute)],
  },
  account: {
    visitor: [l("account:m", 20, minute)],
    ip: [l("account:ip", 40, minute)],
    global: [l("account:g", 1200, minute)],
  },
  discover: {
    visitor: [l("discover:m", 20, minute)],
    ip: [l("discover:ip", 40, minute)],
    global: [l("discover:g", 1200, minute)],
  },
};

/** 429 when over budget (public mode only), otherwise undefined. */
export async function overBudget(
  request: Request,
  visitor: string,
  kind: keyof typeof budgets,
) {
  if (!publicMode()) return undefined;
  const b = budgets[kind];
  const ip = request.headers.get("cf-connecting-ip");
  const ok =
    (await allow(visitor, { visitor: b.visitor, global: b.global })) &&
    (!ip ||
      (await allow(
        `ip:${createHash("sha256").update(ip).digest("base64url")}`,
        { visitor: b.ip },
      )));
  if (ok) return undefined;
  return NextResponse.json(
    { error: "Too many requests. Wait a minute and try again." },
    {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    },
  );
}

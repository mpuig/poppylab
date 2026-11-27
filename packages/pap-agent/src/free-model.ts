/**
 * The free model: a small model of the deployment's own, for a visitor
 * who brings no key. It is Cloudflare Workers AI, reached through the
 * Worker's binding, so the deployment pays for every turn. A turn may use
 * it only past Cloudflare Turnstile and within the limits below; any other
 * turn asked of it runs in demo mode, with one line that says why.
 *
 * Configuration: the binding, named by the channel with
 * `configureFreeModel` (on Workers it exists only while a request is
 * served); `TURNSTILE_SITE_KEY` (public) and the secret
 * `TURNSTILE_SECRET_KEY`; `FREE_MODEL_DAILY_NEURONS`, the day's cap for
 * all visitors, and `FREE_MODEL_PAID_USD_PER_DAY`, the only way past
 * Workers AI's free allocation.
 */
import { createHmac } from "node:crypto";
import { addressKey } from "@poppy-lab/pap-client";
import type { WorkersAiBinding } from "@poppy-lab/llm-adapters/server";
import { publicMode } from "./deployment";
import type { Language } from "./language";
import { say, type LineParams } from "./lines";
import { allow, storage, type Limit } from "./runs";
import type { Caller } from "./web";

const hour = 3600000,
  day = 86400000;

/**
 * Workers AI gives each account 10,000 Neurons a day at no charge, reset at
 * 00:00 UTC, and charges $0.011 per 1,000 past them on Workers Paid.
 */
export const FREE_NEURONS = 10000;
const USD_PER_NEURON = 0.011 / 1000;
/** The day's cap when none is set: well inside the free allocation. */
const DEFAULT_DAILY_NEURONS = 7000;
/**
 * Kept free under the cap before a turn starts: about what the costliest
 * turn the lab's tasks took (a payment across two Companies, 157 Neurons)
 * and its routing call. A turn runs to its end once it has started.
 */
const TURN_RESERVE = 200;

/**
 * Turns a visitor may ask of the free model, and the visitors at one
 * network address together (a household or an office): the visitor
 * cookie is the client's to rotate.
 */
export const FREE_LIMITS = {
  visitor: { hour: 8, day: 20 },
  network: { hour: 16, day: 40 },
};

/** The Turnstile action the page's widget names, checked on every token. */
export const TURNSTILE_ACTION = "chat";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/**
 * Cloudflare's test secret that passes every dummy token, whose answer has
 * no action and the hostname example.com. It is taken only outside public
 * mode, for local checks of the page.
 */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

/** The adapters' provider for a turn's: the free model is Workers AI. */
export const modelProvider = (provider: string) =>
  provider === "free" ? "workers-ai" : provider;

const global = globalThis as typeof globalThis & {
  papFreeModel?: () => WorkersAiBinding | undefined;
};

/**
 * Names the Workers AI binding. Called once, before the first request; the
 * binding is asked for on each request that needs it.
 */
export function configureFreeModel(options: {
  binding: () => WorkersAiBinding | undefined;
}) {
  global.papFreeModel = options.binding;
}

const env = (name: string) =>
  typeof process === "undefined" ? undefined : process.env[name] || undefined;

function binding() {
  try {
    return global.papFreeModel?.();
  } catch {
    return undefined;
  }
}

/**
 * Whether the free model can be used here, with the Turnstile site key the
 * page needs for it; otherwise the plain reason, for the page to show.
 */
export function freeModelStatus():
  { available: true; siteKey: string } | { available: false; reason: string } {
  if (!binding())
    return {
      available: false,
      reason:
        "The free model runs only on the deployed site, where Workers AI is bound. Here, use Demo mode or your own model.",
    };
  const siteKey = env("TURNSTILE_SITE_KEY");
  if (!siteKey || !env("TURNSTILE_SECRET_KEY"))
    return {
      available: false,
      reason:
        "The free model is off on this deployment until its Turnstile site key and secret are set.",
    };
  return { available: true, siteKey };
}

/**
 * The day's cap in Neurons for every visitor together: the configured
 * cap, never past the free allocation unless a paid budget is set.
 */
export function dailyNeurons() {
  const number = (name: string, fallback: number) => {
    const value = Number(env(name) ?? fallback);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const paid = number("FREE_MODEL_PAID_USD_PER_DAY", 0) / USD_PER_NEURON;
  return Math.floor(
    Math.min(
      number("FREE_MODEL_DAILY_NEURONS", DEFAULT_DAILY_NEURONS),
      FREE_NEURONS + paid,
    ),
  );
}

/** The UTC day, as Workers AI counts its allocation. */
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const neuronsKey = (date: string) => `free-model:neurons:${date}`;

/** The Neurons every visitor's turns have used today. */
export async function neuronsToday(now = Date.now()) {
  const entry = await storage().get("global", neuronsKey(today(now)));
  return typeof entry?.value === "number" ? entry.value : 0;
}

/** Adjusts the day's count by `delta`, clamping at 0, compare-and-set. */
async function adjustNeurons(delta: number, now = Date.now()) {
  if (!Number.isFinite(delta) || delta === 0) return;
  const key = neuronsKey(today(now));
  for (let tries = 0; tries < 8; tries++) {
    const entry = await storage().get("global", key);
    const used = typeof entry?.value === "number" ? entry.value : 0;
    const next = Math.max(0, used + delta);
    if (!entry && next === 0) return;
    if (await storage().put("global", key, next, entry?.version ?? null)) {
      // The first count of a day lets the day before's go.
      if (!entry)
        await storage()
          .remove("global", neuronsKey(today(now - day)))
          .catch(() => {});
      return;
    }
  }
}

/** Adds what a turn used to the day's count, compare-and-set. */
export async function addNeurons(neurons: number, now = Date.now()) {
  if (!(neurons > 0)) return;
  await adjustNeurons(neurons, now);
}

/**
 * Reserves `reserve` Neurons under `cap` before a turn runs, compare-and-set.
 * Fails closed if the cap is reached or contention exhausts retries.
 */
async function reserveNeurons(
  reserve: number,
  cap: number,
  now = Date.now(),
): Promise<boolean> {
  const key = neuronsKey(today(now));
  for (let tries = 0; tries < 8; tries++) {
    const entry = await storage().get("global", key);
    const used = typeof entry?.value === "number" ? entry.value : 0;
    if (used + reserve > cap) return false;
    if (
      await storage().put("global", key, used + reserve, entry?.version ?? null)
    ) {
      // The first count of a day lets the day before's go.
      if (!entry)
        await storage()
          .remove("global", neuronsKey(today(now - day)))
          .catch(() => {});
      return true;
    }
  }
  return false;
}

/**
 * Whether Turnstile vouches for this token: once (Cloudflare answers a
 * token it has seen with `timeout-or-duplicate`), for this site's host and
 * the chat's action.
 */
async function verified(
  token: string,
  origin: string,
  secret: string,
  ip?: string | null,
) {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const response = await fetch(SITEVERIFY, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    const result = (await response.json()) as {
      success?: unknown;
      hostname?: unknown;
      action?: unknown;
    };
    if (result.success !== true) return false;
    if (secret === TEST_SECRET && !publicMode()) return true;
    return (
      result.hostname === new URL(origin).hostname &&
      result.action === TURNSTILE_ACTION
    );
  } catch {
    return false;
  }
}

/**
 * The network's bucket for the limits: its address keyed with the secret
 * and the day, so the record says nothing about the address and no two
 * days' records can be matched. An IPv6 address counts by its /64.
 */
const networkBucket = (ip: string, secret: string, now: number) =>
  `free-ip:${createHmac("sha256", secret)
    .update(`${today(now)}\n${addressKey(ip)}`)
    .digest("base64url")}`;

const limit = (name: string, count: number, windowMs: number): Limit => ({
  name,
  limit: count,
  windowMs,
});

/** A free-model turn let in: the model's configuration, and its bill. */
export type FreeTurn = {
  workersAi: {
    binding: WorkersAiBinding;
    onUsage: (neurons: number) => void;
  };
  /** Adds the Neurons the turn used to the day's count. */
  settle: () => Promise<void>;
};

/**
 * Lets a turn use the free model, or says in one line why it runs in demo
 * mode instead. `visitor` is the turn's agent user; `token` the Turnstile
 * token the request carries, verified here before anything is counted.
 */
export async function admitFreeTurn(
  caller: Pick<Caller, "ip" | "origin">,
  visitor: string,
  token: string | undefined,
  now = Date.now(),
  /** The conversation's language, for the line about demo mode. */
  language: Language = "en",
): Promise<FreeTurn | { notice: string }> {
  const status = freeModelStatus();
  const ai = binding();
  const secret = env("TURNSTILE_SECRET_KEY");
  const notice = (why: LineParams<"freeModel">["why"], count?: number) => ({
    notice: say(language, "freeModel", { why, count }),
  });
  if (!status.available || !ai || !secret)
    return notice(!ai ? "notDeployed" : "off");
  const cap = dailyNeurons();
  const capNotice = notice("allowance");
  if ((await neuronsToday(now)) + TURN_RESERVE > cap) return capNotice;
  if (!token) return notice("unfinished");
  if (!(await verified(token, caller.origin, secret, caller.ip)))
    return notice("failed");
  const { visitor: mine, network } = FREE_LIMITS;
  if (!(await allow(visitor, { visitor: [limit("free:h", mine.hour, hour)] })))
    return notice("hour", mine.hour);
  if (!(await allow(visitor, { visitor: [limit("free:d", mine.day, day)] })))
    return notice("day", mine.day);
  if (caller.ip) {
    const bucket = networkBucket(caller.ip, secret, now);
    if (
      !(await allow(bucket, {
        visitor: [
          limit("free:h", network.hour, hour),
          limit("free:d", network.day, day),
        ],
      }))
    )
      return notice("network");
  }
  if (!(await reserveNeurons(TURN_RESERVE, cap, now))) return capNotice;
  let used = 0;
  let settled = false;
  return {
    workersAi: {
      binding: ai,
      onUsage: (neurons) => {
        if (Number.isFinite(neurons) && neurons > 0) used += neurons;
      },
    },
    settle: async () => {
      if (settled) return;
      settled = true;
      await adjustNeurons(used - TURN_RESERVE, now);
    },
  };
}

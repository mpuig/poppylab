import { expect, it } from "vitest";
import {
  keepLines,
  keepSignedOutLines,
  LOG_LIMITS,
  shownLines,
} from "./inspector-log";
import { logEntry } from "./protocol-log";
import { onlyConnection as at } from "./connections";
import type { Connection, Run } from "./runtime";
import { keepSignedOutTranscript } from "./transcript";

/** A conversation with one Company, signed out unless the test says so. */
const run = (connection: Partial<Connection> = {}): Run => ({
  expires: Date.now() + 60000,
  calls: 0,
  busy: false,
  history: [],
  connections: [{ url: "https://company.example", user: "", ...connection }],
});

it("keeps a turn's lines with the conversation, and shows them again as the page first did", () => {
  const kept = run();
  const lines = [
    "Poppy 1.0 Session signed out · delegated ES256 Session header · Poppy-Version 1.0",
    "GET /poppy/tasks · tasks for this Session · 3 excluded",
    "Not sent · GET /api/account/orders · sign-in needed",
  ];
  keepLines(kept, at(kept), lines, 1000);
  keepLines(kept, at(kept), [], 2000);
  keepLines(kept, at(kept), ["GET /api/products · Poppy Session"], 3000);
  expect(kept.log!.map((line) => line.text)).toEqual([
    ...lines,
    "GET /api/products · Poppy Session",
  ]);
  expect(kept.log!.map((line) => line.at)).toEqual([1000, 1000, 1000, 3000]);
  // A reload lists what the page listed when the lines arrived.
  expect(shownLines(kept.log)).toEqual([
    ...lines.map((line) => logEntry(line, 1000)),
    logEntry("GET /api/products · Poppy Session", 3000),
  ]);
  // A run stored before lines were kept has none.
  expect(shownLines(undefined)).toEqual([]);
});

it("keeps only what the Inspector shows: a time and the line's words, without a query string", () => {
  const kept = run();
  keepLines(
    kept,
    at(kept),
    [
      "GET /fdx/v6/accounts?limit=25&cursor=eyJhbGciOiJFUzI1NiJ9.secret · FDX-shaped · fdx:ACCOUNT_BASIC",
      "Not sent · GET /api/payments/failed?code=one-time#frag · sign-in needed",
      `GET /api/orders · ${"x".repeat(1000)}`,
    ],
    1000,
  );
  expect(kept.log).toEqual([
    {
      at: 1000,
      text: "GET /fdx/v6/accounts · FDX-shaped · fdx:ACCOUNT_BASIC",
      signedOut: true,
    },
    {
      at: 1000,
      text: "Not sent · GET /api/payments/failed · sign-in needed",
      signedOut: true,
    },
    expect.objectContaining({ at: 1000 }),
  ]);
  // Exactly the words on screen, and no line longer than its limit.
  for (const line of kept.log!) {
    expect(Object.keys(line).sort()).toEqual(["at", "signedOut", "text"]);
    expect(line.text).toBe(logEntry(line.text).text);
    expect(line.text.length).toBeLessThanOrEqual(LOG_LIMITS.text);
  }
  expect(JSON.stringify(kept.log)).not.toMatch(/[?#]|secret|one-time/);
});

it("keeps a whole walk-through and drops the oldest lines beyond its bounds", () => {
  const many = run();
  for (let i = 0; i < LOG_LIMITS.lines + 25; i++)
    keepLines(many, at(many), [`GET /api/orders/${i} · Poppy Session`], i);
  expect(many.log).toHaveLength(LOG_LIMITS.lines);
  expect(many.log![0]!.text).toBe("GET /api/orders/25 · Poppy Session");
  expect(many.log!.at(-1)!.text).toBe(
    `GET /api/orders/${LOG_LIMITS.lines + 24} · Poppy Session`,
  );

  // Long lines: the size is bounded too, again from the oldest.
  const long = run();
  for (let i = 0; i < LOG_LIMITS.lines; i++)
    keepLines(long, at(long), [`GET /api/orders/${i} · ${"é".repeat(400)}`], i);
  const bytes = new TextEncoder().encode(JSON.stringify(long.log)).length;
  expect(bytes).toBeLessThanOrEqual(LOG_LIMITS.bytes);
  expect(long.log!.length).toBeLessThan(LOG_LIMITS.lines);
  expect(long.log!.length).toBeGreaterThan(50);
  expect(long.log!.at(-1)!.text).toMatch(
    new RegExp(`^GET /api/orders/${LOG_LIMITS.lines - 1} `),
  );
});

it("lists nothing an account's requests wrote after a sign-in that may be another account's", () => {
  const kept = run();
  keepLines(kept, at(kept), ["GET /api/products · Poppy Session"], 1000);
  at(kept).accountToken = "refresh-1";
  keepLines(
    kept,
    at(kept),
    ["GET /api/account/orders/ord_7 · Poppy Session"],
    2000,
  );
  // A request that signs the account out was still made with it.
  delete at(kept).accountToken;
  keepLines(
    kept,
    at(kept),
    ["PUT /fdx/v6/consents/grant_1/revocation · FDX consent revoked · 204"],
    3000,
    true,
  );
  keepSignedOutLines(kept);
  expect(kept.log).toEqual([
    { at: 1000, text: "GET /api/products · Poppy Session", signedOut: true },
  ]);

  // With nothing from before any account, no list is left.
  const account = run({ accountToken: "refresh-1" });
  keepLines(
    account,
    at(account),
    ["GET /api/account/orders · Poppy Session"],
    1000,
  );
  keepSignedOutLines(account);
  expect(account).not.toHaveProperty("log");
});

it("resets the lines wherever a sign-in resets the conversation", () => {
  const kept = run();
  keepLines(kept, at(kept), ["GET /api/products · Poppy Session"], 1000);
  at(kept).accountToken = "refresh-1";
  keepLines(kept, at(kept), ["GET /api/account/orders · Poppy Session"], 2000);
  keepSignedOutTranscript(kept);
  expect(kept.log!.map((line) => line.text)).toEqual([
    "GET /api/products · Poppy Session",
  ]);
});

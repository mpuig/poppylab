import { expect, it } from "vitest";
import {
  clock,
  logEntry,
  outcomeLabel,
  refusalFacts,
  refusedLine,
  traceFileName,
} from "./protocol-log";

it("types a trace line with its section, request and outcome", () => {
  const e = logEntry("GET /api/orders?token=secret#x · Poppy Session", 1000);
  expect(e).toMatchObject({
    section: "§7",
    method: "GET",
    url: "/api/orders",
    outcome: "info",
  });
  expect(JSON.stringify(e)).not.toContain("secret");
});

it("reads an outcome from the event's own words", () => {
  expect(logEntry("Approval required · nothing performed").outcome).toBe(
    "waiting",
  );
  expect(logEntry("Operation declined · revision 2").outcome).toBe("refused");
  expect(logEntry("Operation failed · revision 2").outcome).toBe("error");
  expect(logEntry("Direct Sign-In completed · PKCE").outcome).toBe("ok");
  // Starting a Session without an account is not a refusal.
  expect(
    logEntry("Poppy 1.0 Session signed out · delegated ES256").outcome,
  ).toBe("info");
});

it("formats a clock with milliseconds and a download name", () => {
  expect(clock(new Date(2026, 10, 3, 14, 5, 9, 7).getTime())).toBe(
    "14:05:09.007",
  );
  expect(
    traceFileName("https://juniper.example/", new Date("2026-11-03T10:00:00Z")),
  ).toBe("poppy-trace-juniper.example-2026-11-03.txt");
});

it("reads an outcome from the words, not from the address", () => {
  expect(
    logEntry("GET /api/payments/failed-orders · Poppy Session").outcome,
  ).toBe("info");
  expect(logEntry("GET /api/orders · request failed").outcome).toBe("error");
});

it("types a request Iris stopped before asking as a note, never as a request", () => {
  const e = logEntry(
    "Not sent · GET /api/payments/failed?cursor=x · sign-in needed",
  );
  expect(e).toMatchObject({
    text: "Not sent · GET /api/payments/failed · sign-in needed",
    outcome: "info",
  });
  expect(e).not.toHaveProperty("method");
  expect(e).not.toHaveProperty("url");
});

it("labels a request the Company refused as declined, whatever its error code says", () => {
  expect(
    refusedLine("POST", "/api/account/payments", 409, "insufficient_funds"),
  ).toBe(
    "POST /api/account/payments · refused by the Company · HTTP 409 insufficient_funds",
  );
  expect(refusedLine("GET", "/api/orders", 404)).toBe(
    "GET /api/orders · refused by the Company · HTTP 404",
  );
  for (const code of [
    "insufficient_funds",
    "transfer_limit_exceeded",
    // Words that would read as another outcome on their own.
    "payment_failed",
    "unknown_recipient",
    "internal_error",
    "approval_required",
    "consent_revoked",
    undefined,
  ]) {
    const e = logEntry(
      refusedLine("POST", "/api/account/transfers", 422, code),
    );
    expect(e).toMatchObject({
      section: "§7",
      method: "POST",
      url: "/api/account/transfers",
      outcome: "refused",
    });
    expect(outcomeLabel[e.outcome]).toBe("Declined");
  }
  // From 500 on the Company didn't refuse: the request failed.
  const failed = logEntry(refusedLine("GET", "/api/orders", 503));
  expect(failed.text).toBe("GET /api/orders · request failed · HTTP 503");
  expect(outcomeLabel[failed.outcome]).toBe("Error");
});

it("says a number the Company gave in its refusal, as money only in a currency it named", () => {
  // As Harborline's, which names no currency: the number stands alone.
  expect(
    refusalFacts({ error: "insufficient_funds", available_cents: 422000 }),
  ).toEqual(["available balance: 4,220.00"]);
  expect(
    refusalFacts({
      error: "insufficient_funds",
      available_cents: 422000,
      currency: "USD",
    }),
  ).toEqual(["available balance: $4,220.00"]);
  expect(
    refusalFacts({
      error: "recipient_limit_exceeded",
      limit_cents: 500000,
      available_cents: 0,
      currency: "EUR",
    }),
  ).toEqual(["available balance: €0.00", "limit: €5,000.00"]);
  // Anything but a three-letter code is no currency, and none is assumed.
  for (const currency of ["usd", "dollars", "$", 840, null, undefined])
    expect(refusalFacts({ limit_cents: 500000, currency })).toEqual([
      "limit: 5,000.00",
    ]);
  // Only a whole number under a key we know, never the Company's words.
  expect(
    refusalFacts({
      error: "account_inactive",
      available_cents: "plenty",
      limit_cents: 12.5,
      balance: 7,
      message: "Words of the Company's own.",
      currency: "USD",
    }),
  ).toEqual([]);
  for (const body of [undefined, null, "insufficient_funds", [1], 7])
    expect(refusalFacts(body)).toEqual([]);
});

it("reads the User's FDX consent revocation as done, and its failure as an error", () => {
  const done = logEntry(
    "PUT /fdx/v6/consents/grant_1/revocation · FDX consent revoked · 204",
  );
  expect(done).toMatchObject({
    method: "PUT",
    url: "/fdx/v6/consents/grant_1/revocation",
    outcome: "ok",
  });
  expect(
    logEntry(
      "PUT /fdx/v6/consents/grant_1/revocation · FDX consent revocation failed · 503",
    ).outcome,
  ).toBe("error");
});

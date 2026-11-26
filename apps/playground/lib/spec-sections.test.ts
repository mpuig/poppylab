import { expect, it } from "vitest";
import { logEntry } from "./protocol-log";
import { apiSection, discoverySection, traceReport } from "./spec-sections";

it("labels discovery and API steps with their Poppy 1.0 sections", () => {
  expect(discoverySection("poppy")).toBe("§3");
  expect(discoverySection("metadata")).toBe("§3.2");
  expect(discoverySection("input")).toBe("");
  expect(apiSection("GET /api/menu · Poppy Session")).toBe("§7");
  expect(
    apiSection("Poppy 1.0 Session signed out · delegated ES256 Session header"),
  ).toBe("§5.2");
  expect(
    apiSection("Loaded 19 API tools; confirmation is never a model tool"),
  ).toBe("§7");
  expect(apiSection("Approval required · nothing performed")).toBe(
    "Operations §4–6",
  );
  // Conversations (§8).
  expect(apiSection("Company Agent conversations at https://x/poppy")).toBe(
    "§8.1",
  );
  expect(apiSection("Conversation started")).toBe("§8.3");
  expect(apiSection("Conversation authorization event · scope a")).toBe(
    "§8.11",
  );
  expect(apiSection("Conversation handoff requested")).toBe("§8.9");
  expect(
    apiSection(
      "Conversation operation · approval required · nothing performed",
    ),
  ).toBe("§8.4 · Operations §4");
  // Task coverage (§9): the tasks response, and a feedback report (§9.3),
  // which is a request to the Company but not one of its APIs (§7).
  expect(
    apiSection("GET /poppy/tasks · tasks for this Session · 3 excluded"),
  ).toBe("§9");
  expect(apiSection("POST /poppy/feedback · feedback · 202 accepted")).toBe(
    "§9.3",
  );
  expect(
    apiSection("POST /poppy/feedback · feedback · 200 with an alternative"),
  ).toBe("§9.3");
  // An API of the Company's own that has the word in its path is still §7.
  expect(apiSection("POST /api/feedback · Poppy Session")).toBe("§7");
});

it("builds a plain-text report for interop issues", () => {
  const text = traceReport({
    company: "Juniper Market",
    at: new Date("2026-11-03T10:00:00Z"),
    steps: [
      {
        id: "poppy",
        label: "Discovery document",
        detail: "https://juniper.example/.well-known/poppy.json",
        status: "passed",
        durationMs: 12,
      },
    ],
    events: [
      logEntry(
        "GET /api/products · Poppy Session",
        Date.parse("2026-11-03T10:00:01.123Z"),
      ),
    ],
  });
  expect(text).toBe(
    [
      "Poppy Lab trace · Poppy 1.0 · Juniper Market",
      "Recorded 2026-11-03T10:00:00.000Z",
      "",
      "Discovery",
      "- [passed] Discovery document (§3): https://juniper.example/.well-known/poppy.json · 12 ms",
      "",
      "Session and API calls",
      "- 2026-11-03T10:00:01.123Z (§7) GET /api/products · Poppy Session [info]",
      "",
      "Recorded: time, spec section, method, address without its query, and the event's own words.",
      "Times are when this page received each event, or when the server kept it for events from before the page was loaded; one turn's events arrive together.",
      "Never recorded: headers, bodies, tokens, Session JWTs, DPoP proofs, keys, codes or sign-in values.",
    ].join("\n"),
  );
});

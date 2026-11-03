import { expect, it } from "vitest";
import { apiSection, discoverySection, traceReport } from "./spec-sections";

it("labels discovery and API steps with their PAP 0.3 sections", () => {
  expect(discoverySection("poppy")).toBe("§3");
  expect(discoverySection("metadata")).toBe("§3.2");
  expect(discoverySection("input")).toBe("");
  expect(apiSection("GET /api/menu · Poppy Session")).toBe("§7");
  expect(
    apiSection("PAP 0.3 Session signed out · delegated ES256 Session header"),
  ).toBe("§5.2");
  expect(
    apiSection("Loaded 19 API tools; confirmation is never a model tool"),
  ).toBe("§7");
  expect(apiSection("Approval required · nothing performed")).toBe(
    "Operations §4–6",
  );
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
    events: ["GET /api/products · Poppy Session"],
  });
  expect(text).toBe(
    [
      "Poppy Lab trace · PAP draft 0.3 · Juniper Market",
      "Recorded 2026-11-03T10:00:00.000Z",
      "",
      "Discovery",
      "- [passed] Discovery document (§3): https://juniper.example/.well-known/poppy.json · 12 ms",
      "",
      "Session and API calls",
      "- GET /api/products · Poppy Session (§7)",
    ].join("\n"),
  );
});

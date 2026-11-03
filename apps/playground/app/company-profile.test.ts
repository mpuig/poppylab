import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiscoveredCompany } from "@poppy-lab/pap-core";
import { CompanyProfileView } from "./company-profile";

const base = {
  requestedUrl: "https://company.example/",
  discoveryUrl: "https://company.example/.well-known/poppy.json",
  trace: [],
  discoveredAt: "2026-10-30T00:00:00Z",
};

it("shows 0.3 scopes with descriptions, hints and the hint-free warning", () => {
  const company: DiscoveredCompany = {
    ...base,
    document: {
      protocol_version: "0.3",
      organization: { name: "Company", domain: "company.example" },
      web: {},
    },
    profile: {
      version: "0.3",
      identifier: "https://auth.company.example",
      issuer: "https://auth.company.example",
      signIn: { direct: true, device: false },
      scopes: ["orders:read", "orders:write"],
      scopeDescriptions: { "orders:read": "See <b>orders</b>" },
      scopeHints: {
        "orders:read": { changes: "none", personal_data: true },
      },
      excludedTasksUrl: "https://company.example/excluded.json",
    },
    excludedTasks: [
      {
        task: "Cancel an order",
        alternative: {
          instructions: "Phone the kitchen.",
          references: [
            { type: "web", url: "https://company.example/policies" },
          ],
        },
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(CompanyProfileView, { company }),
  );
  expect(html).toContain("PAP 0.3");
  expect(html).toContain("Direct");
  expect(html).toContain("No changes · personal data");
  // A scope with no hint is never presented as safe.
  expect(html).toContain("No hints: treat as consequential");
  expect(html).toContain("https://company.example/excluded.json");
  expect(html).toContain("See &lt;b&gt;orders&lt;/b&gt;");
  expect(html).not.toContain("<b>orders</b>");
  expect(html).toContain("Not offered through PAP");
  expect(html).toContain("Cancel an order");
  expect(html).toContain("Phone the kitchen.");
});

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

it("shows 1.0 scopes with descriptions, hints, PAR, extensions and the tasks endpoint", () => {
  const company: DiscoveredCompany = {
    ...base,
    document: {
      protocol_version: "1.0",
      organization: { name: "Company", domain: "company.example" },
      web: {},
    },
    profile: {
      version: "1.0",
      identifier: "https://auth.company.example",
      issuer: "https://auth.company.example",
      signIn: { direct: true, device: false },
      pushedAuthorization: {
        endpoint: "https://auth.company.example/par",
        required: false,
      },
      scopes: ["orders:read", "orders:write"],
      scopeDescriptions: { "orders:read": "See <b>orders</b>" },
      scopeHints: {
        "orders:read": { changes: "none", personal_data: true },
      },
      tasksEndpoint: "https://company.example/poppy/tasks",
      operations: true,
    },
  };
  const html = renderToStaticMarkup(
    createElement(CompanyProfileView, { company }),
  );
  expect(html).toContain("PAP 1.0");
  expect(html).toContain("Direct · PAR offered");
  expect(html).toContain("Operations v3");
  expect(html).toContain("No changes · personal data");
  // A scope with no hint is never presented as safe.
  expect(html).toContain("No hints: treat as consequential");
  expect(html).toContain("https://company.example/poppy/tasks");
  expect(html).toContain("See &lt;b&gt;orders&lt;/b&gt;");
  expect(html).not.toContain("<b>orders</b>");
});

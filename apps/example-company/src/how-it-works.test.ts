import { expect, it } from "vitest";
import { juniperApp } from "./test-app.js";

const text = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

it("explains on How it works what its own endpoints serve, not a copy of it", async () => {
  const { app } = juniperApp({ fetchJson: async () => ({}) });
  const page = await app.request("/how-it-works");
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  );
  const html = (await page.text()).replace(/<wbr>/g, "");
  // Step 1: every part of the discovery document, as the well-known address serves it.
  const discovery = (await (
    await app.request("/.well-known/poppy.json")
  ).json()) as Record<string, unknown>;
  for (const key of Object.keys(discovery))
    expect(html).toContain(`<span class="k">${text(`"${key}"`)}</span>`);
  const { scopes } = discovery.auth as { scopes: Record<string, string> };
  for (const description of Object.values(scopes))
    expect(html).toContain(text(JSON.stringify(description)));
  // Step 2: every operation of the API, and the ones that propose in the list that waits.
  const api = (await (await app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, { "x-poppy-proposal"?: boolean }>>;
  };
  const operations = Object.entries(api.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      where: `${method.toUpperCase()} ${path}`,
      proposal: operation["x-poppy-proposal"] === true,
    })),
  );
  expect(operations.length).toBeGreaterThan(0);
  for (const { where } of operations) expect(html).toContain(text(where));
  const waits = /<div class="zone waits">.*?<\/ul>/.exec(html)![0];
  expect(waits.match(/<li>/g)).toHaveLength(
    operations.filter((o) => o.proposal).length,
  );
  for (const { where, proposal } of operations)
    expect(waits.includes(`<code>${text(where)}</code>`)).toBe(proposal);
  // Step 3: Elena's seeded recurring delivery, at the shelf's prices.
  expect(html).toContain(
    '<dt>Day</dt><dd><s>Thursday</s> → <span class="to">Saturday</span></dd>',
  );
  expect(html).toContain("<dt>1 × Cara cara oranges</dt><dd>$4.50</dd>");
  expect(html).toContain("<dt>1 × Juniper house coffee</dt><dd>$14.00</dd>");
  // The questions name what the document rules out.
  expect(html).toContain(
    "An agent can&#39;t get a refund, cancel a placed order or delete your account.",
  );
  expect(html).not.toContain("<script");
  // The page is in the menu of every page, and the home leads to it.
  expect(html).toContain(
    '<a href="/how-it-works" aria-current="page">How it works</a>',
  );
  const home = await (await app.request("/")).text();
  expect(home).toContain('<a href="/how-it-works">How it works</a>');
  expect(home).toContain(
    '<a href="/how-it-works">See each step as your agent sees it</a>',
  );
});

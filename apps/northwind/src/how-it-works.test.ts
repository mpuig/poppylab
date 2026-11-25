import { expect, it } from "vitest";
import { lab, setup } from "./test-harness.ts";

const text = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

it("explains on How it works what its own endpoints serve, not a copy of it", async () => {
  await setup();
  const page = await lab.app.request("/how-it-works");
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain(
    "font-src https://fonts.gstatic.com",
  );
  const html = (await page.text()).replace(/<wbr>/g, "");
  // Step 1: every part of the discovery document, as the well-known address serves it.
  const discovery = (await (
    await lab.app.request("/.well-known/poppy.json")
  ).json()) as Record<string, unknown>;
  for (const key of Object.keys(discovery))
    expect(html).toContain(`<span class="k">${text(`"${key}"`)}</span>`);
  const { scopes } = discovery.auth as { scopes: Record<string, string> };
  for (const description of Object.values(scopes))
    expect(html).toContain(text(JSON.stringify(description)));
  // Step 2: every operation of the API, and every one that proposes marked as waiting.
  const api = (await (await lab.app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, { "x-poppy-proposal"?: boolean }>>;
  };
  const operations = Object.entries(api.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      where: `${method.toUpperCase()} ${path}`,
      proposal: operation["x-poppy-proposal"] === true,
    })),
  );
  expect(operations.length).toBeGreaterThan(0);
  for (const { where, proposal } of operations)
    expect(
      html.includes(
        `<code>${text(where)}</code></span><span class="status">your approval</span>`,
      ),
    ).toBe(proposal);
  for (const { where } of operations) expect(html).toContain(text(where));
  // Step 3: Elena's seeded booking and the offer the API would price.
  expect(html).toContain(
    "<strong>NA 118</strong><span>18 May 2027 · 13:10</span>",
  );
  expect(html).toContain("booking NW7K2P · Elena Maren");
  expect(html).toContain(
    '<dt>Cabin</dt><dd><s>Gale Flex</s> → <span class="to">Aurora Business</span></dd>',
  );
  expect(html).toContain("<dt>To pay</dt><dd>$248.00</dd>");
  // The questions list what the document rules out.
  const tasks = (await (await lab.app.request("/poppy/tasks")).json()) as {
    excluded_tasks: Array<{ task: string }>;
  };
  expect(tasks.excluded_tasks.length).toBeGreaterThan(0);
  for (const { task } of tasks.excluded_tasks)
    expect(html).toContain(`<li>${text(task)}</li>`);
  expect(html).not.toContain("<script");
  // The page is in the menu of every page, and the home leads to it.
  expect(html).toContain(
    '<a href="/how-it-works" aria-current="page">How it works</a>',
  );
  const home = await (await lab.app.request("/")).text();
  expect(home).toContain('<a href="/how-it-works">How it works</a>');
  expect(home).toContain(
    '<a href="/how-it-works">See each step as your agent sees it</a>',
  );
});

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
  // Step 1: every part of the discovery document, with the two long lists said in words.
  const discovery = (await (
    await lab.app.request("/.well-known/poppy.json")
  ).json()) as Record<string, unknown>;
  for (const key of Object.keys(discovery))
    expect(html).toContain(`<span class="k">${text(`"${key}"`)}</span>`);
  const { issuer, scopes } = discovery.auth as {
    issuer: string;
    scopes: Record<string, string>;
  };
  expect(html).toContain(text(JSON.stringify(issuer)));
  expect(html).toContain(
    `<i class="fold">{ ${Object.keys(scopes).length} permissions, each described in words }</i>`,
  );
  expect(html).toContain(
    '<a href="/.well-known/poppy.json">the whole file</a>',
  );
  for (const api of discovery.apis as Array<{ url: string }>)
    expect(html).toContain(text(JSON.stringify(api.url)));
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
        `<code>${text(where)}</code></span><span class="status frozen">your approval</span>`,
      ),
    ).toBe(proposal);
  for (const { where } of operations) expect(html).toContain(text(where));
  // Step 3: Elena's seeded accounts, before and after the transfer.
  expect(html).toContain("<strong>Transfer $500.00</strong>");
  expect(html).toContain(
    '−$500.00<span class="after">$12,845.00 → $12,345.00</span>',
  );
  expect(html).toContain(
    '$500.00<span class="after">$42,500.00 → $43,000.00</span>',
  );
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

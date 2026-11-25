import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { lab, setup } from "./test-harness.ts";
import { customers } from "./data.ts";
import { billFor, billsFor } from "./billing.ts";

const text = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Hundred-thousandths of USD as the page prints them. */
const money = (amount: number) =>
  `$${(Math.round(amount / 1000) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T23:30:00Z"));
});
afterAll(() => vi.useRealTimers());

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
  expect(html).toContain(text(JSON.stringify("poppylab.dev/espi")));
  // Step 2: every operation of the API, and the one that proposes marked as waiting.
  const api = (await (await lab.app.request("/openapi.json")).json()) as {
    paths: Record<string, Record<string, { "x-poppy-proposal"?: boolean }>>;
  };
  const operations = Object.entries(api.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      where: `${method.toUpperCase()} ${path}`,
      proposal: operation["x-poppy-proposal"] === true,
    })),
  );
  expect(operations.some((o) => o.proposal)).toBe(true);
  for (const { where, proposal } of operations)
    expect(
      html.includes(
        `<code>${text(where)}</code></span><span class="tag yours">your approval</span>`,
      ),
    ).toBe(proposal);
  // Step 3: Elena's EV charger, its last closed bill priced on both plans.
  const ev = customers[0]!.meters.find((m) => m.id === "UP-E2")!;
  const history = [{ plan: ev.plan, from: 0 }];
  const last = billsFor(ev, history, Date.now() / 1000).at(-1)!;
  const flat = billFor(ev, history, last.start, last.end, "flat");
  expect(last.id).toBe("2026-10");
  expect(html).toContain("<strong>Switch to Flat rate</strong>");
  expect(html).toContain("From December 1, 2026, the next bill cycle");
  expect(html).toContain(
    `<small>${(last.deliveredWh / 1000).toFixed(1)} kWh on Time of use</small>`,
  );
  expect(html).toContain(`${money(last.total)}</span>`);
  expect(html).toContain(`${money(flat.total)}<span class="after">`);
  // The questions list what the document rules out, and say what ESPI is.
  const tasks = (await (await lab.app.request("/poppy/tasks")).json()) as {
    excluded_tasks: Array<{ task: string }>;
  };
  expect(tasks.excluded_tasks.length).toBeGreaterThan(0);
  for (const { task } of tasks.excluded_tasks)
    expect(html).toContain(`<li>${text(task)}</li>`);
  expect(html).toContain(
    "ESPI-shaped (modelled on NAESB REQ.21 ESPI), not certified",
  );
  expect(html).not.toMatch(/green button/i);
  expect(html).not.toContain("<script");
  // The page is in the menu of every page, and the home leads to it.
  expect(html).toContain(
    '<a href="/how-it-works" aria-current="page">How it works</a>',
  );
  const home = await (await lab.app.request("/")).text();
  expect(home).toContain('<a href="/how-it-works">How it works</a>');
  expect(home).toContain("See each step as your agent sees it");
});

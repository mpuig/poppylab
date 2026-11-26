/**
 * The skills Juniper publishes (PAP 1.0 §9.4): listed in the tasks
 * response, served with the bytes their digests name, and written about
 * operations and permissions Juniper really has.
 */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { juniperApp } from "./test-app.js";

const origin = "https://juniper.example";
/** Each skill, with the operations and permissions its text names. */
const published = {
  "move-recurring-delivery": {
    operations: [
      "my_deliveries",
      "delivery_info",
      "propose_delivery_change",
      "propose_delivery_item_quantity",
    ],
    scopes: ["poppy:read", "poppy:write"],
  },
  "open-support-case": {
    operations: [
      "search_help",
      "my_orders",
      "propose_support_case",
      "my_support_cases",
      "support_case_details",
    ],
    scopes: ["poppy:read", "poppy:write"],
  },
};
type Entry = {
  name: string;
  description: string;
  type: string;
  url: string;
  digest: string;
};
type Poppy = {
  tasks: { endpoint: string };
  auth: { scopes: Record<string, string> };
};
type Tasks = { skill_index: { $schema: string; skills: Entry[] } };
type OpenApi = {
  paths: Record<string, Record<string, { operationId: string }>>;
};

it("publishes its skills with the digest of the file served, naming operations and permissions it has", async () => {
  const { app } = juniperApp({ origin, fetchJson: async () => ({}) });
  const json = async <T>(path: string) =>
    (await app.request(path)).json() as Promise<T>;
  const poppy = await json<Poppy>("/.well-known/poppy.json");
  const tasks = await json<Tasks>(new URL(poppy.tasks.endpoint).pathname);
  expect(tasks.skill_index.$schema).toBe(
    "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  );
  const entries = tasks.skill_index.skills;
  expect(entries.map((entry) => entry.name)).toEqual(Object.keys(published));
  const { paths } = await json<OpenApi>("/openapi.json");
  const operations = Object.values(paths).flatMap((path) =>
    Object.values(path).map((operation) => operation.operationId),
  );
  for (const entry of entries) {
    expect(entry.type).toBe("skill-md");
    // §9.4: the artifact's URL is resolved against `tasks.endpoint`.
    const url = new URL(entry.url, poppy.tasks.endpoint);
    expect(url.origin).toBe(origin);
    const served = await app.request(url.pathname);
    expect(served.status).toBe(200);
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      entry.digest,
    );
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith(`---\nname: ${entry.name}\n`)).toBe(true);
    // What the skill puts in code spans: operations, permissions, fields.
    const named = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
    const expected = published[entry.name as keyof typeof published];
    for (const operation of expected.operations) {
      expect(named).toContain(operation);
      expect(operations).toContain(operation);
    }
    // Every permission it names is one the sign-in offers.
    const scopes = [...new Set(named.filter((word) => /^\w+:\w+$/.test(word)))];
    expect(scopes.sort()).toEqual([...expected.scopes].sort());
    expect(Object.keys(poppy.auth.scopes)).toEqual(
      expect.arrayContaining(scopes),
    );
  }
});

it("lists its skills on the page for agents, each linked to the file the index names", async () => {
  const { app } = juniperApp({ origin, fetchJson: async () => ({}) });
  const json = async <T>(path: string) =>
    (await app.request(path)).json() as Promise<T>;
  const html = await (await app.request("/for-agents")).text();
  expect(html).toContain(
    `GET ${origin}/poppy/tasks · excluded tasks, skills, feedback endpoint`,
  );
  // The page escapes its text; read it as a browser shows it.
  const shown = html.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(Number(code)),
  );
  const { skill_index } = await json<Tasks>("/poppy/tasks");
  expect(skill_index.skills.length).toBeGreaterThan(0);
  for (const entry of skill_index.skills) {
    expect(shown).toContain(entry.description);
    const href = html.match(
      new RegExp(`<a href="([^"]+)"><code>${entry.name}</code></a>`),
    )?.[1];
    expect(href).toBeDefined();
    const served = await app.request(
      new URL(href!, `${origin}/for-agents`).pathname,
    );
    expect(served.status).toBe(200);
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      entry.digest,
    );
  }
});

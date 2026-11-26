/**
 * The skill Harborline publishes (PAP 1.0 §9.4): listed in the tasks
 * response, served with the bytes its digest names, and written about
 * operations and permissions Harborline really has.
 */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { lab, origin, setup } from "./test-harness.ts";

/** Each skill, with the operations and permissions its text names. */
const published = {
  "pay-saved-recipient": {
    operations: ["accounts", "recipients", "request_payment"],
    scopes: ["accounts:read", "recipients:read", "payments:request"],
  },
};
type Entry = { name: string; type: string; url: string; digest: string };
type Poppy = {
  tasks: { endpoint: string };
  auth: { scopes: Record<string, string> };
};
type Tasks = { skill_index: { $schema: string; skills: Entry[] } };
type OpenApi = {
  paths: Record<string, Record<string, { operationId: string }>>;
};
const json = async <T>(path: string) =>
  (await lab.app.request(path)).json() as Promise<T>;

it("publishes its skills with the digest of the file served, naming operations and permissions it has", async () => {
  await setup();
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
    const served = await lab.app.request(url.pathname);
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

/**
 * §9.4 at the gateway: a Company's skills in the tasks response, in the
 * form of the pinned Agent Skills discovery proposal, and each `SKILL.md`
 * served with the bytes its digest was computed from.
 */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { skillRowsHtml } from "./skills.ts";
import { origin, setup } from "./test-company.ts";
import type { SkillDefinition } from "./types.ts";

const TASKS = `${origin}/poppy/tasks`;
const skills: SkillDefinition[] = [
  {
    name: "move-a-thing",
    description: 'Move a thing: "quoted", with a colon and the customer\'s é.',
    body: "\n# Move a thing\n\nCall `move_thing`, then show the terms.\n\n",
  },
  {
    name: "count-things",
    description: "Count the things on the account.",
    body: "# Count things\n\nCall `things`.",
  },
];
type Entry = {
  name: string;
  description: string;
  type: string;
  url: string;
  digest: string;
};
type Tasks = {
  excluded_tasks: unknown[];
  skill_index?: { $schema: string; skills: Entry[] };
  feedback: { endpoint: string };
};
const sha256 = (bytes: ArrayBuffer) =>
  `sha256:${createHash("sha256").update(new Uint8Array(bytes)).digest("hex")}`;

it("lists no skill index for a Company that publishes no skills", async () => {
  const x = await setup();
  const tasks = (await (await x.app.request("/poppy/tasks")).json()) as Tasks;
  expect(tasks).toEqual({
    excluded_tasks: [],
    feedback: { endpoint: `${origin}/poppy/feedback` },
  });
  expect(
    (await x.app.request("/poppy/skills/move-a-thing/SKILL.md")).status,
  ).toBe(404);
});

it("lists the skills in the pinned index format, cached like the rest of the tasks response", async () => {
  const x = await setup({}, { skills });
  const response = await x.app.request("/poppy/tasks");
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  const tasks = (await response.json()) as Tasks;
  const index = tasks.skill_index!;
  // What the kit's schema for the pinned revision requires: the schema
  // identifier, `skills`, and five non-empty strings in every entry.
  expect(Object.keys(index)).toEqual(["$schema", "skills"]);
  expect(index.$schema).toBe(
    "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  );
  expect(index.skills).toHaveLength(2);
  for (const entry of index.skills) {
    expect(Object.keys(entry).sort()).toEqual([
      "description",
      "digest",
      "name",
      "type",
      "url",
    ]);
    expect(entry.type).toBe("skill-md");
    expect(entry.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // A reference without a scheme, so it is valid at any origin.
    expect(entry.url).toMatch(/^(?![A-Za-z][A-Za-z0-9+.-]*:)[^\s\\]+$/);
    // §9.4: resolved against `tasks.endpoint`, it is on the Company's origin.
    expect(new URL(entry.url, TASKS).href).toBe(
      `${origin}/poppy/skills/${entry.name}/SKILL.md`,
    );
  }
  expect(index.skills.map((entry) => entry.name)).toEqual([
    "move-a-thing",
    "count-things",
  ]);
  expect(index.skills[0]!.description).toBe(skills[0]!.description);
});

it("serves each SKILL.md with the bytes its digest names, to GET and HEAD, with no Session", async () => {
  const x = await setup({}, { skills });
  const { skill_index } = (await (
    await x.app.request("/poppy/tasks")
  ).json()) as Tasks;
  for (const entry of skill_index!.skills) {
    const path = new URL(entry.url, TASKS).pathname;
    const served = await x.app.request(path);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(served.headers.get("cache-control")).toBe("public, max-age=300");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = await served.arrayBuffer();
    // Fails when the bytes served and the digest listed disagree.
    expect(sha256(bytes)).toBe(entry.digest);
    // The frontmatter repeats the entry's name and description.
    const file = new TextDecoder().decode(bytes);
    const frontmatter = /^---\nname: (.+)\ndescription: (.+)\n---\n\n/.exec(
      file,
    )!;
    expect(frontmatter[1]).toBe(entry.name);
    expect(JSON.parse(frontmatter[2]!)).toBe(entry.description);
    expect(file.endsWith("\n")).toBe(true);
    expect(file.endsWith("\n\n")).toBe(false);
    const head = await x.app.request(path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(await head.text()).toBe("");
  }
  const first = await (
    await x.app.request("/poppy/skills/move-a-thing/SKILL.md")
  ).text();
  expect(first).toContain("# Move a thing\n\nCall `move_thing`");
});

it("writes the skills as rows for a page, each name linked to the file it serves, with every value escaped", async () => {
  const x = await setup({}, { skills });
  const rows = skillRowsHtml([
    skills[1]!,
    { ...skills[0]!, description: " Move <a thing> & the customer's. " },
  ]);
  expect(rows).toBe(
    '<tr><th scope="row"><a href="/poppy/skills/count-things/SKILL.md"><code>count-things</code></a></th><td>Count the things on the account.</td></tr>' +
      '<tr><th scope="row"><a href="/poppy/skills/move-a-thing/SKILL.md"><code>move-a-thing</code></a></th><td>Move &#60;a thing&#62; &#38; the customer&#39;s.</td></tr>',
  );
  // Each link is the path the index gives, and the gateway serves it.
  const { skill_index } = (await (
    await x.app.request("/poppy/tasks")
  ).json()) as Tasks;
  for (const entry of skill_index!.skills) {
    expect(rows).toContain(`<a href="${entry.url}">`);
    expect((await x.app.request(entry.url)).status).toBe(200);
  }
});

it("answers 404 for a skill or a file that doesn't exist", async () => {
  // Also where each visitor has their own copy of the business data.
  for (const isolation of ["shared", "visitor"] as const) {
    const x = await setup({ isolation }, { skills });
    for (const path of [
      "/poppy/skills/no-such-skill/SKILL.md",
      "/poppy/skills/move-a-thing/OTHER.md",
      "/poppy/skills/move-a-thing",
      "/poppy/skills",
    ])
      expect((await x.app.request(path)).status).toBe(404);
    // The file itself is public and cached: it names no visitor.
    const served = await x.app.request("/poppy/skills/move-a-thing/SKILL.md");
    expect(served.status).toBe(200);
    expect(served.headers.get("set-cookie")).toBeNull();
  }
});

it("refuses a skill whose name or description the format doesn't allow", async () => {
  const one = (skill: Partial<SkillDefinition>) => [
    { ...skills[0]!, ...skill },
  ];
  for (const bad of [
    one({ name: "Move-Thing" }),
    one({ name: "move--thing" }),
    one({ name: "-move" }),
    one({ name: "a".repeat(65) }),
    one({ description: " " }),
    one({ description: "Two\nlines" }),
    one({ description: "d".repeat(1025) }),
    one({ body: " \n" }),
    [skills[0]!, skills[0]!],
  ])
    await expect(setup({}, { skills: bad })).rejects.toThrow(
      "Invalid skill definition",
    );
});

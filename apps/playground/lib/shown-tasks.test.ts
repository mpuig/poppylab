import { expect, it } from "vitest";
import { shownSkills, shownTasks } from "./shown-tasks";

const tasks = {
  sid: "sid_1",
  value: {
    excludedTasks: [
      { task: "Cancel an order by phone" },
      {
        task: "Change the delivery address",
        alternative: {
          instructions: "Use the website's account page.",
          references: [
            { type: "web" as const, url: "https://company.example/account" },
          ],
        },
      },
      {
        task: "Close the account",
        alternative: { instructions: "x".repeat(900), references: [] },
      },
    ],
    skills: [],
  },
};

it("lists the tasks the current Session read, with each alternative's words cut short", () => {
  const shown = shownTasks({ sessionId: "sid_1", tasks });
  expect(shown).toEqual([
    { task: "Cancel an order by phone" },
    {
      task: "Change the delivery address",
      alternative: "Use the website's account page.",
    },
    { task: "Close the account", alternative: expect.any(String) },
  ]);
  expect(shown[2]!.alternative).toHaveLength(300);
  expect(shown[2]!.alternative!.endsWith("…")).toBe(true);
});

it("lists none before a Session has read them, or for another Session's", () => {
  expect(shownTasks({ sessionId: "sid_1" })).toEqual([]);
  expect(shownTasks({ sessionId: "sid_2", tasks })).toEqual([]);
  expect(shownTasks({ tasks })).toEqual([]);
});

const digest = `sha256:${"0f".repeat(32)}`;
const published = {
  sid: "sid_1",
  value: {
    excludedTasks: [],
    skills: [
      {
        name: "change-order",
        description: "Change a scheduled order.",
        type: "skill-md" as const,
        url: "https://company.example/poppy/skills/change-order/SKILL.md",
        digest,
      },
      {
        name: "long-one",
        description: "y".repeat(900),
        type: "archive" as const,
        url: "https://cdn.example/skills/long-one.tar.gz",
        digest,
      },
    ],
  },
};

it("lists the skills the current Session read, with the host that serves each file (§9.4)", () => {
  const shown = shownSkills({ sessionId: "sid_1", tasks: published });
  expect(shown).toEqual([
    {
      name: "change-order",
      description: "Change a scheduled order.",
      url: "https://company.example/poppy/skills/change-order/SKILL.md",
      host: "company.example",
    },
    {
      name: "long-one",
      description: expect.any(String),
      url: "https://cdn.example/skills/long-one.tar.gz",
      host: "cdn.example",
    },
  ]);
  expect(shown[1]!.description).toHaveLength(300);
  expect(shownSkills({ sessionId: "sid_2", tasks: published })).toEqual([]);
  expect(shownSkills({ sessionId: "sid_1" })).toEqual([]);
  expect(shownSkills({ sessionId: "sid_1", tasks })).toEqual([]);
});

it("lists no skills for a run stored when only their number was kept", () => {
  const stored = {
    sid: "sid_1",
    value: { excludedTasks: [], skills: 2 },
  } as unknown as typeof published;
  expect(shownSkills({ sessionId: "sid_1", tasks: stored })).toEqual([]);
});

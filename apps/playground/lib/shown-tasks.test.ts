import { expect, it } from "vitest";
import { shownTasks } from "./shown-tasks";

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
    skills: 0,
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

import { expect, it } from "vitest";
import { agentStep } from "./agent-steps";
import { logEntry } from "./protocol-log";

const step = (line: string) => agentStep(logEntry(line, 0));

it("describes a read and a change in plain words with their access", () => {
  expect(step("GET /api/orders?token=x · Poppy Session")).toEqual({
    text: "Read /api/orders",
    how: "API",
    access: "view",
    state: "done",
  });
  expect(step("POST /api/basket · Poppy Session")).toMatchObject({
    text: "Sent a request to /api/basket",
    access: "view and change",
  });
});

it("never says Iris read or sent a request it stopped before asking", () => {
  expect(step("Not sent · GET /api/account/orders · sign-in needed")).toEqual({
    text: "Did not ask for /api/account/orders (sign-in needed); nothing was sent",
    how: "API",
    access: null,
    state: "done",
  });
  expect(
    step(
      "Not sent · POST /api/account/delivery-change · permission not granted",
    ).text,
  ).toBe(
    "Did not ask for /api/account/delivery-change (permission not granted); nothing was sent",
  );
});

it("says an approval is waiting and nothing was done", () => {
  expect(step("Approval required · nothing performed")).toMatchObject({
    state: "waiting",
    access: "view and change",
  });
});

it("names Company conversations and setup, and keeps unknown events as written", () => {
  expect(step("Conversation started").how).toBe("Company's agent");
  expect(
    step("Loaded 19 API tools; confirmation is never a model tool").text,
  ).toBe("Found 19 API tools at the Company");
  expect(step("Something new happened").text).toBe("Something new happened");
});

it("names the address a request went to, without its query", () => {
  expect(step("GET /poppy/tasks?cursor=abc · Poppy Session").text).toBe(
    "Read /poppy/tasks",
  );
});

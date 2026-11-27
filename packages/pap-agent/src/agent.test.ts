import { afterEach, expect, it, vi } from "vitest";
import { agentName, configureAgent, DEFAULT_AGENT_NAME } from "./agent";
import { connectCommand } from "./connect-command";
import { notSentReply } from "./demo-text";
import { labCompanies } from "./lab-companies";
import { outcome } from "./operation-presentation";

const global = globalThis as { papAgentProfile?: unknown };
afterEach(() => {
  delete global.papAgentProfile;
  vi.unstubAllEnvs();
});

it("says what the channel calls its agent, in the agent's own sentences", () => {
  configureAgent({ name: "Mira" });
  expect(agentName()).toBe("Mira");
  expect(
    notSentReply(
      { sent: false, error: "sign_in_required" },
      "Lantern",
      () => true,
    ),
  ).toBe(
    "This needs your account at Lantern, and you are not signed in. Mira didn't send this request to the Company. Press “Sign in to Lantern”, then ask again.",
  );
  // Its name before a request changes nothing about it, and another
  // agent's name is no part of a command.
  const lab = labCompanies("http://localhost:3000");
  const known = { connected: [], lab };
  expect(connectCommand("Mira, connect with Lantern", known)).toMatchObject({
    verb: "connect",
    companies: [{ name: "Lantern Noodle Bar" }],
  });
  expect(connectCommand("Iris, connect with Lantern", known)).toBeUndefined();
});

it("takes the name a build gives when no channel configured one, and a plain one otherwise", () => {
  vi.stubEnv("AGENT_NAME", "Iris");
  expect(agentName()).toBe("Iris");
  expect(
    outcome(
      {
        operation_id: "op_1",
        revision: "r1",
        terms: {},
        expires_at: new Date(0).toISOString(),
        state: "succeeded",
        approvedBy: { approver: "agent" },
      } as Parameters<typeof outcome>[0],
      "succeeded",
      "Harborline Bank",
    ),
  ).toMatchObject({ note: expect.stringContaining("Approved by Iris") });
  vi.stubEnv("AGENT_NAME", undefined);
  expect(agentName()).toBe(DEFAULT_AGENT_NAME);
});

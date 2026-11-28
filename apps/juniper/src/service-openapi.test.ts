import { it, expect, vi } from "vitest";
import { openApiTools } from "@poppy-lab/pap-client";
import { agentRequests } from "./agent.js";
import {
  CASE_MESSAGE_MAX_LENGTH,
  servicePaths,
  TOPIC_GUIDE,
} from "./service-openapi.js";
it("advertises service reads and proposal-only support tools with declared permissions", async () => {
  const request = vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ ok: true });
  const options = {
    allowProposals: true,
    blockedPaths: ["/api/account/operations", "/site"],
    trace: vi.fn(),
    request,
  };
  const tools = openApiTools(
    { paths: servicePaths },
    "http://juniper.localhost:4100/openapi.json",
    options,
  );
  expect(Object.keys(tools)).toHaveLength(8);
  await tools.propose_support_case!.execute({
    subject: "Consulta",
    topic: "delivery",
    message: "Datos ficticios",
  });
  expect(request).toHaveBeenLastCalledWith(
    "http://juniper.localhost:4100/api/account/case-proposal",
    "POST",
    { subject: "Consulta", topic: "delivery", message: "Datos ficticios" },
    ["poppy:read", "poppy:write"],
  );
  const profile = {
    version: 1,
    name: "Elena Demo",
    email: "elena@example.invalid",
    address: "Fictional address",
  };
  await tools.propose_profile_change!.execute(profile);
  expect(request).toHaveBeenLastCalledWith(
    "http://juniper.localhost:4100/api/account/profile-proposal",
    "POST",
    profile,
    ["poppy:read", "poppy:write"],
  );
  await expect(
    tools.propose_profile_change!.execute({ ...profile, version: "1" }),
  ).rejects.toThrow();
  await tools.search_help!.execute();
  expect(request).toHaveBeenLastCalledWith(
    "http://juniper.localhost:4100/api/faq",
    "GET",
    undefined,
    [],
  );
  expect(
    Object.keys(
      openApiTools(
        { paths: servicePaths },
        "http://juniper.localhost:4100/openapi.json",
        { ...options, allowProposals: false },
      ),
    ),
  ).toHaveLength(5);
});

it("says what each support case topic covers, to the agent's model and at Juniper's agent", () => {
  const tools = openApiTools(
    { paths: servicePaths },
    "http://juniper.localhost:4100/openapi.json",
    {
      allowProposals: true,
      blockedPaths: [],
      trace: vi.fn(),
      request: vi.fn(),
    },
  );
  const topic = (
    tools.propose_support_case!.schema.properties as Record<
      string,
      { enum?: string[]; description?: string }
    >
  ).topic!;
  expect(topic.enum).toEqual(["delivery", "billing", "profile", "other"]);
  // A wrong item is a delivery's, even when a refund is wanted.
  expect(topic.description).toBe(TOPIC_GUIDE);
  expect(TOPIC_GUIDE).toMatch(/^delivery: [^.]*wrong[^.]*refund/);
  expect(TOPIC_GUIDE.length).toBeLessThanOrEqual(300);
  const report = agentRequests.find((r) => r.request === "report_problem")!;
  expect(report.fields.topic).toBe(
    `delivery | billing | profile | other. ${TOPIC_GUIDE}`,
  );
  const message = (
    tools.propose_support_case!.schema.properties as Record<
      string,
      { maxLength?: number }
    >
  ).message!;
  expect(CASE_MESSAGE_MAX_LENGTH).toBe(2000);
  expect(message.maxLength).toBe(CASE_MESSAGE_MAX_LENGTH);
  expect(report.fields.message).toContain(String(CASE_MESSAGE_MAX_LENGTH));
});

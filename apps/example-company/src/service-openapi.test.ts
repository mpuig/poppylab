import { it, expect, vi } from "vitest";
import { openApiTools } from "@poppy-lab/pap-client";
import { servicePaths } from "./service-openapi.js";
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
    name: "Alex Demo",
    email: "alex@example.invalid",
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

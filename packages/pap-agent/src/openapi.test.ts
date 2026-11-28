import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  accountOperations,
  conversationOperations,
  type ApiOperation,
} from "./api-contract/index.ts";
import { API_PREFIX, v1 } from "./api-http";
import { openApiDocument } from "./openapi";

const emptyCookies = {
  get: () => undefined,
  set: () => {},
};

it("keeps openapi.json, the file a client app is built from, as the API describes itself", async () => {
  // `vitest run -u` writes it again after the API changes.
  await expect(
    `${JSON.stringify(openApiDocument(), null, 2)}\n`,
  ).toMatchFileSnapshot("../openapi.json");
});

it("serves the committed openapi.json directly without importing the OpenAPI generator", async () => {
  const apiHttpSource = readFileSync(
    new URL("./api-http.ts", import.meta.url),
    "utf8",
  );
  expect(apiHttpSource).toContain("../openapi.json");
  expect(apiHttpSource).not.toMatch(/from\s+["']\.\/openapi(?:\.ts)?["']/);
  expect(apiHttpSource).not.toContain("openApiDocument(");
  expect(apiHttpSource).not.toContain("toJSONSchema");

  const response = await v1(
    new Request("https://agent.example/api/v1/openapi.json"),
    emptyCookies,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual(openApiDocument());
});

it("derives path parameters and request bodies for every api-contract operation", () => {
  const document = openApiDocument();
  const operations: readonly ApiOperation[] = [
    ...Object.values(conversationOperations),
    ...Object.values(accountOperations),
  ];

  for (const contract of operations) {
    const pathItem = document.paths[
      `${API_PREFIX}${contract.path}` as keyof typeof document.paths
    ] as Record<
      string,
      {
        operationId: string;
        parameters?: Array<{ name: string; in: string; required: boolean }>;
        requestBody?: { required: boolean };
      }
    >;
    expect(pathItem, contract.operationId).toBeDefined();
    const spec = pathItem[contract.method.toLowerCase()];
    expect(spec, contract.operationId).toBeDefined();
    expect(spec!.operationId).toBe(contract.operationId);

    if (contract.parameters) {
      const expectedNames = Object.keys(
        (
          z.toJSONSchema(contract.parameters, {
            io: "input",
            unrepresentable: "any",
          }) as { properties: Record<string, unknown> }
        ).properties,
      );
      expect(
        spec!.parameters?.map((param) => param.name),
        contract.operationId,
      ).toEqual(expectedNames);
    } else {
      expect(spec!.parameters, contract.operationId).toBeUndefined();
    }

    if (contract.body) {
      expect(spec!.requestBody?.required, contract.operationId).toBe(true);
    } else {
      expect(spec!.requestBody, contract.operationId).toBeUndefined();
    }
  }
});

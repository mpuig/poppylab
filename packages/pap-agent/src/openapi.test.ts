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

it("documents every request parameter and property in the generated OpenAPI document", () => {
  const document = openApiDocument();
  const schemas = document.components.schemas as Record<
    string,
    Record<string, unknown>
  >;
  const undocumented: string[] = [];
  const visitedRefs = new Set<string>();

  const hasDescription = (node: Record<string, unknown>) =>
    typeof node.description === "string" && node.description.trim().length > 0;

  const walk = (schema: unknown, location: string) => {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
    const node = schema as Record<string, unknown>;
    if (typeof node.$ref === "string") {
      const name = node.$ref.split("/").at(-1)!;
      if (visitedRefs.has(name)) return;
      visitedRefs.add(name);
      walk(schemas[name], `components.schemas.${name}`);
      return;
    }
    if (
      node.properties &&
      typeof node.properties === "object" &&
      !Array.isArray(node.properties)
    ) {
      for (const [name, child] of Object.entries(
        node.properties as Record<string, Record<string, unknown>>,
      )) {
        const childLocation = `${location}.${name}`;
        if (!hasDescription(child)) undocumented.push(childLocation);
        walk(child, childLocation);
      }
    }
    if (node.items) walk(node.items, `${location}[]`);
    for (const key of ["oneOf", "anyOf", "allOf"] as const) {
      const branches = node[key];
      if (Array.isArray(branches))
        branches.forEach((branch, index) =>
          walk(branch, `${location}.${key}[${index}]`),
        );
    }
  };

  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(
      pathItem as Record<
        string,
        {
          operationId: string;
          parameters?: Array<Record<string, unknown> & { name: string }>;
          requestBody?: {
            content?: Record<string, { schema?: unknown }>;
          };
        }
      >,
    )) {
      for (const parameter of operation.parameters ?? []) {
        if (!hasDescription(parameter))
          undocumented.push(
            `${operation.operationId}.parameters.${parameter.name}`,
          );
      }
      for (const media of Object.values(operation.requestBody?.content ?? {})) {
        if (media.schema)
          walk(media.schema, `${operation.operationId}.requestBody`);
      }
    }
  }

  expect(undocumented.sort()).toEqual([
    "components.schemas.AuthenticationCredential.response",
    "components.schemas.AuthenticationCredential.type",
    "components.schemas.RegistrationCredential.response",
    "components.schemas.RegistrationCredential.type",
  ]);
});

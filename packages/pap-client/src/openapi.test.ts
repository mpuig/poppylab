import { it, expect, vi } from "vitest";
import { openApiTools } from "./openapi.ts";
const base = "https://company.example";
const options = (allowProposals = false) => ({
  allowProposals,
  blockedPaths: ["/control"],
  trace: vi.fn(),
  request: vi.fn(async () => ({ ok: true })),
});
const proposal = {
  operationId: "propose",
  summary: "Propose",
  "x-poppy-proposal": true,
  responses: { "202": { description: "Proposal" } },
  requestBody: {
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            quantity: { type: "integer", minimum: 0, maximum: 10 },
          },
          required: ["quantity"],
          additionalProperties: false,
        },
      },
    },
  },
};
it("generates path/query tools with encoded arguments and runtime validation", async () => {
  const o = options();
  const tools = openApiTools(
    {
      paths: {
        "/orders/{id}": {
          get: {
            operationId: "order",
            parameters: [
              { name: "id", in: "path", schema: { type: "string" } },
              { name: "search", in: "query", schema: { type: "string" } },
            ],
          },
        },
      },
    },
    base + "/openapi.json",
    o,
  );
  await tools.order!.execute({ id: "ord_1", search: "a&b" });
  expect(o.request).toHaveBeenCalledWith(
    base + "/orders/ord_1?search=a%26b",
    "GET",
    undefined,
    [],
  );
  for (const input of [
    {},
    { id: ".." },
    { id: "a/b" },
    { id: "%2f" },
    { id: "a", extra: "x" },
  ])
    await expect(tools.order!.execute(input)).rejects.toThrow();
});
it("never grants POST authority merely because metadata says proposal", () => {
  const o = options();
  expect(
    Object.keys(
      openApiTools(
        { paths: { "/change": { post: proposal } } },
        base + "/openapi.json",
        o,
      ),
    ),
  ).toEqual([]);
  expect(o.request).not.toHaveBeenCalled();
});
it("generates proposal body schemas and rejects invalid or extra fields before network", async () => {
  const o = options(true),
    tools = openApiTools(
      { paths: { "/change": { post: proposal } } },
      base + "/openapi.json",
      o,
    );
  await tools.propose!.execute({ quantity: 0 });
  expect(o.request).toHaveBeenCalledWith(
    base + "/change",
    "POST",
    { quantity: 0 },
    [],
  );
  for (const input of [
    { quantity: -1 },
    { quantity: 1.5 },
    { quantity: 100 },
    { quantity: 1, approved_by: "user" },
    {},
  ])
    await expect(tools.propose!.execute(input)).rejects.toThrow();
  expect(o.request).toHaveBeenCalledTimes(1);
});
it.each([
  "/oauth/token",
  "/agent/keys",
  "/api/account/operations/id/confirm",
  "/api/account/operations/id/cancel",
  "/control/action",
  "//evil.example/x",
  "/api/../oauth/token",
  "/api/%2e%2e/x",
  "/api/x?url=evil",
])("excludes control and unsafe endpoints: %s", (path) => {
  expect(
    Object.keys(
      openApiTools(
        { paths: { [path]: { post: proposal, get: { operationId: "read" } } } },
        base + "/openapi.json",
        options(true),
      ),
    ),
  ).toEqual([]);
});
it("cannot hide control endpoints in an OpenAPI server base path", () => {
  for (const url of [base + "/oauth", base + "/api/account/operations"])
    expect(
      Object.keys(
        openApiTools(
          { servers: [{ url }], paths: { "/x/confirm": { post: proposal } } },
          base + "/openapi.json",
          options(true),
        ),
      ),
    ).toEqual([]);
});
it("rejects cross-origin servers and credentials", () => {
  for (const url of [
    "https://evil.example",
    "https://user:pass@company.example",
  ])
    expect(() =>
      openApiTools(
        { servers: [{ url }], paths: {} },
        base + "/openapi.json",
        options(),
      ),
    ).toThrow();
});
it("omits unsupported references, nested schemas, headers and parameter collisions", () => {
  const get = (schema: unknown) => ({
    get: {
      operationId: "read",
      parameters: [{ name: "value", in: "query", schema }],
    },
  });
  for (const item of [
    get({ $ref: "#/components/schemas/X" }),
    get({ type: "array", items: { type: "string" } }),
    {
      get: {
        operationId: "read",
        parameters: [
          { name: "auth", in: "header", schema: { type: "string" } },
        ],
      },
    },
    {
      get: {
        operationId: "read",
        parameters: [
          { name: "id", in: "query", schema: { type: "string" } },
          { name: "id", in: "path", schema: { type: "string" } },
        ],
      },
    },
  ])
    expect(
      Object.keys(
        openApiTools(
          { paths: { "/read": item } },
          base + "/openapi.json",
          options(),
        ),
      ),
    ).toEqual([]);
});
it("does not let duplicate operation IDs overwrite tool authority", () =>
  expect(
    Object.keys(
      openApiTools(
        {
          paths: {
            "/one": { get: { operationId: "same" } },
            "/two": { get: { operationId: "same" } },
          },
        },
        base + "/openapi.json",
        options(),
      ),
    ),
  ).toEqual([]));
it("bounds generated tools and forwards declared scopes", async () => {
  const o = options();
  const paths = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      "/p" + i,
      { get: { operationId: "tool" + i, "x-poppy-scopes": ["poppy:read"] } },
    ]),
  );
  const tools = openApiTools({ paths }, base + "/openapi.json", o);
  expect(Object.keys(tools)).toHaveLength(24);
  await tools.tool0!.execute();
  expect(o.request).toHaveBeenCalledWith(base + "/p0", "GET", undefined, [
    "poppy:read",
  ]);
});

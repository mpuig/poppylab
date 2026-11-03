const read = (
  operationId: string,
  summary: string,
  parameters?: unknown[],
) => ({
  get: {
    operationId,
    summary,
    "x-poppy-scopes": ["poppy:read"],
    ...(parameters ? { parameters } : {}),
    responses: { "200": { description: "Fictional customer service data" } },
  },
});
const proposal = (
  operationId: string,
  summary: string,
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({
  post: {
    operationId,
    summary,
    "x-poppy-scopes": ["poppy:read", "poppy:write"],
    "x-poppy-proposal": true,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties,
            required,
            additionalProperties: false,
          },
        },
      },
    },
    responses: {
      "200": { description: "Performed, after the user's approval" },
      "403": {
        description: "approval_required: nothing performed; operation attached",
      },
    },
  },
});
export const servicePaths = {
  "/api/faq": {
    get: {
      operationId: "search_help",
      summary:
        "Read public Juniper FAQs about delivery, billing, profile and support. No account data.",
      "x-poppy-scopes": [],
      responses: { "200": { description: "Public FAQs" } },
    },
  },
  "/api/account/profile": read(
    "my_profile",
    "Read fictional contact details, delivery address and profile_version. Use profile_version as version for a profile proposal.",
  ),
  "/api/account/profile-proposal": proposal(
    "propose_profile_change",
    "Propose updating the fictional profile for future purchases only. Read my_profile first and pass its profile_version as version. Use an email ending in .invalid. Does not alter existing orders; explicit human approval required.",
    {
      version: { type: "integer", minimum: 1, maximum: 2147483647 },
      name: { type: "string", minLength: 1, maxLength: 80 },
      email: { type: "string", minLength: 1, maxLength: 120 },
      address: { type: "string", minLength: 1, maxLength: 240 },
    },
  ),
  "/api/account/invoices": read(
    "my_invoices",
    "Read simulated invoices derived from actual fictional orders; no real payment occurred.",
  ),
  "/api/account/cases": read(
    "my_support_cases",
    "List the latest 20 support cases. Read details before proposing a resolution.",
  ),
  "/api/account/cases/{case_id}": read(
    "support_case_details",
    "Read complete messages and version for one owned support case.",
    [
      {
        name: "case_id",
        in: "path",
        required: true,
        schema: { type: "string", maxLength: 100 },
      },
    ],
  ),
  "/api/account/case-proposal": proposal(
    "propose_support_case",
    "Propose opening a support case, optionally linked to an existing order. Creates no case before human approval. Response will be explicitly simulated.",
    {
      subject: { type: "string", minLength: 1, maxLength: 120 },
      topic: {
        type: "string",
        enum: ["delivery", "billing", "profile", "other"],
      },
      message: { type: "string", minLength: 1, maxLength: 1000 },
      order_id: { type: "string", minLength: 1, maxLength: 100 },
    },
    ["subject", "topic", "message"],
  ),
  "/api/account/case-resolution": proposal(
    "propose_case_resolution",
    "Propose closing a support case as answered. Read complete case details first. No refund or order/delivery change; explicit human approval required.",
    { case_id: { type: "string", minLength: 1, maxLength: 100 } },
  ),
};

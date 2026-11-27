/**
 * The OpenAPI 3.1 description of `/api/v1` (`api-http.ts`), for a client
 * app built on the agent's API. It is written next to the types it
 * describes (`api.ts`, `api-events.ts`) and served at
 * `/api/v1/openapi.json`; the playground's test holds every route and
 * every answer of a real conversation to it.
 */
type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
const string: Schema = { type: "string" };
const boolean: Schema = { type: "boolean" };
const integer: Schema = { type: "integer" };
const array = (items: Schema): Schema => ({ type: "array", items });
const object = (
  properties: Record<string, Schema>,
  required: string[] = Object.keys(properties),
  description?: string,
): Schema => ({
  type: "object",
  properties,
  required,
  ...(description ? { description } : {}),
});

const schemas: Record<string, Schema> = {
  CompanyRef: object(
    { origin: string, name: string },
    ["origin", "name"],
    "A Company, named by its origin; `name` is to show.",
  ),
  Answer: {
    description:
      "What a choice carries, in place of a message. Exactly one member; Companies are named by origin and nothing here is read as words.",
    oneOf: [
      object({ company: string }),
      object({ connect: string }),
      object({ remove: array(string) }),
      object({ keep: array(string) }),
      object({ message: string }),
    ],
  },
  Choice: object(
    { label: string, answer: ref("Answer") },
    ["label", "answer"],
    "A quick reply. Show `label`; send `answer` to `answers`, never the label as a message.",
  ),
  AgentStep: object(
    {
      text: string,
      how: {
        type: "string",
        enum: ["API", "Company's agent", "sign-in", "setup"],
      },
      access: {
        type: ["string", "null"],
        enum: ["view", "view and change", null],
      },
      state: { type: "string", enum: ["done", "failed", "waiting"] },
      company: string,
      args: string,
    },
    ["text", "how", "access", "state"],
  ),
  AgentMessage: object(
    {
      from: { type: "string", enum: ["user", "agent", "company"] },
      text: string,
      company: ref("CompanyRef"),
      using: array(ref("CompanyRef")),
      author: string,
      direct: boolean,
      choices: array(ref("Choice")),
      links: array(string),
      steps: array(ref("AgentStep")),
      data: string,
    },
    ["from", "text"],
    "Something said. `agent` without `company` is the agent's own voice about the conversation; `company` is a Company's own words, to show as theirs.",
  ),
  CompanyState: object(
    {
      origin: string,
      name: string,
      url: string,
      signedIn: boolean,
      scopes: string,
      signingIn: boolean,
      consentVersion: integer,
      accessLost: boolean,
      direct: object({
        open: boolean,
        invitation: { type: ["string", "null"] },
      }),
    },
    [
      "origin",
      "name",
      "url",
      "signedIn",
      "signingIn",
      "consentVersion",
      "accessLost",
      "direct",
    ],
  ),
  Proposal: object(
    {
      id: string,
      company: ref("CompanyRef"),
      revision: string,
      summary: string,
      terms: { type: "object" },
      state: {
        type: "string",
        enum: [
          "proposed",
          "succeeded",
          "declined",
          "refused",
          "expired",
          "superseded",
          "uncertain",
        ],
      },
      expiresAt: string,
      result: string,
    },
    ["id", "company", "revision", "terms", "state", "expiresAt"],
    "A change a Company holds for the User's approval, with its exact terms. Nothing is performed until it is approved.",
  ),
  ConversationState: object(
    {
      id: string,
      active: boolean,
      keptUntil: integer,
      companies: array(ref("CompanyState")),
      removed: array(ref("CompanyRef")),
      messages: array(ref("AgentMessage")),
      proposals: array(ref("Proposal")),
    },
    ["id", "active", "companies", "removed", "messages", "proposals"],
  ),
  TurnResult: object({
    conversation: string,
    messages: array(ref("AgentMessage")),
    replaced: boolean,
    state: ref("ConversationState"),
  }),
  ModelChoice: object(
    {
      provider: {
        type: "string",
        enum: ["demo", "openai-compatible", "anthropic"],
      },
      apiKey: string,
      model: string,
    },
    ["provider"],
    "The model a turn is asked of, with the User's own key; demo mode, which runs scripted examples only, when left out.",
  ),
  Decision: object({
    proposal: ref("Proposal"),
    state: ref("ConversationState"),
  }),
  SignIn: object(
    { url: string },
    ["url"],
    "The Company's own consent page, for the User to open. The agent never sees a password.",
  ),
  AgentEvent: {
    type: "object",
    description:
      "An event of the stream; its `type` is also the SSE event name. `state` comes first.",
    properties: {
      type: {
        type: "string",
        enum: [
          "state",
          "message",
          "messages.replaced",
          "signin.completed",
          "access.lost",
          "signout",
          "proposal.created",
          "proposal.expired",
          "proposal.replaced",
          "proposal.updated",
          "company.added",
          "company.removed",
          "conversation.ended",
        ],
      },
      state: ref("ConversationState"),
      message: ref("AgentMessage"),
      company: ref("CompanyRef"),
      proposal: ref("Proposal"),
      keptUntil: integer,
    },
    required: ["type"],
  },
  Error: object(
    { code: string, error: string },
    ["error"],
    "`error` is written for the User and can be shown as it is.",
  ),
};

const json = (schema: Schema) => ({
  content: { "application/json": { schema } },
});
const errors = {
  "400": {
    description: "Refused before anything was sent.",
    ...json(ref("Error")),
  },
  "403": {
    description: "Not from the playground's own origin.",
    ...json(ref("Error")),
  },
  "404": {
    description: "No such conversation for this user.",
    ...json(ref("Error")),
  },
  "409": {
    description:
      "Another request holds the conversation, or a Company can't be added.",
    ...json(ref("Error")),
  },
  "410": {
    description: "The conversation has ended and is read-only.",
    ...json(ref("Error")),
  },
};
const id = {
  name: "id",
  in: "path",
  required: true,
  schema: string,
  description: "The conversation.",
};
const body = (schema: Schema) => ({ required: true, ...json(schema) });

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Personal Agent API",
      version: "1.0.0",
      description:
        "Conversations with a Personal Agent and the Companies it works with over PAP 1.0: messages, quick replies, proposals and their approval, sign-in and events. Requests are the visitor's, by the playground's cookie, from its own origin; per-device API sessions come next.",
    },
    servers: [{ url: "/" }],
    paths: {
      "/api/v1/openapi.json": {
        get: {
          operationId: "getOpenApi",
          summary: "This document.",
          responses: {
            "200": { description: "OpenAPI 3.1.", ...json({ type: "object" }) },
          },
        },
      },
      "/api/v1/conversations": {
        post: {
          operationId: "startConversation",
          summary:
            "Start a conversation, with no Company or with the one at `company`, connected signed out.",
          requestBody: body(object({ company: string }, [])),
          responses: {
            "201": {
              description: "The new conversation.",
              ...json(ref("ConversationState")),
            },
            "422": {
              description: "Discovery of the Company failed.",
              ...json(ref("Error")),
            },
            ...errors,
          },
        },
      },
      "/api/v1/conversations/{id}": {
        get: {
          operationId: "getConversation",
          summary:
            "The conversation as it is now: its Companies, what was said, and every proposal.",
          parameters: [id],
          responses: {
            "200": {
              description: "The conversation.",
              ...json(ref("ConversationState")),
            },
            "404": errors["404"],
          },
        },
      },
      "/api/v1/conversations/{id}/messages": {
        post: {
          operationId: "sendMessage",
          summary:
            "The User's message. `company` is the Company the User chose for it; without it the agent works out which, or asks with choices.",
          parameters: [id],
          requestBody: body(
            object(
              { text: string, company: string, model: ref("ModelChoice") },
              ["text"],
            ),
          ),
          responses: {
            "200": {
              description: "What the turn added, and the conversation.",
              ...json(ref("TurnResult")),
            },
            ...errors,
          },
        },
      },
      "/api/v1/conversations/{id}/answers": {
        post: {
          operationId: "answerChoice",
          summary:
            "The answer one of the agent's choices carries, in place of a message.",
          parameters: [id],
          requestBody: body(
            object({ answer: ref("Answer"), model: ref("ModelChoice") }, [
              "answer",
            ]),
          ),
          responses: {
            "200": {
              description: "What the turn added, and the conversation.",
              ...json(ref("TurnResult")),
            },
            ...errors,
          },
        },
      },
      "/api/v1/conversations/{id}/proposals/{proposal}/decision": {
        post: {
          operationId: "decideProposal",
          summary:
            "Approve or decline a proposal, found by its Company and its ID. An approval covers exactly `revision`.",
          parameters: [
            id,
            { name: "proposal", in: "path", required: true, schema: string },
          ],
          requestBody: body(
            object({
              company: string,
              revision: string,
              decision: { type: "string", enum: ["approve", "decline"] },
            }),
          ),
          responses: {
            "200": {
              description: "The proposal as it is now, and the conversation.",
              ...json(ref("Decision")),
            },
            ...errors,
          },
        },
      },
      "/api/v1/conversations/{id}/sign-ins": {
        post: {
          operationId: "startSignIn",
          summary:
            "Start a sign-in at one of the conversation's Companies; `signin.completed` follows on the events.",
          parameters: [id],
          requestBody: body(
            object(
              {
                company: string,
                access: { type: "string", enum: ["read", "write"] },
              },
              ["company"],
            ),
          ),
          responses: {
            "200": {
              description: "The consent page to open.",
              ...json(ref("SignIn")),
            },
            ...errors,
          },
        },
      },
      "/api/v1/conversations/{id}/events": {
        get: {
          operationId: "conversationEvents",
          summary:
            "Server-Sent Events: `state` first, then what changes (a sign-in finished, a proposal expired or replaced, a Company's message in a Direct Conversation). Closes after five minutes or when the conversation ends; open it again.",
          parameters: [id],
          responses: {
            "200": {
              description: "An event stream; each `data` is an AgentEvent.",
              content: { "text/event-stream": { schema: ref("AgentEvent") } },
            },
            "404": errors["404"],
          },
        },
      },
    },
    components: { schemas },
  };
}

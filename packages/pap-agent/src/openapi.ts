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
  ProposalRef: object(
    { company: string, proposal: string, revision: string },
    ["company", "proposal", "revision"],
    "One proposal at its exact revision: the Company's origin, the proposal's ID and the revision the question named.",
  ),
  Answer: {
    description:
      "What a choice carries, in place of a message. Exactly one member; Companies are named by origin and nothing here is read as words. `approve` and `decline` decide the proposal the agent asked about, at that revision only. `signin` is for the client to carry out: open the sign-in with `POST …/sign-ins` for that Company and access (sent to `answers`, it is answered with the same choice). `signout` signs out there, `resume` goes on with the request that waited for the sign-in there, and `invitation` accepts or declines the Company's invitation to talk directly.",
    oneOf: [
      object({ company: string }),
      object({ connect: string }),
      object({ remove: array(string) }),
      object({ keep: array(string) }),
      object({ message: string }),
      object({ approve: ref("ProposalRef") }),
      object({ decline: ref("ProposalRef") }),
      object({
        signin: object({
          company: string,
          access: { type: "string", enum: ["read", "write"] },
        }),
      }),
      object({ signout: string }),
      object({ resume: string }),
      object({
        invitation: object({ company: string, accept: boolean }),
      }),
    ],
  },
  Choice: object(
    { label: string, answer: ref("Answer") },
    ["label", "answer"],
    "A quick reply. Show `label`; send `answer` to `answers`, never the label as a message. The User can answer the same question in words instead, as a message.",
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
      spoken: {
        type: "string",
        description:
          "On the agent's messages: the same in one or two short sentences to read aloud, with no markdown or identifier and amounts as they are said. Made by fixed rules from the same words or facts, never by a model.",
      },
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
      spoken: {
        type: "string",
        description:
          "What it is, to read aloud, in the agent's words from its terms: the Company, what it wants and how much. Never the Company's summary.",
      },
    },
    ["id", "company", "revision", "terms", "state", "expiresAt", "spoken"],
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
        enum: ["demo", "free", "openai-compatible", "anthropic"],
      },
      apiKey: string,
      model: string,
      turnstile: string,
    },
    ["provider"],
    "The model a turn is asked of, with the User's own key; demo mode, which runs scripted examples only, when left out. `free` is the deployment's own small model, with no key: each turn needs a Turnstile token (`turnstile`) for the deployment's site key, and one without a good token, or past the free model's limits, runs in demo mode with a line that says why.",
  ),
  Decision: object({
    proposal: ref("Proposal"),
    state: ref("ConversationState"),
  }),
  SignIn: object(
    { url: string, expiresAt: integer, endUrl: string },
    ["url"],
    "What to open for the sign-in. The agent never sees a password. For the playground's page, `url` is the Company's own consent page. For a client app, `url` is a page of the agent's own, a link that works once, before `expiresAt` (milliseconds since 1970): open it at once in a browser of the app's own, such as ASWebAuthenticationSession. It goes on to the Company's consent page, and the browser comes back to `endUrl` with `?result=done` or `?result=failed`, which is what the app watches for. The conversation's events say how it went.",
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
          "signin.failed",
          "access.lost",
          "signout",
          "proposal.created",
          "proposal.expired",
          "proposal.replaced",
          "proposal.updated",
          "company.added",
          "company.removed",
          "conversation.ended",
          "session.ended",
        ],
      },
      state: ref("ConversationState"),
      message: ref("AgentMessage"),
      company: ref("CompanyRef"),
      proposal: ref("Proposal"),
      keptUntil: integer,
      code: {
        type: "string",
        enum: ["invalid_token", "session_revoked"],
        description:
          "For `session.ended`: `invalid_token` when the access token ran out or was replaced (refresh it and open the stream again), `session_revoked` when the device was signed out.",
      },
    },
    required: ["type"],
  },
  Error: object(
    { code: string, error: string },
    ["error"],
    "`error` is written for the User and can be shown as it is.",
  ),
  Passkey: object(
    {
      id: string,
      name: string,
      created: integer,
      lastUsed: integer,
      synced: boolean,
    },
    ["id", "name", "created", "synced"],
    "One of the account's passkeys. `name` is the device it was added on, in that device's words; `synced` says a password manager keeps it on the person's other devices too. Its key is never shown.",
  ),
  Account: object(
    {
      id: string,
      label: string,
      created: integer,
      passkeys: array(ref("Passkey")),
      channels: array(object({ channel: string, linked: integer })),
      session: string,
      unclaimed: integer,
    },
    ["id", "created", "passkeys", "channels", "session"],
    "An agent account: an opaque ID, its passkeys and the label the person chose, and nothing else about them. `session` is the session of this request; `unclaimed`, for a browser only, counts its own conversations from before it signed in.",
  ),
  SessionTokens: object(
    {
      session: string,
      accessToken: string,
      accessTokenExpiresAt: integer,
      refreshToken: string,
      refreshTokenExpiresAt: integer,
    },
    undefined,
    "A client app's tokens. Send the access token as `Authorization: Bearer`; it lasts about 15 minutes. Exchange the refresh token at `/api/v1/sessions/refresh` for new ones: each works once, and one used twice ends the session. Keep both in the device's keychain, never in a URL or a log. Times are milliseconds since 1970.",
  ),
  SignedIn: object(
    { account: ref("Account"), tokens: ref("SessionTokens") },
    ["account"],
    "The account, signed in on this device. A browser is given a cookie and no `tokens`; a client app, which sends no `Origin`, is given `tokens`.",
  ),
  CreationOptions: object(
    { ceremony: string, options: { type: "object" } },
    undefined,
    "WebAuthn options for `navigator.credentials.create` (PublicKeyCredentialCreationOptionsJSON), and the ceremony to answer them with within five minutes, once.",
  ),
  RequestOptions: object(
    { ceremony: string, options: { type: "object" } },
    undefined,
    "WebAuthn options for `navigator.credentials.get` (PublicKeyCredentialRequestOptionsJSON) with no username: any of this site's passkeys answers. Answer within five minutes, once.",
  ),
  PasskeyAnswer: object(
    {
      ceremony: string,
      credential: { type: "object" },
      device: string,
    },
    ["ceremony", "credential"],
    'The authenticator\'s answer (RegistrationResponseJSON or AuthenticationResponseJSON) to the ceremony\'s options. `device` names this device in its own words, such as "iPhone" or "Chrome on macOS".',
  ),
  Session: object(
    {
      id: string,
      kind: { type: "string", enum: ["browser", "app"] },
      device: string,
      created: integer,
      lastUsed: integer,
      expires: integer,
      current: boolean,
    },
    undefined,
    "A device signed in to the account. `current` is the one this request is made with.",
  ),
  LinkCode: object(
    { code: string, expiresAt: integer },
    undefined,
    "A one-time code to type into a channel, which links it to the account. It works once, for five minutes.",
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
const accountErrors = {
  "400": errors["400"],
  "401": {
    description:
      "Not signed in, or the access token has expired or was revoked.",
    ...json(ref("Error")),
  },
  "403": errors["403"],
  "429": {
    description: "Too many attempts; wait as long as `Retry-After` says.",
    ...json(ref("Error")),
  },
};
const ok = (description: string, schema: Schema, status = "200") => ({
  [status]: { description, ...json(schema) },
});
const counted = object({ revoked: integer });
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
        "Conversations with a Personal Agent and the Companies it works with over PAP 1.0: messages, quick replies, proposals and their approval, sign-in and events; and the agent account, with its passkeys and the session of each device. A browser's requests are the playground's own, by its cookies, from its origin. A client app sends no Origin: it creates an account or signs in with a passkey, then sends `Authorization: Bearer <access token>`.",
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
            "Start a sign-in at one of the conversation's Companies; `signin.completed` or `signin.failed` follows on the events. With an API session's token, the answer is a link of the agent's own, which starts the sign-in in the browser the app opens it in.",
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
              description: "What to open.",
              ...json(ref("SignIn")),
            },
            ...errors,
            "401": accountErrors["401"],
            "429": accountErrors["429"],
          },
        },
      },
      "/api/v1/sign-ins/{ticket}": {
        get: {
          operationId: "openSignInLink",
          summary:
            "An app's sign-in link (`SignIn.url`), opened in the app's browser: it starts the sign-in there and goes on to the Company's consent page. It works once, within three minutes, for the account, conversation, Company and access it was made for. Used, expired, of a session that ended, or opened in a browser signed in to another account, it goes to `endUrl` with `?result=failed`.",
          parameters: [
            {
              name: "ticket",
              in: "path",
              required: true,
              schema: string,
              description: "The link's one-time ticket.",
            },
          ],
          responses: {
            "303": {
              description:
                "To the Company's consent page, or to `endUrl` with `?result=failed`.",
              headers: { Location: { schema: string } },
            },
          },
        },
      },
      "/api/v1/conversations/{id}/events": {
        get: {
          operationId: "conversationEvents",
          summary:
            "Server-Sent Events: `state` first, then what changes (a sign-in finished, a proposal expired or replaced, a Company's message in a Direct Conversation). Closes after five minutes or when the conversation ends; open it again. A signed-in stream ends with `session.ended` within seconds of its session ending or its access token running out. An account keeps at most ten streams open (`too_many_streams`).",
          parameters: [id],
          responses: {
            "200": {
              description: "An event stream; each `data` is an AgentEvent.",
              content: { "text/event-stream": { schema: ref("AgentEvent") } },
            },
            "404": errors["404"],
            "429": accountErrors["429"],
          },
        },
      },
      ...accountPaths(),
    },
    components: {
      schemas,
      securitySchemes: {
        apiSession: {
          type: "http",
          scheme: "bearer",
          description:
            "An API session's access token (`SessionTokens`). A browser on the playground's own origin uses its cookie instead.",
        },
      },
    },
  };
}

const answerBody = body(ref("PasskeyAnswer"));
const bearer = [{ apiSession: [] }];
const passkeyId = {
  name: "passkey",
  in: "path",
  required: true,
  schema: string,
  description: "The passkey's `id`.",
};
const sessionId = {
  name: "session",
  in: "path",
  required: true,
  schema: string,
  description: "The session's `id`.",
};

/** The agent account's routes (`agent-account-http.ts`). */
function accountPaths() {
  return {
    "/api/v1/accounts/options": {
      post: {
        operationId: "accountOptions",
        summary:
          "Start creating an account: WebAuthn options for a new passkey (discoverable, with user verification, no attestation). `label` is an optional name for the account, the person's own choice.",
        requestBody: body(object({ label: string }, [])),
        responses: {
          ...ok("The options and the ceremony.", ref("CreationOptions")),
          ...accountErrors,
        },
      },
    },
    "/api/v1/accounts": {
      post: {
        operationId: "createAccount",
        summary:
          "Create the account with the new passkey, and sign this device in.",
        requestBody: answerBody,
        responses: {
          ...ok("The new account, signed in.", ref("SignedIn"), "201"),
          ...accountErrors,
        },
      },
    },
    "/api/v1/sessions/options": {
      post: {
        operationId: "signInOptions",
        summary: "Start signing in with a passkey: WebAuthn options.",
        requestBody: body(object({}, [])),
        responses: {
          ...ok("The options and the ceremony.", ref("RequestOptions")),
          ...accountErrors,
        },
      },
    },
    "/api/v1/sessions": {
      post: {
        operationId: "signIn",
        summary:
          "Sign this device in with the passkey's answer: a new session for it.",
        requestBody: answerBody,
        responses: {
          ...ok("The account, signed in.", ref("SignedIn"), "201"),
          ...accountErrors,
        },
      },
    },
    "/api/v1/sessions/refresh": {
      post: {
        operationId: "refreshSession",
        summary:
          "New tokens for a client app, in exchange for its refresh token, which stops working. A refresh token used twice ends the whole session (`session_revoked`).",
        requestBody: body(object({ refreshToken: string })),
        responses: {
          ...ok("The new tokens.", ref("SessionTokens")),
          ...accountErrors,
        },
      },
    },
    "/api/v1/account": {
      get: {
        operationId: "getAccount",
        summary: "The account this device is signed in to.",
        security: bearer,
        responses: {
          ...ok("The account.", ref("Account")),
          "401": accountErrors["401"],
        },
      },
    },
    "/api/v1/account/passkeys/options": {
      post: {
        operationId: "passkeyOptions",
        summary: "Start adding a passkey to the account: WebAuthn options.",
        security: bearer,
        requestBody: body(object({}, [])),
        responses: {
          ...ok("The options and the ceremony.", ref("CreationOptions")),
          "409": {
            description: "The account has as many passkeys as it can keep.",
            ...json(ref("Error")),
          },
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/passkeys": {
      post: {
        operationId: "addPasskey",
        summary: "Add the new passkey to the account.",
        security: bearer,
        requestBody: answerBody,
        responses: {
          ...ok(
            "The passkey, and the account.",
            object({ passkey: ref("Passkey"), account: ref("Account") }),
            "201",
          ),
          "409": {
            description: "The passkey is on the account already.",
            ...json(ref("Error")),
          },
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/passkeys/{passkey}": {
      delete: {
        operationId: "removePasskey",
        summary:
          "Remove a passkey, and end every session it started, this one too when it began with it. The account keeps at least one (`last_passkey`).",
        security: bearer,
        parameters: [passkeyId],
        responses: {
          ...ok("The account.", ref("Account")),
          "404": {
            description: "No such passkey on this account.",
            ...json(ref("Error")),
          },
          "409": {
            description: "It is the account's last passkey.",
            ...json(ref("Error")),
          },
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/sessions": {
      get: {
        operationId: "listSessions",
        summary:
          "The devices signed in to the account, most recent first. An account keeps at most 25: signing in on another device ends the one used least recently.",
        security: bearer,
        responses: {
          ...ok("The sessions.", object({ sessions: array(ref("Session")) })),
          "401": accountErrors["401"],
        },
      },
      delete: {
        operationId: "revokeAllSessions",
        summary: "Sign out every device, this one too.",
        security: bearer,
        responses: {
          ...ok("How many were signed out.", counted),
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/sessions/{session}": {
      delete: {
        operationId: "revokeSession",
        summary: "Sign one device out. The others stay signed in.",
        security: bearer,
        parameters: [sessionId],
        responses: {
          ...ok("It was signed out.", counted),
          "404": {
            description: "No such device signed in to this account.",
            ...json(ref("Error")),
          },
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/sign-out": {
      post: {
        operationId: "signOut",
        summary:
          "Sign this device out. The account's other devices stay signed in.",
        security: bearer,
        requestBody: body(object({}, [])),
        responses: { ...ok("Signed out.", counted), ...accountErrors },
      },
    },
    "/api/v1/account/claim": {
      post: {
        operationId: "claimConversations",
        summary:
          "A browser only: bring its own conversations, from before it signed in, into the account, so they open on every device signed in to it. Nothing is moved without this request.",
        requestBody: body(object({}, [])),
        responses: {
          ...ok(
            "How many were moved, how many were busy and stayed, and the account.",
            object({
              moved: integer,
              skipped: integer,
              account: ref("Account"),
            }),
          ),
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/link-codes": {
      post: {
        operationId: "createLinkCode",
        summary:
          "A one-time code that links a channel, such as a messaging app, to the account when it is typed there.",
        security: bearer,
        requestBody: body(object({}, [])),
        responses: {
          ...ok("The code.", ref("LinkCode"), "201"),
          ...accountErrors,
        },
      },
    },
    "/api/v1/link-codes/redeem": {
      post: {
        operationId: "redeemLinkCode",
        summary:
          "For a channel this deployment knows, which proves itself in its own way: redeem a code once, linking the channel's user to the code's account.",
        requestBody: body(
          object({ channel: string, user: string, code: string }),
        ),
        responses: {
          ...ok(
            "Linked.",
            object({ account: string, linked: { type: "boolean" } }),
          ),
          ...accountErrors,
        },
      },
    },
  };
}

/**
 * The OpenAPI 3.1 description of `/api/v1` (`api-http.ts`), for a client
 * app built on the agent's API. It is written next to the types it
 * describes (`api.ts`, `api-events.ts`) and served at
 * `/api/v1/openapi.json`; the playground's test holds every route and
 * every answer of a real conversation to it.
 */
type Schema = Record<string, unknown>;
const ref = (name: string, description?: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
  ...(description ? { description } : {}),
});
const str = (description?: string): Schema => ({
  type: "string",
  ...(description ? { description } : {}),
});
const bool = (description?: string): Schema => ({
  type: "boolean",
  ...(description ? { description } : {}),
});
const int = (description?: string): Schema => ({
  type: "integer",
  ...(description ? { description } : {}),
});
const string: Schema = { type: "string" };
const operationIdString = (description?: string): Schema => ({
  ...str(description),
  pattern: "^[A-Za-z0-9_-]{1,256}$",
});
const opaqueIdString = (description?: string): Schema => ({
  ...str(description),
  pattern: "^[A-Za-z0-9_-]{22}$",
});
const array = (items: Schema, description?: string): Schema => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});
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
    {
      origin: str(
        "Company origin URL, such as `https://food-demo.poppylab.dev`.",
      ),
      name: str("Human-readable company name for display."),
    },
    ["origin", "name"],
    "Identifies a Company by its origin and display name.",
  ),
  ProposalRef: object(
    {
      company: str("Origin URL of the Company holding the proposal."),
      proposal: operationIdString("Unique proposal ID issued by the Company."),
      revision: operationIdString(
        "Exact revision token shown to the user for approval.",
      ),
    },
    ["company", "proposal", "revision"],
    "References a specific proposal at an exact revision. Approvals bind strictly to `revision`.",
  ),
  Answer: {
    description:
      "Structured payload carried by a quick-reply `Choice`. Must contain exactly one member; Companies are referenced by origin and values are never parsed as free text. `approve` and `decline` decide a proposal at its exact revision; `signin` tells the client to call `POST /api/v1/conversations/{id}/sign-ins`; `signout` signs out of that Company; `resume` retries the request that waited for sign-in; `invitation` accepts or declines a Direct Conversation.",
    oneOf: [
      object({
        company: str("Selects an already-connected Company by origin."),
      }),
      object({
        connect: str("Connects a new Company by origin URL."),
      }),
      object({
        remove: array(string, "Disconnects the listed Company origins."),
      }),
      object({
        keep: array(
          string,
          "Keeps only the listed Company origins when replacing a full conversation.",
        ),
      }),
      object({
        message: str("Sends a scripted prompt text as the user's turn."),
      }),
      object({
        approve: ref("ProposalRef", "Approves the referenced proposal."),
      }),
      object({
        decline: ref("ProposalRef", "Declines the referenced proposal."),
      }),
      object({
        signin: object(
          {
            company: str("Origin URL of the Company to sign in to."),
            access: {
              type: "string",
              enum: ["read", "write"],
              description: "Permission level to request (`read` or `write`).",
            },
          },
          ["company", "access"],
          "Prompts the client to start a Company sign-in flow.",
        ),
      }),
      object({
        signout: str("Origin URL of the Company to sign out from."),
      }),
      object({
        resume: str(
          "Origin URL of the Company whose pending request should resume after sign-in.",
        ),
      }),
      object({
        invitation: object(
          {
            company: str("Origin URL of the Company that sent the invitation."),
            accept: bool(
              "`true` to open a Direct Conversation; `false` to decline.",
            ),
          },
          ["company", "accept"],
          "Responds to a Company's invitation to speak directly with the user.",
        ),
      }),
    ],
  },
  Choice: object(
    {
      label: str("Short button label to display to the user."),
      answer: ref(
        "Answer",
        "Structured payload to submit to `POST /api/v1/conversations/{id}/answers` when chosen.",
      ),
    },
    ["label", "answer"],
    'A quick-reply button attached to an agent message. Render `label` and submit `answer` verbatim. The user may also answer the question in words with `sendMessage` ("yes", "no", "approve the Lantern one"): the agent\'s code, never a model, reads a short answer to the question just asked, and any other message drops the question.',
  ),
  AgentStep: object(
    {
      text: str("Plain-language summary of what the agent did."),
      how: {
        type: "string",
        enum: ["API", "Company's agent", "sign-in", "setup"],
        description: "Channel or phase used for this step.",
      },
      access: {
        type: ["string", "null"],
        enum: ["view", "view and change", null],
        description:
          "Access level used for this step, or `null` for signed-out calls.",
      },
      state: {
        type: "string",
        enum: ["done", "failed", "waiting"],
        description: "Outcome of this step.",
      },
      company: str("Origin URL of the Company involved, when applicable."),
      args: str("Sanitized JSON summary of arguments sent to the Company."),
    },
    ["text", "how", "access", "state"],
    "One protocol action taken during a turn, shown in the activity trace.",
  ),
  AgentMessage: object(
    {
      id: str(
        "Only in a turn streamed with `Accept: text/event-stream`, on each of the agent's messages: the ID its `message.delta` events named. Match it to the sentences shown, and drop shown sentences whose ID no message carries.",
      ),
      from: {
        type: "string",
        enum: ["user", "agent", "company"],
        description:
          "Speaker role. `agent` without `company` is the agent's own system voice; `company` is untrusted Company content.",
      },
      text: str("Message body in plain text or light Markdown."),
      spoken: str(
        "Voice-ready version of `text` (one or two short sentences, no Markdown or IDs, spoken currency). Generated deterministically, never by a model. Only on the agent's messages: a Company's words are never rewritten.",
      ),
      company: ref("CompanyRef", "Company this message is from or about."),
      using: array(
        ref("CompanyRef"),
        "Companies consulted while producing this reply.",
      ),
      author: str("Company-provided author label, such as a support agent."),
      direct: bool("`true` when sent inside a Direct Conversation (§8.10)."),
      choices: array(ref("Choice"), "Quick-reply actions for the user."),
      links: array(string, "Safe HTTPS links surfaced by the turn."),
      steps: array(
        ref("AgentStep"),
        "Protocol steps executed during this turn.",
      ),
      data: str("Pretty-printed structured payload attached to a message."),
      proposals: array(
        ref("ProposalRef"),
        "Proposals that arrived with this message, at the revision they came with. A client that shows proposals as cards shows each one after this message, found in `ConversationState.proposals` by `company` and `proposal`, and keeps it there once it is decided.",
      ),
    },
    ["from", "text"],
    "A single message in the conversation transcript.",
  ),
  PendingItem: object(
    {
      conversation: str("ID of the conversation it waits in."),
      kind: {
        type: "string",
        enum: ["proposal", "signin", "question"],
        description:
          "`proposal`: a Company holds a change for the user's approval. `signin`: a Company sign-in to finish or to do again. `question`: the agent asked, and the user's next message or a quick reply answers.",
      },
      company: ref("CompanyRef", "Company it is at, when it is at one."),
      text: str(
        "What it is, in the agent's own words (never a Company's summary), such as `Approve or decline the $88.00 change`.",
      ),
      expiresAt: str(
        "ISO 8601 timestamp after which it no longer waits, when it runs out on its own.",
      ),
      proposal: object(
        {
          id: str("Proposal (operation) ID."),
          revision: str("Exact revision a decision binds to."),
        },
        ["id", "revision"],
        "For a `proposal`: which one, to decide with `decideProposal`.",
      ),
    },
    ["conversation", "kind", "text"],
    "One thing that waits for the user. Decided, answered and expired items are not listed.",
  ),
  CompanyState: object(
    {
      origin: str("Company origin URL."),
      name: str("Company display name."),
      url: str("Company homepage URL."),
      signedIn: bool("`true` when the user has an active OAuth grant."),
      scopes: str("Space-separated OAuth scopes currently granted."),
      signingIn: bool("`true` while a sign-in flow is in progress."),
      consentVersion: int(
        "Monotonic counter incremented each time consent is granted or upgraded.",
      ),
      accessLost: bool(
        "`true` when the Company revoked or rejected the stored grant.",
      ),
      direct: object(
        {
          open: bool("`true` while a Direct Conversation is active."),
          invitation: {
            type: ["string", "null"],
            description:
              "Reason text for a pending Direct Conversation invitation, or `null`.",
          },
        },
        ["open", "invitation"],
        "Direct Conversation status for this Company.",
      ),
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
    "Connection, authentication, and Direct Conversation state for one Company.",
  ),
  Proposal: object(
    {
      id: str("Operation ID issued by the Company."),
      company: ref("CompanyRef", "Company holding the pending change."),
      revision: str(
        "Exact revision token required when approving. Changes if terms shift.",
      ),
      summary: str("Company-authored plain-text summary of the change."),
      terms: {
        type: "object",
        description:
          "Authoritative structured terms computed by the Company (amounts, dates, balances).",
      },
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
        description: "Current lifecycle state of the operation.",
      },
      expiresAt: str(
        "ISO 8601 timestamp after which the proposal cannot be approved.",
      ),
      result: str("Outcome message or refusal reason once resolved."),
      spoken: str(
        "Agent-generated spoken description derived from `terms` (never the Company's summary).",
      ),
    },
    ["id", "company", "revision", "terms", "state", "expiresAt", "spoken"],
    "A state-changing operation held by a Company for explicit user approval (Operations v3). Nothing executes until approved.",
  ),
  ConversationState: object(
    {
      id: str("Unique conversation identifier."),
      active: bool("`true` while open; `false` once ended and read-only."),
      keptUntil: int(
        "Unix timestamp (ms) when an ended conversation is purged from storage.",
      ),
      companies: array(
        ref("CompanyState"),
        "Currently connected Companies (up to 3).",
      ),
      removed: array(
        ref("CompanyRef"),
        "Companies previously disconnected from this conversation.",
      ),
      messages: array(ref("AgentMessage"), "Ordered conversation transcript."),
      proposals: array(
        ref("Proposal"),
        "All proposals raised in this conversation.",
      ),
    },
    ["id", "active", "companies", "removed", "messages", "proposals"],
    "Complete snapshot of a conversation, its connected Companies, transcript, and proposals.",
  ),
  TurnResult: object(
    {
      conversation: str("Conversation ID."),
      messages: array(
        ref("AgentMessage"),
        "Messages added during this turn (or the full list when `replaced` is `true`).",
      ),
      replaced: bool(
        "`true` when earlier messages were withdrawn (for example after losing access or disconnecting a Company).",
      ),
      state: ref("ConversationState", "Full updated conversation state."),
    },
    ["conversation", "messages", "replaced", "state"],
    "Result of a completed message or quick-reply turn.",
  ),
  MessageDelta: object(
    {
      type: {
        type: "string",
        enum: ["message.delta"],
        description: "Always `message.delta`; also the SSE event name.",
      },
      message: str(
        "ID of the agent message this sentence belongs to; the `turn` event's message with this `id` holds the whole text.",
      ),
      index: int("Position of the sentence within its message, from 0."),
      text: str(
        "The sentence as written, with the whitespace around it, so the texts of one message joined are its text. Ends at a stop, a line's end, or a clause or space before about 220 characters; never inside a word.",
      ),
      spoken: str(
        "The sentence to read aloud, made by the same fixed rules as a message's `spoken`. Empty when it holds nothing to say, such as a table row or a bare address.",
      ),
    },
    ["type", "message", "index", "text", "spoken"],
    "One sentence of one of the agent's messages, sent as soon as it is written. A voice client speaks `spoken` as each one arrives.",
  ),
  TurnEvent: {
    type: "object",
    description:
      "One Server-Sent Event of a turn streamed with `Accept: text/event-stream`; `type` matches the SSE `event:` field. `message.delta` events come first, one per sentence, then exactly one `turn` or `error`. Only the agent's words come as sentences: Company content comes whole in the result as its own message (§10.1). Demo-mode answers and the agent's own lines, which are ready at once, come as sentences too, all together just before `turn`.",
    oneOf: [
      ref("MessageDelta"),
      object(
        {
          type: {
            type: "string",
            enum: ["turn"],
            description: "Always `turn`; the last event of a turn that ended.",
          },
          result: ref(
            "TurnResult",
            "The same result as the JSON answer; each agent message carries the `id` its sentences named.",
          ),
        },
        ["type", "result"],
        "The turn ended: show `result` in place of the sentences shown.",
      ),
      object(
        {
          type: {
            type: "string",
            enum: ["error"],
            description:
              "Always `error`; the last event of a turn that failed after it began.",
          },
          status: int("The HTTP status the JSON answer would have had."),
          code: str("Machine-readable error code, when there is one."),
          error: str("User-facing explanation that can be shown as is."),
        },
        ["type", "status", "error"],
        "The turn failed after its first sentence: drop the sentences shown and show `error`.",
      ),
    ],
  },
  ModelChoice: object(
    {
      provider: {
        type: "string",
        enum: ["demo", "free", "openai-compatible", "anthropic"],
        description:
          "Model backend: `demo` (scripted examples, no LLM), `free` (deployment's Workers AI model), or bring-your-own-key (`openai-compatible`, `anthropic`).",
      },
      apiKey: {
        ...str(
          "Provider API key for `openai-compatible` or `anthropic`. Sent per request and never stored.",
        ),
        maxLength: 2048,
      },
      model: {
        ...str("Optional model identifier for bring-your-own-key providers."),
        maxLength: 256,
      },
      turnstile: {
        ...str(
          "Single-use Cloudflare Turnstile token required for `free` turns, made by the deployment's widget on its own host for the action `chat`. Missing, invalid, or over-quota turns fall back to `demo` with an explanatory note.",
        ),
        maxLength: 2048,
      },
    },
    ["provider"],
    "Selects which model handles a turn. Defaults to `demo` when omitted.",
  ),
  Decision: object(
    {
      proposal: ref(
        "Proposal",
        "Updated proposal after applying the decision.",
      ),
      state: ref("ConversationState", "Full updated conversation state."),
    },
    ["proposal", "state"],
    "Outcome of approving or declining a proposal.",
  ),
  SignIn: object(
    {
      url: str(
        "URL to open for consent. For browsers: the Company's consent page. For apps: a single-use agent link to open in `ASWebAuthenticationSession` (or equivalent).",
      ),
      expiresAt: int(
        "Unix timestamp (ms) when an app sign-in link expires (3 minutes).",
      ),
      endUrl: str(
        "Fixed callback completion URL an app watches for (`?result=done` or `?result=failed`).",
      ),
    },
    ["url"],
    "Details for launching a Company OAuth sign-in flow. The agent never sees the user's password; final status arrives on the SSE event stream.",
  ),
  AgentEvent: {
    type: "object",
    description:
      "One Server-Sent Event payload. `type` matches the SSE `event:` field; the initial event is always `state`.",
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
        description: "Event type and SSE event name.",
      },
      state: ref(
        "ConversationState",
        "Present on `state` and `messages.replaced`.",
      ),
      message: ref("AgentMessage", "Present on `message`."),
      company: ref(
        "CompanyRef",
        "Present on `signin.*`, `access.lost`, `signout`, and `company.*`.",
      ),
      proposal: ref("Proposal", "Present on `proposal.*`."),
      keptUntil: int(
        "Unix timestamp (ms) until an ended conversation is purged. Present on `conversation.ended`.",
      ),
      code: {
        type: "string",
        enum: ["invalid_token", "session_revoked"],
        description:
          "Present on `session.ended`: `invalid_token` means refresh the access token and reconnect; `session_revoked` means sign in again.",
      },
    },
    required: ["type"],
  },
  Error: object(
    {
      code: str(
        "Stable machine-readable error code for programmatic handling.",
      ),
      error: str("Plain-language error message safe to show to the user."),
    },
    ["error"],
    "Standard error envelope returned on 4xx and 5xx responses.",
  ),
  Passkey: object(
    {
      id: str("Unique passkey identifier within the account."),
      name: str("Device description captured when the passkey was registered."),
      created: int("Unix timestamp (ms) when the passkey was added."),
      lastUsed: int(
        "Unix timestamp (ms) when the passkey was last used to sign in.",
      ),
      synced: bool(
        "`true` when the authenticator reports multi-device passkey backup.",
      ),
    },
    ["id", "name", "created", "synced"],
    "Metadata for a WebAuthn passkey registered on an account. Public keys are never returned.",
  ),
  Account: object(
    {
      id: str("Opaque account identifier."),
      label: str("Optional user-chosen label for the account."),
      created: int("Unix timestamp (ms) when the account was created."),
      passkeys: array(ref("Passkey"), "Passkeys registered on this account."),
      channels: array(
        object(
          {
            channel: str("Linked external channel name."),
            linked: int("Unix timestamp (ms) when the channel was linked."),
          },
          ["channel", "linked"],
        ),
        "External channels linked via one-time link codes.",
      ),
      session: str("Session ID authenticating the current request."),
      unclaimed: int(
        "Browser-only count of anonymous pre-sign-in conversations available to claim.",
      ),
    },
    ["id", "created", "passkeys", "channels", "session"],
    "An anonymous passkey-backed agent account. Holds no email or password.",
  ),
  SessionTokens: object(
    {
      session: str("Device session identifier."),
      accessToken: str(
        "Short-lived bearer token (~15 min). Send in `Authorization: Bearer <token>`.",
      ),
      accessTokenExpiresAt: int(
        "Unix timestamp (ms) when `accessToken` expires.",
      ),
      refreshToken: str(
        "Single-use rotating refresh token. Reusing a spent token revokes the entire session.",
      ),
      refreshTokenExpiresAt: int(
        "Unix timestamp (ms) when `refreshToken` expires.",
      ),
    },
    undefined,
    "Bearer and rotating refresh tokens issued to native client apps. Store in the OS keychain; never log or place in URLs.",
  ),
  SignedIn: object(
    {
      account: ref("Account", "The authenticated account."),
      tokens: ref(
        "SessionTokens",
        "Returned only to native apps (requests without an `Origin` header); browsers receive an `HttpOnly` cookie.",
      ),
    },
    ["account"],
    "Returned after creating an account or signing in with a passkey.",
  ),
  CreationOptions: object(
    {
      ceremony: opaqueIdString(
        "Opaque single-use ceremony ID to echo back within 5 minutes.",
      ),
      options: {
        type: "object",
        description:
          "WebAuthn `PublicKeyCredentialCreationOptionsJSON` for `navigator.credentials.create`.",
      },
    },
    undefined,
    "Challenge and WebAuthn creation options for registering a new passkey.",
  ),
  RequestOptions: object(
    {
      ceremony: opaqueIdString(
        "Opaque single-use ceremony ID to echo back within 5 minutes.",
      ),
      options: {
        type: "object",
        description:
          "Discoverable WebAuthn `PublicKeyCredentialRequestOptionsJSON` for `navigator.credentials.get`.",
      },
    },
    undefined,
    "Challenge and WebAuthn request options for usernameless passkey sign-in.",
  ),
  RegistrationCredential: object(
    {
      id: { ...str("Credential ID in base64url."), maxLength: 2048 },
      rawId: { ...str("Credential raw ID in base64url."), maxLength: 2048 },
      type: { type: "string", enum: ["public-key"] },
      authenticatorAttachment: {
        type: ["string", "null"],
        enum: ["cross-platform", "platform", null],
        description: "Authenticator attachment, when the platform reports it.",
      },
      clientExtensionResults: {
        type: "object",
        additionalProperties: true,
        description:
          "WebAuthn client extension results. Optional; omitted means an empty object.",
      },
      response: object(
        {
          clientDataJSON: {
            ...str("Base64url client data JSON."),
            maxLength: 16000,
          },
          attestationObject: {
            ...str("Base64url attestation object."),
            maxLength: 16000,
          },
          transports: {
            type: "array",
            items: { type: "string", maxLength: 32 },
            maxItems: 16,
            description: "Authenticator transports reported by the platform.",
          },
          publicKey: {
            ...str("Base64url credential public key, when supplied."),
            maxLength: 16000,
          },
          publicKeyAlgorithm: int(
            "COSE algorithm identifier, when supplied by the platform.",
          ),
        },
        ["clientDataJSON", "attestationObject"],
      ),
    },
    ["id", "rawId", "type", "response"],
    "WebAuthn registration response returned after creating a passkey.",
  ),
  AuthenticationCredential: object(
    {
      id: { ...str("Credential ID in base64url."), maxLength: 2048 },
      rawId: { ...str("Credential raw ID in base64url."), maxLength: 2048 },
      type: { type: "string", enum: ["public-key"] },
      authenticatorAttachment: {
        type: ["string", "null"],
        enum: ["cross-platform", "platform", null],
        description: "Authenticator attachment, when the platform reports it.",
      },
      clientExtensionResults: {
        type: "object",
        additionalProperties: true,
        description:
          "WebAuthn client extension results. Optional; omitted means an empty object.",
      },
      response: object(
        {
          clientDataJSON: {
            ...str("Base64url client data JSON."),
            maxLength: 16000,
          },
          authenticatorData: {
            ...str("Base64url authenticator data."),
            maxLength: 16000,
          },
          signature: {
            ...str("Base64url authenticator signature."),
            maxLength: 16000,
          },
          userHandle: {
            type: ["string", "null"],
            maxLength: 2048,
            description: "Discoverable credential user handle, when supplied.",
          },
        },
        ["clientDataJSON", "authenticatorData", "signature"],
      ),
    },
    ["id", "rawId", "type", "response"],
    "WebAuthn authentication response returned after proving a passkey.",
  ),
  PasskeyAnswer: object(
    {
      ceremony: opaqueIdString(
        "Ceremony ID received from the corresponding `/options` call.",
      ),
      credential: {
        oneOf: [ref("RegistrationCredential"), ref("AuthenticationCredential")],
        description:
          "Authenticator response (`RegistrationResponseJSON` or `AuthenticationResponseJSON`).",
      },
      device: str(
        'Optional device label shown in the sessions list (e.g. "iPhone" or "Chrome on macOS").',
      ),
    },
    ["ceremony", "credential"],
    "Completes a passkey registration or sign-in ceremony.",
  ),
  Session: object(
    {
      id: str("Unique device session identifier."),
      kind: {
        type: "string",
        enum: ["browser", "app"],
        description: "`browser` (cookie-backed) or `app` (token-backed).",
      },
      device: str("Device description recorded at sign-in."),
      created: int("Unix timestamp (ms) when the session started."),
      lastUsed: int("Unix timestamp (ms) of the last authenticated request."),
      expires: int("Unix timestamp (ms) when the session expires."),
      current: bool("`true` for the session authenticating this request."),
    },
    undefined,
    "An active device session signed in to an account.",
  ),
  LinkCode: object(
    {
      code: str("Formatted 8-character one-time code to enter in the channel."),
      expiresAt: int("Unix timestamp (ms) when the code expires (5 minutes)."),
    },
    undefined,
    "Single-use code linking an external messaging channel to an account.",
  ),
};

const json = (schema: Schema) => ({
  content: { "application/json": { schema } },
});
const retryHeader = {
  "Retry-After": {
    description: "Number of seconds to wait before retrying.",
    schema: string,
  },
};
const errors = {
  "400": {
    description: "Invalid request payload or precondition failed.",
    ...json(ref("Error")),
  },
  "403": {
    description: "Cross-origin browser request rejected.",
    ...json(ref("Error")),
  },
  "404": {
    description: "Conversation not found for this caller.",
    ...json(ref("Error")),
  },
  "409": {
    description:
      "Conversation is busy with another request, or the Company cannot be added.",
    ...json(ref("Error")),
  },
  "410": {
    description: "Conversation has ended and is now read-only.",
    ...json(ref("Error")),
  },
};
const accountErrors = {
  "400": errors["400"],
  "401": {
    description:
      "Authentication required, or the access token has expired or been revoked.",
    ...json(ref("Error")),
  },
  "403": errors["403"],
  "429": {
    description: "Rate limit exceeded. Retry after the `Retry-After` delay.",
    headers: retryHeader,
    ...json(ref("Error")),
  },
};
const ok = (description: string, schema: Schema, status = "200") => ({
  [status]: { description, ...json(schema) },
});
const counted = object({ revoked: int("Number of sessions revoked.") }, [
  "revoked",
]);
const conversationId: Schema = {
  type: "string",
  pattern: "^[A-Za-z0-9_-]{16,64}$",
};
const operationId = operationIdString();
const signInTicket: Schema = {
  type: "string",
  pattern: "^[A-Za-z0-9_-]{43}$",
};
const id = {
  name: "id",
  in: "path",
  required: true,
  schema: conversationId,
  description: "Conversation ID.",
};
const body = (schema: Schema) => ({ required: true, ...json(schema) });
/**
 * A turn's answers: the result, or with `Accept: text/event-stream` the
 * agent's sentences as they are written and then the result.
 */
const turnResponses = (done: string) => ({
  "200": {
    description: `${done} As JSON, the \`TurnResult\`. With \`Accept: text/event-stream\`, Server-Sent Events (\`TurnEvent\`): one \`message.delta\` per sentence of the agent's as it is written, then \`turn\` with the same result, or \`error\`. A request refused before anything was said is answered as without the header, with its status and an \`Error\`.`,
    content: {
      "application/json": { schema: ref("TurnResult") },
      "text/event-stream": { schema: ref("TurnEvent") },
    },
  },
  ...errors,
});

const tags = [
  {
    name: "Conversations",
    description:
      "Create and interact with conversations across up to three connected Companies. Each turn returns newly added messages alongside the updated `ConversationState`.",
  },
  {
    name: "Company sign-ins",
    description:
      "Authenticate a user directly on a Company's own consent page without exposing credentials to the agent. Final outcomes arrive over the SSE event stream.",
  },
  {
    name: "Events",
    description:
      "Real-time Server-Sent Events stream delivering sign-in outcomes and the questions after them, proposal updates, cross-device activity, and a Company's Direct Conversation messages once a request has read them.",
  },
  {
    name: "Accounts",
    description:
      "Create passwordless, passkey-backed agent accounts and inspect or claim conversations across devices.",
  },
  {
    name: "Sessions",
    description:
      "Authenticate devices with discoverable WebAuthn passkeys and rotate short-lived bearer and refresh tokens.",
  },
  {
    name: "Passkeys",
    description:
      "Register additional WebAuthn passkeys on an account or remove compromised ones (ending every session they started).",
  },
  {
    name: "Devices",
    description:
      "List active browser and app sessions (up to 25 per account) and revoke one or all devices.",
  },
  {
    name: "Channels",
    description:
      "Link external messaging channels to an account using short-lived, single-use codes.",
  },
  {
    name: "Schema",
    description: "Machine-readable OpenAPI 3.1 contract for `/api/v1`.",
  },
];

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Personal Agent API",
      version: "1.0.0",
      description:
        "HTTP API for building clients on top of the Personal Agent over Personal Agent Protocol (Poppy 1.0): multi-company conversations, quick replies, Operations v3 approval workflows, Company OAuth sign-in, real-time SSE events, and passkey-backed multi-device accounts. Browser clients authenticate via same-origin cookies; native apps send no `Origin` header and authenticate with `Authorization: Bearer <accessToken>`.",
    },
    servers: [{ url: "/" }],
    tags,
    paths: {
      "/api/v1/conversations": {
        post: {
          tags: ["Conversations"],
          operationId: "startConversation",
          summary: "Start a conversation",
          description:
            "Creates an empty conversation, or connects an initial Company signed out when `company` is provided.",
          requestBody: body(
            object(
              {
                company: str(
                  "Optional Company origin URL to discover and connect immediately.",
                ),
              },
              [],
            ),
          ),
          responses: {
            "201": {
              description: "Conversation created.",
              ...json(ref("ConversationState")),
            },
            "422": {
              description: "Company discovery failed.",
              ...json(ref("Error")),
            },
            ...errors,
          },
        },
      },
      "/api/v1/pending": {
        get: {
          tags: ["Conversations"],
          operationId: "listPending",
          summary: "List what waits for the user",
          description:
            "Lists everything that waits for the user across their running conversations, newest conversation first: proposals to approve or decline, sign-ins to finish or do again, and questions the agent asked. For an inbox: open the item's `conversation` to act on it there. Ended conversations, and decided, answered or expired items, are left out.",
          responses: {
            "200": {
              description: "What waits, possibly nothing.",
              ...json(
                object({
                  items: array(ref("PendingItem"), "What waits, in order."),
                }),
              ),
            },
            "403": {
              description: "The agent is disabled on this deployment.",
              ...json(ref("Error")),
            },
          },
        },
      },
      "/api/v1/conversations/{id}": {
        get: {
          tags: ["Conversations"],
          operationId: "getConversation",
          summary: "Retrieve a conversation",
          description:
            "Returns the current `ConversationState`, including connected Companies, transcript messages, and all proposals.",
          parameters: [id],
          responses: {
            "200": {
              description: "Current conversation state.",
              ...json(ref("ConversationState")),
            },
            "404": errors["404"],
          },
        },
      },
      "/api/v1/conversations/{id}/messages": {
        post: {
          tags: ["Conversations"],
          operationId: "sendMessage",
          summary: "Send a message",
          description:
            "Submits a user message and runs one agent turn. If `company` is omitted in a multi-company conversation, the agent routes automatically or replies with disambiguation `choices`.",
          parameters: [id],
          requestBody: body(
            object(
              {
                text: {
                  ...str("User message text."),
                  maxLength: 2000,
                },
                company: str(
                  "Optional target Company origin URL to scope this turn.",
                ),
                model: ref(
                  "ModelChoice",
                  "Model configuration for this turn. Defaults to `demo`.",
                ),
              },
              ["text"],
            ),
          ),
          responses: turnResponses("Turn completed."),
        },
      },
      "/api/v1/conversations/{id}/answers": {
        post: {
          tags: ["Conversations"],
          operationId: "answerChoice",
          summary: "Submit a quick-reply answer",
          description:
            "Submits the structured `answer` payload from a previous message's `Choice` without free-text parsing.",
          parameters: [id],
          requestBody: body(
            object(
              {
                answer: ref("Answer", "Exact `answer` object from a `Choice`."),
                model: ref(
                  "ModelChoice",
                  "Model configuration if the choice triggers a turn.",
                ),
              },
              ["answer"],
            ),
          ),
          responses: turnResponses("Answer applied."),
        },
      },
      "/api/v1/conversations/{id}/proposals/{proposal}/decision": {
        post: {
          tags: ["Conversations"],
          operationId: "decideProposal",
          summary: "Approve or decline a proposal",
          description:
            "Approves or declines a pending Operations v3 proposal. Approvals bind strictly to `revision` and execute at most once. A decline is kept by the agent; nothing is sent to the Company. If the Company answers the approval with other terms, nothing is performed: the answer is 409 `terms_changed`, and the proposal waits again at a new `revision` (or, when the Company gave the new terms another ID, this one becomes `superseded` and a new proposal waits).",
          parameters: [
            id,
            {
              name: "proposal",
              in: "path",
              required: true,
              schema: operationId,
              description: "Proposal (operation) ID.",
            },
          ],
          requestBody: body(
            object({
              company: str("Origin URL of the Company holding the proposal."),
              revision: operationIdString(
                "Exact `revision` token from the proposal shown to the user.",
              ),
              decision: {
                type: "string",
                enum: ["approve", "decline"],
                description: "User decision (`approve` or `decline`).",
              },
            }),
          ),
          responses: {
            "200": {
              description: "Decision recorded.",
              ...json(ref("Decision")),
            },
            ...errors,
            "409": {
              description:
                "Another request holds the conversation, or the Company answered the approval with other terms (`terms_changed`): nothing was performed.",
              ...json(ref("Error")),
            },
            "410": {
              description:
                "The conversation has ended (`conversation_ended`), or the proposal expired or was already decided (`proposal_expired`).",
              ...json(ref("Error")),
            },
          },
        },
      },
      "/api/v1/conversations/{id}/sign-ins": {
        post: {
          tags: ["Company sign-ins"],
          operationId: "startSignIn",
          summary: "Start a Company sign-in",
          description:
            "Initiates Direct Sign-In (§4.2) at a connected Company. Browser callers receive the Company's consent URL; bearer-authenticated apps receive a single-use agent link (`SignIn.url`) to open in an in-app browser session. Completion emits `signin.completed` or `signin.failed` on the event stream.",
          parameters: [id],
          requestBody: body(
            object(
              {
                company: str("Origin URL of the connected Company."),
                access: {
                  type: "string",
                  enum: ["read", "write"],
                  description:
                    "Permission tier to request (`read` default, or `write` to propose changes).",
                },
              },
              ["company"],
            ),
          ),
          responses: {
            "200": {
              description: "Sign-in launch details.",
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
          tags: ["Company sign-ins"],
          operationId: "openSignInLink",
          summary: "Open an app sign-in link",
          description:
            "Opened by a native app's browser (`SignIn.url`). Consumes the one-time 3-minute ticket, binds the OAuth state to that browser via cookie, and redirects to the Company's consent page. Expired, reused, revoked-session, or mismatched-account tickets redirect to `endUrl?result=failed`.",
          parameters: [
            {
              name: "ticket",
              in: "path",
              required: true,
              schema: signInTicket,
              description: "One-time ticket from `SignIn.url`.",
            },
          ],
          responses: {
            "303": {
              description:
                "Redirects to the Company's consent page, or to `endUrl?result=failed`.",
              headers: {
                Location: {
                  description: "Redirect destination URL.",
                  schema: string,
                },
              },
            },
          },
        },
      },
      "/api/v1/conversations/{id}/events": {
        get: {
          tags: ["Events"],
          operationId: "conversationEvents",
          summary: "Stream conversation events",
          description:
            "Opens a Server-Sent Events stream starting with `state`, followed by incremental changes polled every 2 seconds. Closes automatically after 5 minutes or when the conversation ends; reconnect and resync from `state`. Signed-in streams emit `session.ended` if the session or access token becomes invalid. Concurrency is capped at 10 open streams per account (4 per anonymous visitor, `too_many_streams`).",
          parameters: [id],
          responses: {
            "200": {
              description:
                "SSE stream (`text/event-stream`); each `data` payload is an `AgentEvent`.",
              content: { "text/event-stream": { schema: ref("AgentEvent") } },
            },
            "404": errors["404"],
            "429": accountErrors["429"],
          },
        },
      },
      ...accountPaths(),
      "/api/v1/openapi.json": {
        get: {
          tags: ["Schema"],
          operationId: "getOpenApi",
          summary: "Retrieve the OpenAPI schema",
          description: "Returns this OpenAPI 3.1.0 specification as JSON.",
          responses: {
            "200": {
              description: "OpenAPI 3.1.0 document.",
              ...json({ type: "object" }),
            },
          },
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        apiSession: {
          type: "http",
          scheme: "bearer",
          description:
            "Short-lived access token from `SessionTokens` (`Authorization: Bearer <accessToken>`). Browser clients on the playground's origin authenticate with `HttpOnly` cookies instead.",
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
  schema: opaqueIdString(),
  description: "Passkey ID from `Account.passkeys`.",
};
const sessionId = {
  name: "session",
  in: "path",
  required: true,
  schema: opaqueIdString(),
  description: "Device session ID from `GET /api/v1/account/sessions`.",
};

/** The agent account's routes (`agent-account-http.ts`). */
function accountPaths() {
  return {
    "/api/v1/accounts/options": {
      post: {
        tags: ["Accounts"],
        operationId: "accountOptions",
        summary: "Create registration options",
        description:
          "Starts passkey account creation. Returns WebAuthn options (discoverable, user verification required, no attestation) and a single-use ceremony ID valid for 5 minutes.",
        requestBody: body(
          object(
            {
              label: str("Optional user-chosen display label for the account."),
            },
            [],
          ),
        ),
        responses: {
          ...ok(
            "WebAuthn creation options and ceremony ID.",
            ref("CreationOptions"),
          ),
          ...accountErrors,
        },
      },
    },
    "/api/v1/accounts": {
      post: {
        tags: ["Accounts"],
        operationId: "createAccount",
        summary: "Create an account",
        description:
          "Verifies the passkey registration response, creates the account, and starts a signed-in session for the calling device.",
        requestBody: answerBody,
        responses: {
          ...ok("Account created and signed in.", ref("SignedIn"), "201"),
          ...accountErrors,
        },
      },
    },
    "/api/v1/account": {
      get: {
        tags: ["Accounts"],
        operationId: "getAccount",
        summary: "Retrieve the current account",
        description:
          "Returns the account, passkeys, linked channels, and current session ID for the authenticated device.",
        security: bearer,
        responses: {
          ...ok("Authenticated account.", ref("Account")),
          "401": accountErrors["401"],
        },
      },
    },
    "/api/v1/account/claim": {
      post: {
        tags: ["Accounts"],
        operationId: "claimConversations",
        summary: "Claim browser conversations",
        description:
          "Browser-only. Moves anonymous pre-sign-in conversations from the visitor cookie into the signed-in account so they sync across devices. Busy conversations stay behind and are counted in `skipped`.",
        requestBody: body(object({}, [])),
        responses: {
          ...ok(
            "Migration counts and updated account.",
            object({
              moved: int("Number of conversations moved into the account."),
              skipped: int("Number of busy conversations left unclaimed."),
              account: ref("Account", "Updated account state."),
            }),
          ),
          ...accountErrors,
        },
      },
    },
    "/api/v1/sessions/options": {
      post: {
        tags: ["Sessions"],
        operationId: "signInOptions",
        summary: "Create sign-in options",
        description:
          "Starts usernameless passkey sign-in. Returns WebAuthn request options and a single-use ceremony ID valid for 5 minutes.",
        requestBody: body(object({}, [])),
        responses: {
          ...ok(
            "WebAuthn request options and ceremony ID.",
            ref("RequestOptions"),
          ),
          ...accountErrors,
        },
      },
    },
    "/api/v1/sessions": {
      post: {
        tags: ["Sessions"],
        operationId: "signIn",
        summary: "Sign in with a passkey",
        description:
          "Verifies a passkey assertion and starts a new device session. Returns `SessionTokens` to native apps or sets an `HttpOnly` cookie for browsers.",
        requestBody: answerBody,
        responses: {
          ...ok("Signed in.", ref("SignedIn"), "201"),
          ...accountErrors,
        },
      },
    },
    "/api/v1/sessions/refresh": {
      post: {
        tags: ["Sessions"],
        operationId: "refreshSession",
        summary: "Refresh session tokens",
        description:
          "Exchanges a native app's refresh token for a fresh access and refresh token pair. Each refresh token is single-use; replaying a spent token revokes the entire session (`session_revoked`).",
        requestBody: body(
          object({
            refreshToken: {
              ...str("Current refresh token from `SessionTokens`."),
              maxLength: 200,
              pattern:
                "^poppy_rt\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}$",
            },
          }),
        ),
        responses: {
          ...ok("Rotated token pair.", ref("SessionTokens")),
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/passkeys/options": {
      post: {
        tags: ["Passkeys"],
        operationId: "passkeyOptions",
        summary: "Create passkey options",
        description:
          "Starts adding a new passkey to the authenticated account. Accounts hold up to 10 passkeys.",
        security: bearer,
        requestBody: body(object({}, [])),
        responses: {
          ...ok(
            "WebAuthn creation options and ceremony ID.",
            ref("CreationOptions"),
          ),
          "409": {
            description:
              "Account already holds the maximum number of passkeys.",
            ...json(ref("Error")),
          },
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/passkeys": {
      post: {
        tags: ["Passkeys"],
        operationId: "addPasskey",
        summary: "Add a passkey",
        description:
          "Verifies the WebAuthn registration response and attaches the new passkey to the account.",
        security: bearer,
        requestBody: answerBody,
        responses: {
          ...ok(
            "Passkey registered.",
            object({
              passkey: ref("Passkey", "Newly added passkey."),
              account: ref("Account", "Updated account state."),
            }),
            "201",
          ),
          "409": {
            description: "Passkey is already registered on this account.",
            ...json(ref("Error")),
          },
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/passkeys/{passkey}": {
      delete: {
        tags: ["Passkeys"],
        operationId: "removePasskey",
        summary: "Remove a passkey",
        description:
          "Deletes a passkey and immediately revokes every session started with it (including the current one). Fails with `409 last_passkey` if it is the account's only remaining passkey.",
        security: bearer,
        parameters: [passkeyId],
        responses: {
          ...ok("Passkey removed.", ref("Account")),
          "404": {
            description: "Passkey not found on this account.",
            ...json(ref("Error")),
          },
          "409": {
            description: "Cannot remove the account's last remaining passkey.",
            ...json(ref("Error")),
          },
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/sessions": {
      get: {
        tags: ["Devices"],
        operationId: "listSessions",
        summary: "List active sessions",
        description:
          "Returns all active device sessions ordered by most recently used. Accounts keep up to 25 sessions; signing in on a 26th device evicts the least recently used session.",
        security: bearer,
        responses: {
          ...ok(
            "Active device sessions.",
            object({
              sessions: array(ref("Session"), "Active sessions, newest first."),
            }),
          ),
          "401": accountErrors["401"],
        },
      },
      delete: {
        tags: ["Devices"],
        operationId: "revokeAllSessions",
        summary: "Revoke all sessions",
        description:
          "Signs out every device on the account, including the device making this request.",
        security: bearer,
        responses: {
          ...ok("All sessions revoked.", counted),
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/sessions/{session}": {
      delete: {
        tags: ["Devices"],
        operationId: "revokeSession",
        summary: "Revoke a session",
        description:
          "Signs out a single device session without affecting other signed-in devices.",
        security: bearer,
        parameters: [sessionId],
        responses: {
          ...ok("Session revoked.", counted),
          "404": {
            description: "Session not found on this account.",
            ...json(ref("Error")),
          },
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/sign-out": {
      post: {
        tags: ["Devices"],
        operationId: "signOut",
        summary: "Sign out the current device",
        description:
          "Revokes the calling device's session (and clears the browser cookie) while leaving other devices signed in.",
        security: bearer,
        requestBody: body(object({}, [])),
        responses: {
          ...ok("Current device signed out.", counted),
          ...accountErrors,
        },
      },
    },
    "/api/v1/account/link-codes": {
      post: {
        tags: ["Channels"],
        operationId: "createLinkCode",
        summary: "Create a channel link code",
        description:
          "Issues an 8-character single-use code valid for 5 minutes. Entering it in a supported channel links that channel user to this account.",
        security: bearer,
        requestBody: body(object({}, [])),
        responses: {
          ...ok("Link code created.", ref("LinkCode"), "201"),
          ...accountErrors,
        },
      },
    },
    "/api/v1/link-codes/redeem": {
      post: {
        tags: ["Channels"],
        operationId: "redeemLinkCode",
        summary: "Redeem a channel link code",
        description:
          "Called by a configured external channel backend (using its channel authentication) to redeem a user's one-time code and link the channel user ID to the account.",
        requestBody: body(
          object({
            channel: {
              ...str("Configured external channel identifier."),
              maxLength: 32,
            },
            user: {
              ...str("User identifier within that channel."),
              minLength: 1,
              maxLength: 256,
            },
            code: {
              ...str("8-character one-time link code provided by the user."),
              maxLength: 32,
            },
          }),
        ),
        responses: {
          ...ok(
            "Channel linked.",
            object({
              account: str("Linked agent account ID."),
              linked: bool("Always `true` on success."),
            }),
          ),
          ...accountErrors,
        },
      },
    },
  };
}

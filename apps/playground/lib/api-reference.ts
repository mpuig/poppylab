/**
 * The agent's API as /developers/api shows it, read from its OpenAPI
 * document (`openApiDocument` in pap-agent, the same document
 * `/api/v1/openapi.json` serves and `packages/pap-agent/openapi.json`
 * holds). Nothing about an operation or a type is written here: the page
 * lists what the document has, so a route added to the document is on the
 * page at the next build, and one removed from it is gone.
 *
 * What is written here is what the document has no place for: a title
 * for each group of operations when the document gives them no tags, what
 * each event means, and the error codes a client acts on, each held to the
 * core's own source by `api-reference.test.ts`.
 */
import type { AgentEventType } from "@poppy-lab/pap-agent/api-events";
import { openApiDocument } from "@poppy-lab/pap-agent/openapi";

export type Schema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  oneOf?: Schema[];
  description?: string;
};

type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
  description?: string;
};
type Content = Record<string, { schema?: Schema }>;
type RawOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  security?: Record<string, string[]>[];
  requestBody?: { required?: boolean; content?: Content };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Content;
      headers?: Record<string, { schema?: Schema; description?: string }>;
    }
  >;
};
export type ApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, Schema>;
    securitySchemes?: Record<
      string,
      { type: string; scheme?: string; description?: string }
    >;
  };
};

export type Body = { type: string; schema: Schema };
export type Answer = {
  status: string;
  description: string;
  body?: Body;
  headers: { name: string; description?: string }[];
};
export type Operation = {
  id: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  parameters: Parameter[];
  security: string[];
  body?: Body;
  answers: Answer[];
};
export type Group = {
  id: string;
  title: string;
  intro?: string;
  operations: Operation[];
};

const METHODS = ["get", "put", "post", "patch", "delete", "head", "options"];

/**
 * A title for the operations of each part of `/api/v1`, by path, for a
 * document whose operations have no tags. The first that matches wins, and
 * an operation none matches is still listed, under "Other operations".
 */
const GROUPS: {
  id: string;
  title: string;
  intro?: string;
  match: (path: string) => boolean;
}[] = [
  {
    id: "conversations",
    title: "Conversations",
    intro:
      "A conversation holds up to three Companies, everything said in it and every proposal. A turn answers the messages it added and the conversation as it is after them.",
    match: (p) =>
      p.startsWith("/api/v1/conversations") &&
      !p.endsWith("/sign-ins") &&
      !p.endsWith("/events"),
  },
  {
    id: "sign-ins",
    title: "Signing in to a Company",
    intro:
      "The person signs in on the Company's own page, never in the agent. The answer says what to open, and the events say how it went.",
    match: (p) => p.includes("/sign-ins"),
  },
  {
    id: "events",
    title: "Events",
    intro:
      "What happens after a turn has answered: a sign-in finished in the browser, a proposal ran out, a Company wrote in a Direct Conversation.",
    match: (p) => p.endsWith("/events"),
  },
  {
    id: "accounts",
    title: "Creating an account",
    intro:
      "An agent account is an opaque ID and its passkeys. Each ceremony is two requests: the WebAuthn options, then the authenticator's answer to them.",
    match: (p) => p.startsWith("/api/v1/accounts"),
  },
  {
    id: "sessions",
    title: "Signing in and refreshing",
    intro:
      "Each device signed in to the account has a session of its own. A client app's is an access token and a refresh token.",
    match: (p) => p.startsWith("/api/v1/sessions"),
  },
  {
    id: "passkeys",
    title: "Passkeys",
    match: (p) => p.startsWith("/api/v1/account/passkeys"),
  },
  {
    id: "devices",
    title: "Devices",
    match: (p) =>
      p.startsWith("/api/v1/account/sessions") ||
      p === "/api/v1/account/sign-out",
  },
  {
    id: "channels",
    title: "Channels",
    intro:
      "A channel, such as a messaging app, is linked to an account with a one-time code the person types there.",
    match: (p) => p.includes("/link-codes"),
  },
  {
    id: "account",
    title: "The account",
    match: (p) => p.startsWith("/api/v1/account"),
  },
  {
    id: "document",
    title: "The document",
    match: (p) => p === "/api/v1/openapi.json",
  },
];
const OTHER = { id: "other", title: "Other operations" };

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The anchor of a type in `components.schemas`. */
export const typeAnchor = (name: string) => `type-${name}`;
/** The anchor of an event type. */
export const eventAnchor = (type: string) => `event-${slug(type)}`;

/** `{ body }` for the first of a content map's types, or nothing. */
const bodyOf = (content: Content | undefined): { body?: Body } => {
  const [type, value] = Object.entries(content ?? {})[0] ?? [];
  return type && value?.schema ? { body: { type, schema: value.schema } } : {};
};

/** Every operation of the document, in its order. */
export function operations(document: ApiDocument): Operation[] {
  return Object.entries(document.paths).flatMap(([path, item]) => {
    const shared = (item.parameters as Parameter[] | undefined) ?? [];
    return METHODS.filter((m) => m in item).map((method) => {
      const op = item[method] as RawOperation;
      const id = op.operationId ?? slug(`${method} ${path}`);
      return {
        id,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? "",
        ...(op.description ? { description: op.description } : {}),
        parameters: [...shared, ...(op.parameters ?? [])],
        security: (op.security ?? []).flatMap((s) => Object.keys(s)),
        ...bodyOf(op.requestBody?.content),
        // Successes first, then the refusals, each in the order of its status.
        answers: Object.entries(op.responses ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([status, answer]) => ({
            status,
            description: answer.description ?? "",
            ...bodyOf(answer.content),
            headers: Object.entries(answer.headers ?? {}).map(
              ([name, header]) => ({
                name,
                ...(header.description
                  ? { description: header.description }
                  : {}),
              }),
            ),
          })),
      };
    });
  });
}

/**
 * The operations in groups: by their first tag when the document tags
 * them, otherwise by the part of `/api/v1` they belong to.
 */
export function groups(document: ApiDocument): Group[] {
  const tags = new Map((document.tags ?? []).map((t) => [t.name, t]));
  const found = new Map<string, Group & { rank: number }>();
  operations(document).forEach((op, index) => {
    const raw = document.paths[op.path]![op.method.toLowerCase()] as {
      tags?: string[];
    };
    const tag = raw.tags?.[0];
    const rule = GROUPS.findIndex((g) => g.match(op.path));
    const head = tag
      ? {
          id: slug(tag),
          title: tag,
          ...(tags.get(tag)?.description
            ? { intro: tags.get(tag)!.description }
            : {}),
          rank: index,
        }
      : rule >= 0
        ? { ...GROUPS[rule]!, rank: rule - GROUPS.length * 1000 }
        : { ...OTHER, rank: Number.MAX_SAFE_INTEGER };
    const group = found.get(head.id) ?? {
      id: head.id,
      title: head.title,
      ...("intro" in head && head.intro ? { intro: head.intro } : {}),
      rank: head.rank,
      operations: [],
    };
    group.operations.push(op);
    found.set(head.id, group);
  });
  return [...found.values()]
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _, ...group }) => group);
}

/** A piece of a type as the page writes it. */
export type TypePart = { text: string } | { code: string } | { ref: string };

const refName = (schema: Schema) => schema.$ref?.split("/").at(-1);

/** A schema's type in a few words: `string`, `array of AgentMessage`, `"read" | "write"`. */
export function typeParts(schema: Schema): TypePart[] {
  const name = refName(schema);
  if (name) return [{ ref: name }];
  if (schema.enum)
    return schema.enum.flatMap((value, i) => [
      ...(i ? [{ text: " | " }] : []),
      { code: value === null ? "null" : JSON.stringify(value) },
    ]);
  if (schema.oneOf) return [{ text: "one of the shapes below" }];
  const types = [schema.type ?? []].flat();
  if (types.includes("array") && schema.items)
    return [{ text: "array of " }, ...typeParts(schema.items)];
  if (!types.length) return [{ text: "any value" }];
  return types.flatMap((type, i) => [
    ...(i ? [{ text: " or " }] : []),
    { code: type },
  ]);
}

export type Field = {
  name: string;
  required: boolean;
  type: TypePart[];
  description?: string;
  /** The members of an object written in place, or of each one in an array. */
  fields?: Field[];
};

/** The members of an object schema written in place, or none for any other. */
export function fields(schema: Schema): Field[] | undefined {
  const object = schema.items && !schema.items.$ref ? schema.items : schema;
  if (object.$ref || !object.properties) return undefined;
  const required = new Set(object.required ?? []);
  return Object.entries(object.properties).map(([name, member]) => {
    const inner = fields(member);
    return {
      name,
      required: required.has(name),
      type: typeParts(member),
      ...(member.description ? { description: member.description } : {}),
      ...(inner ? { fields: inner } : {}),
    };
  });
}

/** The type a `$ref` names, if the document has it. */
export const named = (document: ApiDocument, schema: Schema) => {
  const name = refName(schema);
  return name ? document.components.schemas[name] : undefined;
};

/** What an example writes in place of a value it leaves out. */
export const ELIDED = "…";

/**
 * Where `value` doesn't fit `schema`, as paths; none when it does. As the
 * route test checks real answers: every required member is there, every
 * member is described, and each one fits its own schema. A value an
 * example leaves out (`ELIDED`) fits anything.
 */
export function mismatches(
  document: ApiDocument,
  value: unknown,
  schema: Schema,
  at = "$",
): string[] {
  if (value === ELIDED) return [];
  const resolved = named(document, schema);
  if (schema.$ref)
    return resolved
      ? mismatches(document, value, resolved, at)
      : [`${at}: no type ${schema.$ref}`];
  if (schema.oneOf) {
    const fit = schema.oneOf.filter(
      (s) => !mismatches(document, value, s, at).length,
    );
    return fit.length === 1 ? [] : [`${at}: fits ${fit.length} of oneOf`];
  }
  if (schema.enum && !schema.enum.includes(value))
    return [`${at}: ${JSON.stringify(value)} not in enum`];
  const types = [schema.type ?? []].flat();
  const kind =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : Number.isInteger(value)
          ? "integer"
          : typeof value;
  if (
    types.length &&
    !types.includes(kind) &&
    !(kind === "integer" && types.includes("number"))
  )
    return [`${at}: ${kind}, not ${types.join(" or ")}`];
  if (kind === "array" && schema.items)
    return (value as unknown[]).flatMap((v, i) =>
      mismatches(document, v, schema.items!, `${at}[${i}]`),
    );
  if (kind === "object" && schema.properties) {
    const object = value as Record<string, unknown>;
    return [
      ...(schema.required ?? [])
        .filter((k) => !(k in object))
        .map((k) => `${at}.${k}: missing`),
      ...Object.entries(object).flatMap(([k, v]) =>
        schema.properties![k]
          ? mismatches(document, v, schema.properties![k]!, `${at}.${k}`)
          : [`${at}.${k}: not described`],
      ),
    ];
  }
  return [];
}

/**
 * What each event means and which of its members it carries. Typed by the
 * core's own `AgentEventType`, so an event the core adds doesn't build
 * until it is written here; the test holds the list to the document's.
 */
export const EVENT_NOTES = {
  state: {
    carries: ["state"],
    text: "Initial snapshot emitted when the stream opens. Every subsequent event describes a delta from this state.",
  },
  message: {
    carries: ["message"],
    text: "A new message appended by the user, agent, or Company.",
  },
  "messages.replaced": {
    carries: ["state"],
    text: "Earlier messages were withdrawn (for example, after losing access or disconnecting a Company). Replace your local transcript with `state.messages`.",
  },
  "signin.completed": {
    carries: ["company"],
    text: "The user completed OAuth consent at the Company.",
  },
  "signin.failed": {
    carries: ["company"],
    text: "A pending Company sign-in was declined, failed, or expired after 5 minutes. No grant changed.",
  },
  "access.lost": {
    carries: ["company"],
    text: "The Company rejected or revoked the stored grant. Prompt the user to sign in again.",
  },
  signout: {
    carries: ["company"],
    text: "The user signed out of the Company in this conversation.",
  },
  "proposal.created": {
    carries: ["proposal"],
    text: "A Company returned a new Operations v3 proposal awaiting user approval.",
  },
  "proposal.expired": {
    carries: ["proposal"],
    text: "The proposal passed `expiresAt` without approval. Nothing was executed.",
  },
  "proposal.replaced": {
    carries: ["proposal"],
    text: "The Company returned a fresh `revision` with updated terms that require new approval.",
  },
  "proposal.updated": {
    carries: ["proposal"],
    text: "The proposal moved to a terminal state (`succeeded`, `declined`, `refused`, or `uncertain`).",
  },
  "company.added": {
    carries: ["company"],
    text: "A Company was connected to the conversation.",
  },
  "company.removed": {
    carries: ["company"],
    text: "A Company was disconnected from the conversation.",
  },
  "conversation.ended": {
    carries: ["keptUntil"],
    text: "The conversation is now read-only and will be purged at `keptUntil`. The stream closes.",
  },
  "session.ended": {
    carries: ["code"],
    text: "The caller's session is no longer valid and the stream closed. On `invalid_token`, refresh the access token and reconnect; on `session_revoked`, sign in again.",
  },
} satisfies Record<AgentEventType, { carries: string[]; text: string }>;

/** The event types the document lists, each with its note when there is one. */
export function events(document: ApiDocument) {
  const schema = document.components.schemas.AgentEvent;
  const types = (schema?.properties?.type?.enum ?? []) as string[];
  return types.map((type) => ({
    type,
    ...((EVENT_NOTES as Record<string, { carries: string[]; text: string }>)[
      type
    ] ?? { carries: [], text: "" }),
  }));
}

/**
 * The error codes a client acts on. The document gives each answer's
 * status; these are the `code` members a client branches on. Each one is
 * a code the core answers (the test reads its source for it).
 */
export const ERROR_CODES = [
  [
    "invalid_token",
    "401",
    "Access token expired, rotated, or invalid. Call `POST /api/v1/sessions/refresh` and retry.",
  ],
  [
    "session_revoked",
    "401",
    "Device session ended (signed out, passkey removed, or refresh token reused). Sign in again with a passkey.",
  ],
  ["not_signed_in", "401", "Endpoint requires an authenticated agent account."],
  [
    "passkey_not_verified",
    "400",
    "WebAuthn verification failed. Returned uniformly whether the account or passkey exists.",
  ],
  [
    "ceremony_expired",
    "400",
    "WebAuthn ceremony expired (5-minute TTL) or was already consumed. Request fresh options.",
  ],
  [
    "rate_limited",
    "429",
    "Rate limit exceeded. Wait the number of seconds given in the `Retry-After` header.",
  ],
  [
    "too_many_streams",
    "429",
    "Open SSE stream limit reached (10 concurrent streams per signed-in account, or 4 per anonymous visitor).",
  ],
  [
    "last_passkey",
    "409",
    "Cannot delete the only remaining passkey on an account.",
  ],
  [
    "company_not_connected",
    "400",
    "The conversation does not have a Company connected at that origin.",
  ],
  ["conversation_ended", "410", "The conversation has ended and is read-only."],
] as const;

/** The API as the page shows it. */
export function apiReference(
  document: ApiDocument = openApiDocument() as ApiDocument,
) {
  return {
    document,
    groups: groups(document),
    events: events(document),
    types: Object.entries(document.components.schemas).map(
      ([name, schema]) => ({ name, schema }),
    ),
    schemes: Object.entries(document.components.securitySchemes ?? {}).map(
      ([name, scheme]) => ({ name, ...scheme }),
    ),
  };
}

/** Looks an operation up by its ID, for the guide's examples. */
export function operation(document: ApiDocument, id: string) {
  const found = operations(document).find((op) => op.id === id);
  if (!found) throw new Error(`The API has no operation ${id}.`);
  return found;
}

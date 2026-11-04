import { z } from "zod";

/**
 * The local example Companies (development only, plain HTTP): Juniper Market
 * and Lantern Noodle Bar. Nothing else may use the private-network exception.
 */
export const LOCAL_COMPANY_ORIGINS = [
  "http://juniper.localhost:4100",
  "http://noodles.localhost:4200",
] as const;
export const isLocalCompany = (origin: string) =>
  (LOCAL_COMPANY_ORIGINS as readonly string[]).includes(origin);

const httpsUrl = z
  .url()
  .max(2048)
  .refine(
    (value) => {
      const url = new URL(value);
      return (
        (url.protocol === "https:" ||
          (process.env.NODE_ENV === "development" &&
            process.env.PAP_ALLOW_PRIVATE_NETWORK === "true" &&
            isLocalCompany(url.origin))) &&
        !url.username &&
        !url.password &&
        !url.hash
      );
    },
    {
      message:
        "PAP protocol URLs require HTTPS without credentials or fragments",
    },
  );

const domain = z
  .string()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
    "Expected a domain name without scheme, port, or path",
  );

const scopeName = z.string().regex(/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/);
const scopeDescriptions = z.record(scopeName, z.string().max(1000));
const protocolEntry = z.object({
  type: z.string().min(1).max(64),
  endpoint: httpsUrl,
  access: z.string().max(64).optional(),
});

/** Draft 0.3 discovery document. Unknown fields are ignored by design. */
export const poppyDocument03Schema = z
  .object({
    protocol_version: z.literal("0.3"),
    organization: z.object({ name: z.string().min(1).max(200), domain }),
    auth: z
      .object({
        issuer: httpsUrl.optional(),
        // §3.2: the issuer serves other clients but offers Personal Agents no sign-in.
        disabled: z.boolean().optional(),
        scopes: scopeDescriptions.optional(),
        // Validated entry by entry in normalizeScopeHints: one malformed hint
        // must not discard the rest, and is never upgraded to a safe hint.
        scope_hints: z.record(scopeName, z.unknown()).optional(),
      })
      .optional(),
    agent: z.object({ protocols: z.array(protocolEntry).max(16) }).optional(),
    apis: z
      .array(
        z.object({
          type: z.string().min(1).max(64),
          url: httpsUrl,
          description: z.string().min(1).max(1000),
        }),
      )
      .max(32)
      .optional(),
    web: z.object({ browser_session_endpoint: httpsUrl.optional() }).optional(),
    feedback: z.object({ endpoint: httpsUrl }).optional(),
    excluded_tasks: z.object({ url: httpsUrl }).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((document, context) => {
    if (!document.agent && !document.apis && !document.web)
      context.addIssue({
        code: "custom",
        path: ["web"],
        message: "At least one of agent, apis, or web is required",
      });
  });

/** RFC 9728 protected resource metadata (fields this client uses). */
export const protectedResourceMetadataSchema = z.object({
  resource: httpsUrl,
  authorization_servers: z.array(httpsUrl).max(16).optional(),
});

export type ScopeHint = {
  changes: "none" | "reversible" | "irreversible";
  personal_data: boolean;
};
/**
 * Hints are Company claims, not approval. Entries missing a required field
 * are dropped (no hints); an unknown `changes` value becomes irreversible.
 */
export function normalizeScopeHints(
  value: Record<string, unknown> | undefined,
): Record<string, ScopeHint> {
  const hints: Record<string, ScopeHint> = {};
  for (const [scope, entry] of Object.entries(value ?? {}).slice(0, 128)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { changes, personal_data } = entry as Record<string, unknown>;
    if (typeof changes !== "string" || typeof personal_data !== "boolean")
      continue;
    hints[scope] = {
      changes:
        changes === "none" || changes === "reversible"
          ? changes
          : "irreversible",
      personal_data,
    };
  }
  return hints;
}

export const authorizationServerMetadataSchema = z.object({
  issuer: httpsUrl,
  token_endpoint: httpsUrl,
  revocation_endpoint: httpsUrl,
  protected_resources: z.array(httpsUrl).max(256).optional(),
  grant_types_supported: z.array(z.string().max(256)).max(32).optional(),
  scopes_supported: z.array(scopeName).max(256).optional(),
  authorization_endpoint: httpsUrl.optional(),
  device_authorization_endpoint: httpsUrl.optional(),
  dpop_signing_alg_values_supported: z.array(z.string()).optional(),
});

export const poppyDocumentSchema = poppyDocument03Schema;
export type PoppyDocument03 = z.infer<typeof poppyDocument03Schema>;
export type PoppyDocument = PoppyDocument03;
export type AuthorizationServerMetadata = z.infer<
  typeof authorizationServerMetadataSchema
>;

export type TraceStatus = "pending" | "active" | "passed" | "failed";

export interface DiscoveryTraceStep {
  id:
    "input" | "poppy" | "domain" | "resource" | "issuer" | "metadata" | "link";
  label: string;
  detail: string;
  status: TraceStatus;
  durationMs?: number;
}

/** Version-independent view used by clients instead of raw version fields. */
export interface CompanyProfile {
  version: "0.3";
  /** Issuer, or https://{domain} for a 0.3 Company without one. */
  identifier: string;
  issuer?: string;
  signIn: { direct: boolean; device: boolean };
  /** Scopes a Personal Agent may request; empty when none are advertised. */
  scopes: string[];
  scopeDescriptions: Record<string, string>;
  scopeHints: Record<string, ScopeHint>;
  excludedTasksUrl?: string;
}

export type AlternativeReference =
  | { type: "openapi"; url: string; operation_id: string }
  | { type: "mcp"; url: string; tool: string }
  | { type: "web"; url: string };
export type ExcludedTask = {
  task: string;
  alternative?: { instructions?: string; references: AlternativeReference[] };
};

/**
 * PAP 0.3 §9.1–9.2. Company content, never instructions to follow. API
 * references must name an API from the same poppy.json; web references are
 * kept only on the Company's own domain or its subdomains (conservative while
 * upstream issue #52 is open). Unknown fields and types are skipped.
 */
export function parseExcludedTasks(
  value: unknown,
  document: PoppyDocument03,
  /** Development-only plain-HTTP origins (the local example Company). */
  localOrigins: readonly string[] = [],
): ExcludedTask[] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { tasks?: unknown }).tasks)
  )
    throw new Error("Invalid excluded tasks document");
  const apis = document.apis ?? [];
  const domain = document.organization.domain.toLowerCase();
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  const https = (v: unknown) => {
    try {
      const url = new URL(String(v));
      return (url.protocol === "https:" || localOrigins.includes(url.origin)) &&
        !url.username &&
        !url.password
        ? url
        : undefined;
    } catch {
      return undefined;
    }
  };
  const tasks: ExcludedTask[] = [];
  for (const raw of (value as { tasks: unknown[] }).tasks.slice(0, 64)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const task = text(item.task, 200);
    if (!task) continue;
    const alt = item.alternative as Record<string, unknown> | undefined;
    const references: AlternativeReference[] = [];
    for (const ref of Array.isArray(alt?.references)
      ? alt.references.slice(0, 8)
      : []) {
      if (!ref || typeof ref !== "object") continue;
      const r = ref as Record<string, unknown>;
      const url = https(r.url);
      if (!url) continue;
      if (r.type === "web") {
        const host = url.hostname.toLowerCase();
        if (host === domain || host.endsWith(`.${domain}`))
          references.push({ type: "web", url: url.href });
      } else if (
        (r.type === "openapi" || r.type === "mcp") &&
        apis.some((api) => api.type === r.type && api.url === r.url)
      ) {
        const id = text(r.type === "openapi" ? r.operation_id : r.tool, 128);
        if (!id) continue;
        references.push(
          r.type === "openapi"
            ? { type: "openapi", url: String(r.url), operation_id: id }
            : { type: "mcp", url: String(r.url), tool: id },
        );
      }
    }
    const instructions = text(alt?.instructions, 2000);
    tasks.push({
      task,
      ...(instructions || references.length
        ? {
            alternative: {
              ...(instructions ? { instructions } : {}),
              references,
            },
          }
        : {}),
    });
  }
  return tasks;
}

/** The Company's normalized profile. */
export function companyProfile(company: {
  profile?: CompanyProfile;
}): CompanyProfile {
  if (!company.profile) throw new Error("Company discovery has no profile");
  return company.profile;
}

export interface DiscoveredCompany {
  requestedUrl: string;
  discoveryUrl: string;
  document: PoppyDocument;
  profile: CompanyProfile;
  /** PAP 0.3 §9.1, fetched without a token; absent if none or unavailable. */
  excludedTasks?: ExcludedTask[];
  excludedTasksError?: string;
  metadata?: AuthorizationServerMetadata;
  trace: DiscoveryTraceStep[];
  discoveredAt: string;
}

export class PapDiscoveryError extends Error {
  readonly code: string;
  readonly trace: DiscoveryTraceStep[];

  constructor(code: string, message: string, trace: DiscoveryTraceStep[]) {
    super(message);
    this.name = "PapDiscoveryError";
    this.code = code;
    this.trace = trace;
  }
}
export * from "./lab.ts";

import { z } from "zod";

/**
 * The local example Companies (development only, plain HTTP): Juniper Market,
 * Lantern Noodle Bar, Harborline Bank and Northwind Air. Nothing else may use
 * the private-network exception.
 */
export const LOCAL_COMPANY_ORIGINS = [
  "http://juniper.localhost:4100",
  "http://noodles.localhost:4200",
  "http://harbor.localhost:4300",
  "http://northwind.localhost:4400",
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
        "Poppy protocol URLs require HTTPS without credentials or fragments",
    },
  );

/** §3.1: the host, with its port when that isn't 443. */
const domain = z
  .string()
  .max(260)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::(?!443$)[1-9][0-9]{0,4})?$/i,
    "Expected a domain name without scheme or path, with a port only when it isn't 443",
  );

const scopeName = z.string().regex(/^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/);
const scopeDescriptions = z.record(scopeName, z.string().max(1000));
/** §8.1: every entry says what the agent there can help with. */
const protocolEntry = z.object({
  type: z.string().min(1).max(64),
  endpoint: httpsUrl,
  description: z.string().min(1).max(1000),
  access: z.string().max(64).optional(),
});
/** §3.3: an entry per major version; each extension defines the rest. */
const extensionEntry = z.looseObject({ version: z.string().min(1).max(16) });
const versionName = z.string().regex(/^\d{1,3}\.\d{1,3}$/);

/** Version 1.x discovery document (§3.1). Unknown fields are ignored. */
export const poppyDocumentSchema = z
  .object({
    protocol_version: versionName,
    supported_versions: z.record(versionName, httpsUrl).optional(),
    organization: z.object({
      name: z.string().min(1).max(200),
      domain,
      logo_uri: httpsUrl.optional(),
    }),
    auth: z
      .object({
        issuer: httpsUrl.optional(),
        // §3.2: the Company offers Personal Agents no sign-in.
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
    web: z
      .object({
        browser_session_endpoint: httpsUrl.optional(),
        disabled: z.boolean().optional(),
        unscoped: z.boolean().optional(),
      })
      .optional(),
    tasks: z.object({ endpoint: httpsUrl }).optional(),
    extensions: z
      .record(z.string().min(1).max(128), z.array(z.unknown()).max(16))
      .optional(),
  })
  .superRefine((document, context) => {
    if (!document.agent && !document.apis && !document.web)
      context.addIssue({
        code: "custom",
        path: ["web"],
        message: "At least one of agent, apis, or web is required",
      });
  });
/** §3.4: versions this client implements (1.0), compatible by major version. */
export const IMPLEMENTED_VERSION = "1.0";
export const compatibleVersion = (version: string) =>
  /^1\.\d{1,3}$/.test(version);
/** The entries of one extension whose `version` equals `version` (§3.3). */
export function extensionEntries(
  document: Pick<PoppyDocument, "extensions">,
  name: string,
) {
  return (document.extensions?.[name] ?? []).flatMap((entry) => {
    const parsed = extensionEntry.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
export const listsExtension = (
  document: Pick<PoppyDocument, "extensions">,
  name: string,
  version: string,
) => extensionEntries(document, name).some((e) => e.version === version);

/**
 * `poppylab.dev/fdx` version 1: a read-only, FDX-shaped API (not FDX
 * conformant) next to the Company's own. Each URL is on the Company's own
 * origin; `fdx_version` and `resources` are informational.
 */
export const FDX_EXTENSION = "poppylab.dev/fdx";
export interface FdxExtensionEntry {
  version: "1";
  /** Absolute, without a trailing slash; resource paths go under it. */
  base_url: string;
  /** Absolute, without a trailing slash; `/{consentId}` goes under it. */
  consent_endpoint: string;
  fdx_version?: string;
  resources?: string[];
}
/** The extensions, and the version of each, that this client uses (§3.3). */
export const SUPPORTED_EXTENSIONS = {
  operations: "3",
  [FDX_EXTENSION]: "1",
} as const;
/** Name → the entry of the version this client uses, when listed and valid. */
export interface CompanyExtensions {
  /** Operations v3 defines no other fields (§2 of that extension). */
  operations?: { version: "3" };
  [FDX_EXTENSION]?: FdxExtensionEntry;
}
export type ExtensionCheck<T> =
  { entry: T; reason?: undefined } | { entry?: undefined; reason: string };

/**
 * An extension URL is used only on the Company's own origin: HTTPS on
 * `organization.domain`, or one of the given development-only local origins
 * (§3: HTTPS everywhere, no redirects or other hosts for an extension
 * endpoint). No credentials, query, fragment or encoded path.
 */
function extensionUrl(
  value: unknown,
  domain: string,
  localOrigins: readonly string[],
): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    !(url.protocol === "https:" || localOrigins.includes(url.origin)) ||
    url.host.toLowerCase() !== domain.toLowerCase() ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.includes("?") ||
    value.includes("#") ||
    /[%\\]/.test(url.pathname)
  )
    return undefined;
  return url.href.replace(/\/+$/, "");
}

/**
 * The `poppylab.dev/fdx` v1 entry, validated (§3.3, §3). Undefined when the
 * Company doesn't list version 1; a reason when it does but the entry can't be
 * used, which then counts as not listed.
 */
export function fdxExtension(
  document: Pick<PoppyDocument, "extensions" | "organization">,
  /** Development-only plain-HTTP origins (the local example Companies). */
  localOrigins: readonly string[] = [],
): ExtensionCheck<FdxExtensionEntry> | undefined {
  const raw = extensionEntries(document, FDX_EXTENSION).find(
    (e) => e.version === "1",
  );
  if (!raw) return undefined;
  const domain = document.organization.domain;
  const fields = ["base_url", "consent_endpoint"] as const;
  const urls: Partial<Record<(typeof fields)[number], string>> = {};
  for (const field of fields) {
    if (raw[field] === undefined) return { reason: `${field} is missing` };
    const url = extensionUrl(raw[field], domain, localOrigins);
    if (!url)
      return {
        reason: `${field} is not an HTTPS URL on ${domain.slice(0, 260)}`,
      };
    urls[field] = url;
  }
  const fdxVersion =
    typeof raw.fdx_version === "string" &&
    /^[0-9A-Za-z.]{1,16}$/.test(raw.fdx_version)
      ? raw.fdx_version
      : undefined;
  const resources = Array.isArray(raw.resources)
    ? raw.resources
        .slice(0, 16)
        .filter(
          (r): r is string =>
            typeof r === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(r),
        )
    : undefined;
  return {
    entry: {
      version: "1",
      base_url: urls.base_url!,
      consent_endpoint: urls.consent_endpoint!,
      ...(fdxVersion ? { fdx_version: fdxVersion } : {}),
      ...(resources ? { resources } : {}),
    },
  };
}

/**
 * §3.3: the supported extensions the document lists, in the version this
 * client uses. Entries that fail validation are left out, with a reason.
 */
export function companyExtensions(
  document: Pick<PoppyDocument, "extensions" | "organization">,
  localOrigins: readonly string[] = [],
): {
  extensions: CompanyExtensions;
  rejected: Array<{ name: string; version: string; reason: string }>;
} {
  const extensions: CompanyExtensions = {};
  const rejected: Array<{ name: string; version: string; reason: string }> = [];
  if (listsExtension(document, "operations", SUPPORTED_EXTENSIONS.operations))
    extensions.operations = { version: "3" };
  const fdx = fdxExtension(document, localOrigins);
  if (fdx?.entry) extensions[FDX_EXTENSION] = fdx.entry;
  else if (fdx)
    rejected.push({ name: FDX_EXTENSION, version: "1", reason: fdx.reason });
  return { extensions, rejected };
}

/** RFC 9728 protected resource metadata (fields this client uses). */
export const protectedResourceMetadataSchema = z.object({
  resource: httpsUrl,
  authorization_servers: z.array(httpsUrl).max(16).optional(),
  // §3.2: the scopes Personal Agents can request, as well as the issuer's.
  scopes_supported: z.array(scopeName).max(256).optional(),
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
  // §4.2, RFC 9126: Pushed Authorization Requests.
  pushed_authorization_request_endpoint: httpsUrl.optional(),
  require_pushed_authorization_requests: z.boolean().optional(),
  token_endpoint_auth_signing_alg_values_supported: z
    .array(z.string())
    .optional(),
  dpop_signing_alg_values_supported: z.array(z.string()).optional(),
});

export type PoppyDocument = z.infer<typeof poppyDocumentSchema>;
export type AuthorizationServerMetadata = z.infer<
  typeof authorizationServerMetadataSchema
>;

export type TraceStatus = "pending" | "active" | "passed" | "failed";

export interface DiscoveryTraceStep {
  id:
    | "input"
    | "poppy"
    | "domain"
    | "extension"
    | "resource"
    | "issuer"
    | "metadata"
    | "link";
  label: string;
  detail: string;
  status: TraceStatus;
  durationMs?: number;
}

/** What a client needs from discovery, instead of raw document fields. */
export interface CompanyProfile {
  /** The chosen document's `protocol_version` (§3.4). */
  version: string;
  /** Issuer, or https://{domain} for a Company without one (§3.2). */
  identifier: string;
  issuer?: string;
  signIn: { direct: boolean; device: boolean };
  /** RFC 9126: PAR is offered, or required (§4.2). */
  pushedAuthorization?: { endpoint: string; required: boolean };
  /** Scopes a Personal Agent may request; empty when none are advertised. */
  scopes: string[];
  scopeDescriptions: Record<string, string>;
  scopeHints: Record<string, ScopeHint>;
  /** §9: where to get excluded tasks, skills and feedback for a Session. */
  tasksEndpoint?: string;
  /** Operations version 3 is listed (the only version this client uses). */
  operations: boolean;
  /**
   * §3.3: each supported extension the Company lists, as the validated entry
   * of the version this client uses. An entry that fails validation is absent.
   * Discovery always sets it; a profile stored before it existed has none.
   */
  extensions?: CompanyExtensions;
}

export type AlternativeReference =
  | { type: "openapi"; url: string; operation_id: string }
  | { type: "mcp"; url: string; tool: string }
  | { type: "web"; url: string };
export type ExcludedTask = {
  task: string;
  alternative?: { instructions?: string; references: AlternativeReference[] };
};

export type TasksResponse = {
  excludedTasks: ExcludedTask[];
  /** §9.3, an HTTPS endpoint for feedback reports. */
  feedbackEndpoint?: string;
  /** §9.4: skills listed; this client doesn't load them. */
  skills: number;
};
const clean = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
const allowedUrl = (v: unknown, localOrigins: readonly string[]) => {
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
/**
 * §9.2: an alternative, from a tasks response or a feedback reply. Company
 * content, never instructions. API references must name an API from the
 * same poppy.json; web references are kept only on the Company's own domain
 * or its subdomains; unknown types are skipped. Undefined when nothing's left.
 */
export function parseAlternative(
  value: unknown,
  document: PoppyDocument,
  localOrigins: readonly string[] = [],
): ExcludedTask["alternative"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const alt = value as Record<string, unknown>;
  const apis = document.apis ?? [];
  // Hostnames only: a port in organization.domain doesn't widen the match.
  const domain = document.organization.domain
    .toLowerCase()
    .replace(/:\d+$/, "");
  const references: AlternativeReference[] = [];
  for (const ref of Array.isArray(alt.references)
    ? alt.references.slice(0, 8)
    : []) {
    if (!ref || typeof ref !== "object") continue;
    const r = ref as Record<string, unknown>;
    const url = allowedUrl(r.url, localOrigins);
    if (!url) continue;
    if (r.type === "web") {
      const host = url.hostname.toLowerCase();
      if (host === domain || host.endsWith(`.${domain}`))
        references.push({ type: "web", url: url.href });
    } else if (
      (r.type === "openapi" || r.type === "mcp") &&
      apis.some((api) => api.type === r.type && api.url === r.url)
    ) {
      const id = clean(r.type === "openapi" ? r.operation_id : r.tool, 128);
      if (!id) continue;
      references.push(
        r.type === "openapi"
          ? { type: "openapi", url: String(r.url), operation_id: id }
          : { type: "mcp", url: String(r.url), tool: id },
      );
    }
  }
  const instructions = clean(alt.instructions, 2000);
  return instructions || references.length
    ? { ...(instructions ? { instructions } : {}), references }
    : undefined;
}
/**
 * §9–9.2: the tasks response. Company content, never instructions to follow.
 * API references must name an API from the same poppy.json; web references
 * are kept only on the Company's own domain or its subdomains. Unknown fields
 * and types are skipped.
 */
export function parseTasks(
  value: unknown,
  document: PoppyDocument,
  /** Development-only plain-HTTP origins (the local example Companies). */
  localOrigins: readonly string[] = [],
): TasksResponse {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid tasks response");
  const body = value as Record<string, unknown>;
  const excluded = Array.isArray(body.excluded_tasks)
    ? body.excluded_tasks
    : [];
  const tasks: ExcludedTask[] = [];
  for (const raw of excluded.slice(0, 64)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const task = clean(item.task, 200);
    if (!task) continue;
    const alternative = parseAlternative(
      item.alternative,
      document,
      localOrigins,
    );
    tasks.push({ task, ...(alternative ? { alternative } : {}) });
  }
  const feedback = body.feedback as { endpoint?: unknown } | undefined;
  const endpoint = allowedUrl(feedback?.endpoint, localOrigins);
  const index = body.skill_index as { skills?: unknown } | undefined;
  return {
    excludedTasks: tasks,
    ...(endpoint ? { feedbackEndpoint: endpoint.href } : {}),
    skills: Array.isArray(index?.skills) ? index.skills.length : 0,
  };
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
export * from "./how-it-works.ts";
export * from "./spec-links.ts";

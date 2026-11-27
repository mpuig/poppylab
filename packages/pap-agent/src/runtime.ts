import {
  discoverCompany,
  extensionsHeader,
  POPPY_VERSION,
  protocolRequest,
  type ApiTool,
} from "@poppy-lab/pap-client";
import { companyProfile, FDX_EXTENSION } from "@poppy-lab/pap-core";
import { agentOrigin } from "./agent-keys";
import {
  excludedTasksTool,
  feedbackEndpoint,
  feedbackTool,
  readTasks,
} from "./company-tasks";
import { notAddressed, type Addressed } from "./addressed";
import { isSandbox } from "./company-policy";
import {
  conversationEndpoint,
  conversationSession,
  conversationTools,
  type CompanyEntry,
  type DirectAction,
} from "./conversations";
import { localOrigins, proposalsAllowed } from "./deployment";
import { espiConnect } from "./espi-runtime";
import { fdxConnect, fdxShaped, under } from "./fdx-runtime";
import { mcpConnect } from "./mcp-runtime";
import { openApiConnect } from "./openapi-runtime";
import type { Connection } from "./run-types";
import {
  declaredExtensions,
  ensureSession,
  espiEntry,
  fdxEntry,
} from "./session";
import { papRequest } from "./transport";
import { UserFacingError } from "./user-error";

// Each part of the runtime is a module of its own. This one connects a
// Company and names every part: the playground and its tests import this
// module, and tests mock it whole, so the account and chat routes import
// what they use of the runtime from here too.
export {
  agentFor,
  agentOrigin,
  clientFor,
  clientId,
  identity,
  operatorKey,
  userFor,
} from "./agent-keys";
export type {
  Connection,
  FormerConnection,
  Operation,
  Run,
  Turn,
} from "./run-types";
export {
  accountConfiguration,
  declaredExtensions,
  ensureSession,
  espiEntry,
  fdxEntry,
  hasScope,
  newSession,
  setExtension,
  setFdx,
} from "./session";
export {
  approvalFor,
  papRequest,
  pushAuthorizationRequest,
  renewAccount,
  revokeRefreshToken,
  sendApproval,
  userApproval,
  usesDpop,
} from "./transport";
export {
  FDX_GUIDANCE,
  fdxConsentRecord,
  fdxConsentTarget,
  fdxStatementDownload,
  fdxUserTools,
  revokeFdxConsent,
} from "./fdx-runtime";
export {
  ESPI_GUIDANCE,
  espiAuthorizationRecord,
  espiAuthorizationTarget,
  espiUserTools,
  revokeEspiAuthorization,
} from "./espi-runtime";
export { excludedTasksTool, feedbackTool } from "./company-tasks";
export type { Addressed } from "./addressed";
export { tokenResponse } from "./token-response";
export { recordOperation } from "./operation-store";
export { localOrigins } from "./deployment";

/**
 * Connects one Company for a turn: discovery, the Session, the tasks of
 * this Session, and the tools of each interface it offers (OpenAPI or MCP,
 * the domain extensions with Use FDX or Use ESPI on, its agent's
 * conversations, the excluded tasks and feedback).
 *
 * A chat turn says what the User asked and of whom (`addressed`). Every
 * tool is then this Company's only on that condition: a call while the
 * User's request wasn't asked of this Company (`notAddressed`) sends
 * nothing, and the model is told why. This is the one place each tool of
 * every kind passes through. Feedback (§9.3) is offered only then, since
 * without it there is no telling whether a report would go to the Company
 * the request was for. What `connect` itself sends (discovery, the
 * Session, the tasks response) carries nothing of the User's request.
 */
export async function connect(
  connection: Connection,
  trace: string[],
  /** Company messages the chat shows for this turn (conversations, §8). */
  shown: CompanyEntry[] = [],
  addressed?: Addressed,
): Promise<Record<string, ApiTool>> {
  const company = await discoverCompany(connection.url, {
    allowedPrivateOrigins: localOrigins,
  });
  connection.company = company;
  const profile = companyProfile(company);
  await ensureSession(connection);
  const declared = extensionsHeader(declaredExtensions(connection));
  trace.push(
    `Poppy ${profile.version} Session ${connection.accountToken ? "signed in" : "signed out"} · delegated ES256 Session header · Poppy-Version ${POPPY_VERSION}${declared ? ` · Poppy-Extensions ${declared}` : ""}`,
  );
  await readTasks(connection, trace);
  // The generic adapter gets the Company's own API: the first OpenAPI
  // description, or else MCP. An FDX-shaped description is used only through
  // the native adapter, with Use FDX on, and never generically (§3.3).
  const listed = profile.extensions?.[FDX_EXTENSION];
  let api = company.document.apis?.find((item) => item.type === "openapi");
  let spec: unknown;
  if (listed) {
    api = undefined;
    for (const item of company.document.apis ?? []) {
      if (item.type !== "openapi") continue;
      const described = under(item.url, listed.base_url)
        ? undefined
        : await protocolRequest(item.url, {}, localOrigins);
      if (described === undefined || fdxShaped(described, item.url, listed)) {
        trace.push(
          `Not loading ${new URL(item.url).pathname} as API tools · FDX-shaped (${FDX_EXTENSION}), native adapter only`,
        );
        continue;
      }
      api = item;
      spec = described;
      break;
    }
  }
  api ??= company.document.apis?.find((item) => item.type === "mcp");
  const fdx = fdxEntry(connection);
  const espi = espiEntry(connection);
  // The domain extension's native tools, with Use FDX or Use ESPI on.
  const domainSet = {
    ...(fdx ? fdxConnect(connection, fdx, trace) : {}),
    ...(espi ? espiConnect(connection, espi, trace) : {}),
  };
  const endpoint = conversationEndpoint(company);
  const conversation = endpoint
    ? conversationTools(
        connection,
        conversationOptions(connection, endpoint, trace, shown),
      )
    : {};
  if (endpoint) trace.push(`Company Agent conversations at ${endpoint}`);
  const taskTools: Record<string, ApiTool> = {};
  if (connection.tasks?.value.excludedTasks.length)
    taskTools.excluded_tasks = excludedTasksTool(connection, trace);
  // The names of this connection's tools, which a report may say (see IDENTIFIERS).
  const names = new Set<string>();
  const offered = (tools: Record<string, ApiTool>) => {
    for (const name of Object.keys(tools)) names.add(name);
    return addressed ? onlyAsked(connection, tools, addressed, trace) : tools;
  };
  if (addressed && feedbackEndpoint(connection))
    taskTools.report_unsupported_task = feedbackTool(
      connection,
      trace,
      addressed,
      names,
      shown,
    );
  if (!api) {
    if (endpoint || fdx || espi)
      return offered({ ...conversation, ...domainSet, ...taskTools });
    throw new UserFacingError(
      "This Company lists no OpenAPI, MCP or conversation endpoint Poppy Lab supports.",
    );
  }
  const sandbox =
    isSandbox(new URL(connection.url).origin) &&
    profile.issuer === new URL(connection.url).origin &&
    new URL(api.url).origin === new URL(connection.url).origin;
  if (sandbox && !agentOrigin.startsWith("https://"))
    throw new UserFacingError(
      "Set AGENT_PUBLIC_ORIGIN to a publicly reachable HTTPS origin before using Poppy Sandbox Sessions. Do not expose an unprotected playground.",
    );
  const tools =
    api.type === "mcp"
      ? await mcpConnect(connection, api.url, trace)
      : await openApiConnect(connection, api.url, trace, sandbox, spec);
  return offered({ ...tools, ...domainSet, ...conversation, ...taskTools });
}

/**
 * Each tool, called only while the User's request was asked of this
 * Company. Otherwise nothing is sent, the Inspector says so, and the model
 * reads why.
 */
function onlyAsked(
  connection: Connection,
  tools: Record<string, ApiTool>,
  addressed: Addressed,
  trace: string[],
): Record<string, ApiTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (input?: Record<string, unknown>) => {
          const reason = notAddressed(connection, addressed);
          if (!reason) return tool.execute(input);
          trace.push(
            `Not sent · ${name} · the user's request wasn't asked of this Company`,
          );
          return { sent: false, not_addressed: true, reason };
        },
      },
    ]),
  );
}

/** What a conversation needs from its connection: transport, policy and output. */
function conversationOptions(
  connection: Connection,
  endpoint: string,
  trace: string[],
  shown: CompanyEntry[],
) {
  const profile = companyProfile(connection.company!);
  return {
    endpoint,
    request: (
      c: Connection,
      url: string,
      method: "GET" | "POST",
      body?: unknown,
    ) => papRequest(c, url, method, body),
    allowProposals:
      !!profile.issuer &&
      proposalsAllowed(profile.issuer) &&
      profile.operations,
    trace: (line: string) => trace.push(line),
    shown,
  };
}

/**
 * §8.10: one of the User's own actions on a Direct Conversation, never the
 * model's. Call after `connect`, which starts the Session.
 */
export async function directConversation(
  connection: Connection,
  action: DirectAction,
  words: string | undefined,
  trace: string[],
  shown: CompanyEntry[],
) {
  const endpoint = connection.company
    ? conversationEndpoint(connection.company)
    : undefined;
  if (!endpoint)
    throw new UserFacingError("This Company offers no conversations.");
  return conversationSession(
    connection,
    conversationOptions(connection, endpoint, trace, shown),
  ).direct(action, words);
}

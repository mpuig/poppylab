import {
  openApiTools,
  protocolRequest,
  ProtocolError,
  type ApiTool,
} from "@poppy-lab/pap-client";
import {
  companyProfile,
  ESPI_EXTENSION,
  FDX_EXTENSION,
} from "@poppy-lab/pap-core";
import { localOrigins, proposalsAllowed } from "./deployment";
import { notSent } from "./extension-request";
import { outcomeUnknown, recordOperation } from "./operation-store";
import { refusedLine } from "./protocol-log";
import type { Connection } from "./run-types";
import { papRequest } from "./transport";
import { UserFacingError } from "./user-error";

export async function openApiConnect(
  connection: Connection,
  url: string,
  trace: string[],
  sandbox: boolean,
  /** The description, when `connect` has read it already. */
  described?: unknown,
): Promise<Record<string, ApiTool>> {
  const company = connection.company!;
  const profile = companyProfile(company);
  const api = { url };
  const spec = described ?? (await protocolRequest(api.url, {}, localOrigins));
  const fdx = profile.extensions?.[FDX_EXTENSION];
  const espi = profile.extensions?.[ESPI_EXTENSION];
  // §4.5: the service is the URL in the description's servers.
  const server = (spec as { servers?: Array<{ url?: unknown }> })?.servers?.[0]
    ?.url;
  connection.apiBase = new URL(
    typeof server === "string" ? server : new URL(api.url).origin,
  ).href.replace(/\/$/, "");
  const tools = openApiTools(spec, api.url, {
    // Proposals need an allowlisted account Company listing Operations v3.
    allowProposals:
      (sandbox ||
        (!!profile.issuer &&
          new URL(api.url).origin === profile.issuer &&
          proposalsAllowed(profile.issuer))) &&
      profile.operations,
    // Protocol and extension endpoints are never model tools (§3.3).
    blockedPaths: [
      "/oauth",
      "/agent",
      "/poppy",
      ...Object.values(company.document.extensions ?? {}).flatMap((entries) =>
        entries.flatMap((v) =>
          v &&
          typeof v === "object" &&
          "endpoint" in v &&
          typeof v.endpoint === "string"
            ? [new URL(v.endpoint).pathname]
            : [],
        ),
      ),
      // The FDX-shaped routes, should the Company's own API list them.
      ...(fdx
        ? [
            new URL(fdx.base_url).pathname,
            new URL(fdx.consent_endpoint).pathname,
          ]
        : []),
      // And the ESPI-shaped ones.
      ...(espi ? [new URL(espi.resource_endpoint).pathname] : []),
    ],
    trace: (message) => trace.push(message),
    request: async (target, method, body, scopes) => {
      // Stopped here, before the Company is asked: `sent: false` tells the
      // model and the demo that this is no answer of the Company's.
      if (scopes.length && !connection.accountToken) {
        notSent(trace, "sign-in needed");
        return {
          error: "sign_in_required",
          sent: false,
          instruction: "Ask the user to use the Sign in control in the chat.",
        };
      }
      const granted = (connection.scopes ?? "").split(" ");
      const missing = scopes.filter((s) => !granted.includes(s));
      if (missing.length) {
        notSent(trace, "permission not granted");
        return {
          error: "insufficient_scope",
          sent: false,
          missing,
          instruction:
            "Ask the user to choose Request change permission. A new Company consent is required; do not retry or propose changes until it completes. Reading remains available.",
        };
      }
      try {
        // An error body of the Company's own is kept on the error, so the
        // chat can show a number from it (never its words).
        return await papRequest(connection, target, method, body, {
          errorBody: true,
        });
      } catch (error) {
        // Operations v3 §4: refused, nothing performed, operation attached.
        if (
          method !== "POST" ||
          !(error instanceof ProtocolError) ||
          error.status !== 403 ||
          error.code !== "approval_required"
        ) {
          // Any other error answer is logged before it ends the turn: the
          // chat points at the Inspector, which lists it.
          if (error instanceof ProtocolError)
            trace.push(
              refusedLine(
                method,
                new URL(target).pathname,
                error.status,
                error.code ?? error.companyCode,
              ),
            );
          throw error;
        }
        const op = recordOperation(connection, error.operation, {
          url: target,
          body,
        });
        // §7: an approval for it is out, so no new proposal was recorded.
        if (op.state === "uncertain") {
          trace.push(
            "Approval already sent · outcome not known yet · nothing new proposed",
          );
          return outcomeUnknown(op);
        }
        trace.push("Approval required · nothing performed");
        // The summary is optional: the terms always say what is waiting.
        return {
          status: "approval_required",
          operation_id: op.operation_id,
          ...(op.summary ? { summary: op.summary } : {}),
          terms: op.terms,
          expires_at: op.expires_at,
          note: "Nothing was done. The user must approve these exact terms with the control in the chat; your words can't approve it.",
        };
      }
    },
  });
  if (!Object.keys(tools).length)
    throw new UserFacingError("No supported OpenAPI operations were found.");
  trace.push(
    `Loaded ${Object.keys(tools).length} API tools; confirmation is never a model tool`,
  );
  return tools;
}

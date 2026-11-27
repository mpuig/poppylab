import {
  ProtocolError,
  type BinaryBody,
  type EspiRequestOptions,
  type FdxRequestOptions,
} from "@poppy-lab/pap-client";
import type { DomainExtension } from "./domain-extension";
import type { Connection } from "./run-types";
import { papRequest } from "./transport";

export const SIGN_IN_REQUIRED = {
  error: "sign_in_required",
  // Iris answered this itself: nothing was sent to the Company.
  sent: false,
  instruction: "Ask the user to use the Sign in control in the chat.",
} as const;

/**
 * A request Iris stops before asking the Company: signed out, or without a
 * permission the request needs. The adapter wrote the request's line just
 * before calling; that line is replaced by one that says nothing was sent,
 * so the log never shows a request that wasn't made.
 */
export function notSent(trace: string[], reason: string) {
  const asked = /^(GET|POST) (\S+) · /.exec(trace.at(-1) ?? "");
  if (asked) trace.pop();
  trace.push(
    `Not sent${asked ? ` · ${asked[1]} ${asked[2]}` : ""} · ${reason}`,
  );
}

/**
 * How a domain extension's native tools reach the Company: signed in,
 * within the granted scopes, through `papRequest`. The FDX-shaped tools ask
 * for JSON or a statement PDF, the ESPI-shaped ones for Atom XML.
 */
export function extensionRequest(
  connection: Connection,
  extension: DomainExtension,
  trace: string[],
) {
  return async (
    url: string,
    scopes: string[],
    options?: FdxRequestOptions | EspiRequestOptions,
  ) => {
    // Every route of a domain extension is account data, the consent and
    // authorization ones included.
    if (!connection.accountToken) {
      notSent(trace, "sign-in needed");
      return { outcome: SIGN_IN_REQUIRED };
    }
    const granted = (connection.scopes ?? "").split(" ");
    const missing = scopes.filter((s) => !granted.includes(s));
    if (missing.length) {
      notSent(trace, "permission not granted");
      return {
        outcome: {
          error: "insufficient_scope",
          sent: false,
          missing,
          instruction: `This sign-in doesn't include these ${extension.shape} ${extension.key === "fdx" ? "data clusters" : "scopes"}. Ask the user to sign in again with Use ${extension.label} on; do not retry until then.`,
        },
      };
    }
    try {
      // A document (a statement PDF, an Atom feed): its bytes, for the
      // adapter to check.
      if (options) {
        const document = (await papRequest(connection, url, "GET", undefined, {
          errorBody: true,
          binary: options,
        })) as BinaryBody;
        return {
          status: 200,
          contentType: document.contentType,
          bytes: document.bytes,
        };
      }
      return {
        status: 200,
        body: await papRequest(connection, url, "GET", undefined, {
          errorBody: true,
        }),
      };
    } catch (error) {
      // The API's own error (FDX's `701`, `703`, `consent_not_found`…;
      // ESPI's `invalid_parameter`): for the model, bounded by the adapter.
      // An ESPI-shaped API also answers a resource it won't reveal with a
      // bare 404, which has no body: passed on too, unless it is a Poppy or
      // OAuth error (a known code) or a token's 401. Rate limits and server
      // errors aren't the API's answer, and are thrown as before.
      if (
        error instanceof ProtocolError &&
        (error.body !== undefined ||
          (extension.key === "espi" &&
            error.code === undefined &&
            error.status !== 401)) &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      )
        return { status: error.status, body: error.body ?? null };
      throw error;
    }
  };
}

/**
 * The User's revocation of a domain extension's grant, as one request
 * through `papRequest`, traced with its outcome. Resolves on a 2xx; throws
 * the Company's error otherwise.
 */
export async function sendRevocation(
  connection: Connection,
  trace: string[],
  method: "PUT" | "DELETE",
  url: string,
  what: string,
  body?: unknown,
) {
  const path = new URL(url).pathname;
  try {
    const answer = await papRequest(connection, url, method, body, {
      acceptEmpty: true,
    });
    trace.push(
      `${method} ${path} · ${what} revoked · ${answer === null ? 204 : 200}`,
    );
  } catch (error) {
    trace.push(
      `${method} ${path} · ${what} revocation failed · ${error instanceof ProtocolError ? error.status : "no answer"}`,
    );
    throw error;
  }
}

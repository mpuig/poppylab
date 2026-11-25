/**
 * Harborline's own OpenAPI 3.1 description of its FDX-shaped subset
 * (`fdx.ts`). Written from scratch for this lab: no FDX schema or text is
 * copied, and nothing here claims FDX conformance or certification.
 * `x-poppy-scopes` names the scopes each operation needs, as in Harborline's
 * own contract (`bankPaths`).
 */
import { FICTION_NOTICE } from "./data.ts";
import { FDX_BASE, MAX_LIMIT, DEFAULT_LIMIT } from "./fdx.ts";
import type { HarborlineScope } from "./scopes.ts";

const CAVEAT =
  "FDX-shaped, not FDX-conformant or certified. Requests must declare the poppylab.dev/fdx extension, version 1, in Poppy-Extensions.";

const response = (description: string) => ({ description });
const auth = (required: HarborlineScope[]) => ({
  "x-poppy-scopes": required,
  security: [{ dpop: required }],
});
const errors = {
  "400": response("Invalid parameters (code 703 for dates)"),
  "401": response("Missing or invalid access token"),
  "403": response("extension_required or insufficient_scope"),
};
const notFound = (what: string) => response(`${what} (code 701)`);
const accountId = {
  name: "accountId",
  in: "path",
  required: true,
  description: "An accountId from the account list",
  schema: { type: "string", maxLength: 80 },
};
const statementId = {
  name: "statementId",
  in: "path",
  required: true,
  description: "A statementId from the account's statement list",
  schema: { type: "string", maxLength: 128 },
};
/** startTime, endTime, offset and limit, as on transactions. */
const paging = (what: string, dates: string) => [
  day("startTime", `First ${dates} included, YYYY-MM-DD`),
  day("endTime", `Last ${dates} included, YYYY-MM-DD`),
  {
    name: "offset",
    in: "query",
    required: false,
    description: `${what} to skip`,
    schema: { type: "integer", minimum: 0, maximum: 1000000 },
  },
  {
    name: "limit",
    in: "query",
    required: false,
    description: `${what} per page, at most ${MAX_LIMIT}`,
    schema: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
  },
];
const consentId = {
  name: "consentId",
  in: "path",
  required: true,
  description: "The consent_id from the token response",
  schema: { type: "string", maxLength: 80 },
};
const day = (name: string, description: string) => ({
  name,
  in: "query",
  required: false,
  description,
  schema: { type: "string", format: "date", maxLength: 10 },
});

const errorSchema = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    debugMessage: { type: "string" },
    note: { type: "string" },
  },
};
const accountSchema = {
  type: "object",
  description:
    "A fictional deposit account. Balances appear only when the token carries fdx:ACCOUNT_DETAILED.",
  properties: {
    accountId: { type: "string" },
    accountCategory: { type: "string", enum: ["DEPOSIT_ACCOUNT"] },
    accountType: { type: "string", enum: ["CHECKING", "SAVINGS"] },
    productName: { type: "string" },
    nickname: { type: "string" },
    accountNumberDisplay: {
      type: "string",
      description:
        "Four digits derived from Harborline's account ID; no real account number exists",
    },
    status: { type: "string", enum: ["OPEN", "CLOSED"] },
    currency: {
      type: "object",
      properties: { currencyCode: { type: "string", enum: ["USD"] } },
    },
    currentBalance: { type: "number", description: "USD, two decimals" },
    availableBalance: { type: "number", description: "USD, two decimals" },
    balanceAsOf: { type: "string", format: "date-time" },
  },
};
const transactionSchema = {
  type: "object",
  properties: {
    transactionId: { type: "string" },
    accountId: { type: "string" },
    description: { type: "string" },
    amount: {
      type: "number",
      minimum: 0,
      description: "USD, always positive; debitCreditMemo gives the direction",
    },
    debitCreditMemo: { type: "string", enum: ["DEBIT", "CREDIT"] },
    status: { type: "string", enum: ["POSTED", "PENDING"] },
    transactionTimestamp: { type: "string", format: "date-time" },
    postedTimestamp: { type: "string", format: "date-time" },
    category: {
      type: "string",
      description: "Harborline's own category name, not a merchant code",
    },
  },
};

const statementSchema = {
  type: "object",
  description:
    "A fictional monthly statement: a closed cycle from the 21st of one month through the 20th of the next, in UTC days. startDate and endDate are Harborline's own fields.",
  properties: {
    statementId: { type: "string" },
    accountId: { type: "string" },
    statementDate: {
      type: "string",
      format: "date",
      description: "The cycle's last day",
    },
    description: { type: "string" },
    status: { type: "string", enum: ["AVAILABLE"] },
    startDate: { type: "string", format: "date" },
    endDate: { type: "string", format: "date" },
  },
};

export const fdxPaths: Record<string, unknown> = {
  [`${FDX_BASE}/accounts`]: {
    get: {
      operationId: "fdx_list_accounts",
      summary:
        "List the fictional accounts the customer chose to share at consent. Accounts left out of the consent are never listed.",
      ...auth(["fdx:ACCOUNT_BASIC"]),
      responses: {
        "200": response("The shared accounts"),
        ...errors,
      },
    },
  },
  [`${FDX_BASE}/accounts/{accountId}`]: {
    get: {
      operationId: "fdx_get_account",
      summary:
        "Read one shared fictional account. An account outside the consent answers as not found.",
      ...auth(["fdx:ACCOUNT_BASIC"]),
      parameters: [accountId],
      responses: {
        "200": response("The account"),
        "404": notFound("Not found or not shared"),
        ...errors,
      },
    },
  },
  [`${FDX_BASE}/accounts/{accountId}/transactions`]: {
    get: {
      operationId: "fdx_list_transactions",
      summary: `Page through a shared account's fictional transactions, newest first. Dates are inclusive UTC days. Pass page.nextOffset back as offset for the next page; limit defaults to ${DEFAULT_LIMIT} and is capped at ${MAX_LIMIT}.`,
      ...auth(["fdx:TRANSACTIONS"]),
      parameters: [accountId, ...paging("Transactions", "day")],
      responses: {
        "200": response("One page of transactions, with page"),
        "404": notFound("Not found or not shared"),
        ...errors,
      },
    },
  },
  [`${FDX_BASE}/accounts/{accountId}/statements`]: {
    get: {
      operationId: "fdx_list_statements",
      summary: `List a shared account's fictional monthly statements, newest first: the closed cycles since the account opened, at most twelve. startTime and endTime select statement dates, inclusive. Paging works as for transactions.`,
      ...auth(["fdx:STATEMENTS"]),
      parameters: [accountId, ...paging("Statements", "statement date")],
      responses: {
        "200": response("One page of statements, with page"),
        "404": notFound("Not found or not shared"),
        ...errors,
      },
    },
  },
  [`${FDX_BASE}/accounts/{accountId}/statements/{statementId}`]: {
    get: {
      operationId: "fdx_get_statement",
      summary:
        "Download one statement as a PDF: the cycle's opening and closing balances and its posted transactions (at most 100 printed). Send Accept: application/pdf. The same statement is always the same bytes.",
      ...auth(["fdx:STATEMENTS"]),
      parameters: [accountId, statementId],
      responses: {
        "200": {
          description: "The statement, as an attachment",
          content: {
            "application/pdf": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        "404": response(
          "Account not found or not shared (code 701), or no such statement (code statement_not_found)",
        ),
        "406": response("Accept names no PDF (code not_acceptable, as JSON)"),
        ...errors,
      },
    },
  },
  [`${FDX_BASE}/customers/current`]: {
    get: {
      operationId: "fdx_get_customer",
      summary: "Read the fictional customer's name and contact email.",
      ...auth(["fdx:CUSTOMER_CONTACT"]),
      responses: { "200": response("The customer"), ...errors },
    },
  },
  [`${FDX_BASE}/consents/{consentId}`]: {
    get: {
      operationId: "fdx_consent_status",
      summary:
        "Read the consent this token was issued under: status, shared accounts and their data clusters, and expiry. Any token of that consent may read it.",
      ...auth([]),
      parameters: [consentId],
      responses: {
        "200": response("The consent"),
        "404": response("Not this token's consent"),
        ...errors,
      },
    },
  },
  [`${FDX_BASE}/consents/{consentId}/revocation`]: {
    put: {
      operationId: "fdx_revoke_consent",
      summary:
        "Revoke this token's consent. It is the Poppy grant: its access and refresh tokens stop working at once.",
      ...auth([]),
      parameters: [consentId],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["reason", "initiator"],
              properties: {
                reason: { type: "string", pattern: "^[A-Z][A-Z_]{0,39}$" },
                initiator: { type: "string", pattern: "^[A-Z][A-Z_]{0,39}$" },
              },
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        "204": response("Revoked"),
        "404": response("Not this token's consent"),
        ...errors,
      },
    },
  },
};

/** The whole document, for `/openapi/fdx.json`. */
export const fdxOpenApi = (origin: string) => ({
  openapi: "3.1.0",
  info: {
    title: "Harborline Bank FDX-shaped API (fictional)",
    version: "1.0.0",
    description: `${CAVEAT} ${FICTION_NOTICE}`,
  },
  servers: [{ url: origin }],
  security: [{ dpop: [] }],
  components: {
    securitySchemes: { dpop: { type: "http", scheme: "DPoP" } },
    schemas: {
      Error: errorSchema,
      Account: accountSchema,
      Transaction: transactionSchema,
      Statement: statementSchema,
    },
  },
  paths: fdxPaths,
});

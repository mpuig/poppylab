/**
 * Harborline's FDX-shaped, read-only API (`poppylab.dev/fdx` v1): accounts,
 * balances, transactions, statements, the customer, and the consent behind
 * the token.
 * It reads the same fictional state as Harborline's own API and portal.
 *
 * FDX-shaped, not FDX-conformant or certified. Paths and field names follow
 * the public shape of FDX 6.4 as implementers publish it; the rules, error
 * texts and descriptions are Harborline's own (see `docs/history/plan-fdx-harborline.md`
 * for the licence limits). Only requests that declare the extension get
 * here (§3.3, `requiredExtension`), and the gateway has already checked the
 * Session, the token and the route's data-cluster scope (§7,
 * `accountPrefixes`, `requiredScopes`).
 */
import type { Context, Hono } from "hono";
import type { CompanyDefinition, GrantView } from "@poppy-lab/pap-company";
import {
  accountLast4,
  FICTION_NOTICE,
  type Account,
  type Transaction,
} from "./data.ts";
import type { CustomerState } from "./harborline.ts";
import { statementPdf } from "./statement-pdf.ts";
import { statementsFor, type Statement } from "./statements.ts";

/** The extension (§3.3) and where its routes live. */
export const FDX = { name: "poppylab.dev/fdx", version: "1" } as const;
export const FDX_BASE = "/fdx/v6";
/** Public, so discovery works signed out: outside every account prefix. */
export const FDX_OPENAPI = "/openapi/fdx.json";
/** Transactions per page: the default, and the most a `limit` gets. */
export const DEFAULT_LIMIT = 25,
  MAX_LIMIT = 100;
const ACCOUNT_CLUSTERS = [
  "ACCOUNT_BASIC",
  "ACCOUNT_DETAILED",
  "TRANSACTIONS",
  "STATEMENTS",
] as const;

type Mount = Parameters<CompanyDefinition["mount"]>[1];

/**
 * Whole cents as a decimal amount, exactly: built from the digits rather
 * than by dividing, so `1284500` is `12845` and `-9230` is `-92.3`.
 */
export const decimal = (cents: number) => {
  if (!Number.isSafeInteger(cents)) throw new RangeError("cents");
  const whole = Math.abs(cents);
  return Number(
    `${cents < 0 ? "-" : ""}${Math.trunc(whole / 100)}.${String(whole % 100).padStart(2, "0")}`,
  );
};

/** An account as a deposit account; balances only when `detailed`. */
export const fdxAccount = (
  account: Account,
  detailed: boolean,
  asOf: string,
) => ({
  accountId: account.id,
  accountCategory: "DEPOSIT_ACCOUNT",
  accountType: account.type === "checking" ? "CHECKING" : "SAVINGS",
  productName: account.name,
  nickname: account.name,
  // Harborline has no account numbers: four digits derived from its ID.
  accountNumberDisplay: accountLast4(account.id),
  status: account.status === "active" ? "OPEN" : "CLOSED",
  currency: { currencyCode: "USD" },
  ...(detailed
    ? {
        currentBalance: decimal(account.balance_cents),
        availableBalance: decimal(account.available_cents),
        balanceAsOf: asOf,
      }
    : {}),
});

/** A transaction: an absolute amount, with its direction in the memo. */
export const fdxTransaction = (transaction: Transaction) => ({
  transactionId: transaction.id,
  accountId: transaction.account_id,
  description: transaction.description,
  amount: decimal(Math.abs(transaction.amount_cents)),
  debitCreditMemo: transaction.amount_cents < 0 ? "DEBIT" : "CREDIT",
  status: transaction.status === "posted" ? "POSTED" : "PENDING",
  transactionTimestamp: transaction.occurred_at,
  ...(transaction.status === "posted"
    ? { postedTimestamp: transaction.occurred_at }
    : {}),
  // Harborline's own category names, not merchant category codes.
  category: transaction.category,
});

/**
 * A statement as a list item. `startDate` and `endDate`, the cycle's days,
 * are Harborline's own fields; the document is served separately as a PDF.
 */
export const fdxStatement = (statement: Statement) => ({
  statementId: statement.statementId,
  accountId: statement.accountId,
  statementDate: statement.endDate,
  description: `Monthly statement, ${statement.startDate} to ${statement.endDate}`,
  status: "AVAILABLE",
  startDate: statement.startDate,
  endDate: statement.endDate,
});

/** Whether an `Accept` header takes a PDF; none at all takes anything. */
export function acceptsPdf(header: string | undefined) {
  if (!header?.trim()) return true;
  return header.split(",").some((range) => {
    const [type, ...params] = range.split(";").map((p) => p.trim());
    const q = params.find((p) => /^q=/i.test(p));
    if (q && !(Number(q.slice(2)) > 0)) return false;
    return ["application/pdf", "application/*", "*/*"].includes(
      (type ?? "").toLowerCase(),
    );
  });
}

/**
 * An FDX-shaped error body. `701` (account not found) and `703` (invalid
 * date range) are FDX codes; `602` marks a request the token doesn't
 * authorize. The lowercase codes are Harborline's own.
 */
const fail = (
  c: Context,
  status: 400 | 401 | 404 | 406,
  code: string,
  message: string,
  debugMessage?: string,
) =>
  c.json(
    {
      code,
      message,
      ...(debugMessage ? { debugMessage } : {}),
      note: FICTION_NOTICE,
    },
    status,
    status === 401 ? { "WWW-Authenticate": 'DPoP error="invalid_token"' } : {},
  );
const accountNotFound = (c: Context) =>
  fail(c, 404, "701", "Account not found");

/** A calendar date, `YYYY-MM-DD`, that exists. */
const date = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
};
const count = (value: string | undefined, fallback: number, max: number) => {
  if (value === undefined) return fallback;
  if (!/^\d{1,7}$/.test(value)) return undefined;
  return Math.min(Number(value), max);
};

/**
 * `startTime`, `endTime`, `offset` and `limit`, checked: dates as inclusive
 * UTC days (`703` when malformed or inverted), and a bounded page.
 */
function pageQuery(c: Context) {
  const query = c.req.query();
  const start = query.startTime === undefined ? "" : date(query.startTime);
  const end = query.endTime === undefined ? "9999-12-31" : date(query.endTime);
  if (start === undefined || end === undefined)
    return fail(
      c,
      400,
      "703",
      "Invalid date range",
      "startTime and endTime are calendar dates, YYYY-MM-DD",
    );
  if (start > end)
    return fail(
      c,
      400,
      "703",
      "Invalid date range",
      "startTime is after endTime",
    );
  const offset = count(query.offset, 0, 1000000);
  const limit = count(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  if (offset === undefined || !limit)
    return fail(
      c,
      400,
      "invalid_parameter",
      "Invalid page",
      `offset is a whole number; limit is from 1 to ${MAX_LIMIT}`,
    );
  return { start, end, offset, limit };
}
/** `page`: the total, and the next offset unless this is the last page. */
const page = (offset: number, limit: number, total: number) => ({
  ...(offset + limit < total ? { nextOffset: String(offset + limit) } : {}),
  totalElements: total,
});

export function mountFdx(
  app: Hono,
  ctx: Mount,
  { customerFor }: { customerFor: (id: string) => CustomerState },
) {
  /**
   * What this request may see: its customer, its grant, and the accounts the
   * User chose at consent. A grant without resources sees none here.
   */
  const scope = (c: Context) => {
    const session = ctx.sessionFor(c);
    const grant = ctx.grantFor(c);
    // The gateway refused tokens without a grant; this never answers one.
    if (!grant || !session.account) return undefined;
    const customer = customerFor(session.account);
    const chosen = new Set(grant.resources ?? []);
    // The token's own scopes, which may be fewer than the grant's.
    const granted = (session.scopes ?? "").split(" ");
    return {
      session,
      grant,
      customer,
      accounts: customer.accounts.filter((account) => chosen.has(account.id)),
      detailed: granted.includes("fdx:ACCOUNT_DETAILED"),
    };
  };
  const unauthorized = (c: Context) =>
    fail(c, 401, "602", "The access token doesn't authorize this request");

  app.get(`${FDX_BASE}/accounts`, (c) => {
    const view = scope(c);
    if (!view) return unauthorized(c);
    const asOf = new Date().toISOString();
    return c.json({
      accounts: view.accounts.map((account) =>
        fdxAccount(account, view.detailed, asOf),
      ),
      note: FICTION_NOTICE,
    });
  });

  app.get(`${FDX_BASE}/accounts/:accountId`, (c) => {
    const view = scope(c);
    if (!view) return unauthorized(c);
    const account = view.accounts.find(
      (item) => item.id === c.req.param("accountId"),
    );
    // An account outside the consent is not found, whether or not it exists.
    if (!account) return accountNotFound(c);
    return c.json({
      ...fdxAccount(account, view.detailed, new Date().toISOString()),
      note: FICTION_NOTICE,
    });
  });

  app.get(`${FDX_BASE}/accounts/:accountId/transactions`, (c) => {
    const view = scope(c);
    if (!view) return unauthorized(c);
    const account = view.accounts.find(
      (item) => item.id === c.req.param("accountId"),
    );
    if (!account) return accountNotFound(c);
    const range = pageQuery(c);
    if (range instanceof Response) return range;
    const { start, end, offset, limit } = range;
    // Both dates are inclusive, as UTC calendar days; newest first.
    const matching = view.customer.transactions
      .filter((item) => item.account_id === account.id)
      .filter((item) => {
        const day = item.occurred_at.slice(0, 10);
        return day >= start && day <= end;
      })
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    return c.json({
      page: page(offset, limit, matching.length),
      transactions: matching.slice(offset, offset + limit).map(fdxTransaction),
      note: FICTION_NOTICE,
    });
  });

  /** A chosen account's statements as of now (`statements.ts`). */
  const statementsOf = (c: Context) => {
    const view = scope(c);
    if (!view) return unauthorized(c);
    const account = view.accounts.find(
      (item) => item.id === c.req.param("accountId"),
    );
    if (!account) return accountNotFound(c);
    return {
      view,
      account,
      statements: statementsFor(
        account,
        view.customer.transactions,
        new Date(),
      ),
    };
  };

  app.get(`${FDX_BASE}/accounts/:accountId/statements`, (c) => {
    const found = statementsOf(c);
    if (found instanceof Response) return found;
    const range = pageQuery(c);
    if (range instanceof Response) return range;
    const { start, end, offset, limit } = range;
    // The dates select statement dates, inclusive; newest first.
    const matching = found.statements.filter(
      (item) => item.endDate >= start && item.endDate <= end,
    );
    return c.json({
      page: page(offset, limit, matching.length),
      statements: matching.slice(offset, offset + limit).map(fdxStatement),
      note: FICTION_NOTICE,
    });
  });

  app.get(`${FDX_BASE}/accounts/:accountId/statements/:statementId`, (c) => {
    const found = statementsOf(c);
    if (found instanceof Response) return found;
    const statement = found.statements.find(
      (item) => item.statementId === c.req.param("statementId"),
    );
    // No verified FDX code covers this: Harborline's own.
    if (!statement)
      return fail(c, 404, "statement_not_found", "Statement not found");
    if (!acceptsPdf(c.req.header("accept")))
      return fail(
        c,
        406,
        "not_acceptable",
        "Not acceptable",
        "Statements are served as application/pdf only",
      );
    const pdf = statementPdf(
      statement,
      found.account,
      found.view.customer.name,
    );
    return c.body(pdf as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="harborline-${statement.statementId}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "no-store",
    });
  });

  app.get(`${FDX_BASE}/customers/current`, (c) => {
    const view = scope(c);
    if (!view) return unauthorized(c);
    const parts = view.customer.name.split(" ");
    const first = parts[0] ?? "",
      last = parts.length > 1 ? parts[parts.length - 1]! : "",
      middle = parts.slice(1, -1).join(" ");
    return c.json({
      customerId: view.customer.id,
      name: { first, ...(middle ? { middle } : {}), last },
      email: [view.customer.email],
      note: FICTION_NOTICE,
    });
  });

  /** The consent this request's token was issued under, by ID. */
  const consentOf = (c: Context) => {
    const view = scope(c);
    return view && view.grant.id === c.req.param("consentId")
      ? view
      : undefined;
  };
  // Never another grant's consent, and never whether one exists.
  const consentNotFound = (c: Context) =>
    fail(c, 404, "consent_not_found", "Consent not found");

  app.get(`${FDX_BASE}/consents/:consentId`, (c) => {
    const view = consentOf(c);
    if (!view) return consentNotFound(c);
    return c.json({ ...consentRecord(view), note: FICTION_NOTICE });
  });

  app.put(`${FDX_BASE}/consents/:consentId/revocation`, async (c) => {
    const view = consentOf(c);
    if (!view) return consentNotFound(c);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const field = (value: unknown) =>
      typeof value === "string" && /^[A-Z][A-Z_]{0,39}$/.test(value);
    if (
      !body ||
      typeof body !== "object" ||
      !field((body as Record<string, unknown>).reason) ||
      !field((body as Record<string, unknown>).initiator)
    )
      return fail(
        c,
        400,
        "invalid_parameter",
        "Invalid revocation",
        "Send reason and initiator, for example USER_ACTION and INDIVIDUAL",
      );
    // The consent is the Poppy grant: revoking it ends its tokens and
    // refresh token, as the portal's "disconnect" does (§4.6).
    ctx.grants.revoke(view.session.account!, view.grant.id);
    return c.body(null, 204);
  });

  app.all(`${FDX_BASE}/*`, (c) => fail(c, 404, "not_found", "No such route"));
}

/** The consent as an FDX-shaped record, from the grant it is. */
function consentRecord(view: {
  session: { client: string };
  grant: GrantView;
  customer: CustomerState;
  accounts: Account[];
}) {
  const { grant } = view;
  const clusters = ACCOUNT_CLUSTERS.filter((cluster) =>
    grant.scopes.includes(`fdx:${cluster}`),
  );
  // With offline_access the grant is refreshed for its 7 days; without it,
  // it ends with its first access token (`grantLifetime`), at expirationTime.
  const refreshable = grant.scopes.includes("offline_access");
  const days =
    grant.created_at &&
    Math.round(
      (Date.parse(grant.expires_at) - Date.parse(grant.created_at)) / 86400000,
    );
  return {
    id: grant.id,
    // Only a live grant's own token reaches this record: a revoked or
    // expired consent's tokens fail at the gateway instead.
    status: "ACTIVE",
    parties: [
      { name: "Harborline Bank", type: "DATA_PROVIDER" },
      // The agent's verified host: its client_name is self-asserted.
      { name: new URL(view.session.client).host, type: "DATA_RECIPIENT" },
    ],
    ...(grant.created_at ? { createdTime: grant.created_at } : {}),
    expirationTime: grant.expires_at,
    durationType: refreshable ? "TIME_BOUND" : "ONE_TIME",
    ...(refreshable && days ? { durationPeriod: days } : {}),
    // The chosen accounts and their clusters; CUSTOMER_CONTACT is about
    // the customer, not an account, and shows in no account's clusters.
    resources: clusters.length
      ? view.accounts.map((account) => ({
          resourceType: "ACCOUNT",
          resourceId: account.id,
          dataClusters: clusters,
        }))
      : [],
  };
}

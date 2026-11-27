/**
 * Protocol demo (no model) with Use FDX on: a request to read balances,
 * transactions or statements goes to the native FDX-shaped tools
 * (`poppylab.dev/fdx` v1)
 * instead of the Company's own API. They exist only with Use FDX on, so the
 * tools decide, never the Company's name. The demo invents no account id: it
 * lists the accounts the User shared, then reads each one's transactions or
 * statements. A statement's PDF is the User's to download from the account
 * row; no tool's answer carries its bytes.
 */
type Tool = { execute: (input?: Record<string, unknown>) => Promise<unknown> };
export type FdxDemoTools = Record<string, Tool | undefined>;
export type FdxDemoRead = "balances" | "transactions" | "statements";

/** Accounts whose transactions one demo answer reads. */
const ACCOUNTS = 3;

/** Which read the message asks for, if the FDX-shaped tools can answer it. */
export function demoFdxRead(
  message: string,
  tools: FdxDemoTools,
): FdxDemoRead | undefined {
  if (!tools.fdx_list_accounts) return undefined;
  const lowered = message.toLowerCase();
  if (tools.fdx_list_statements && /statement|extracto/.test(lowered))
    return "statements";
  if (
    tools.fdx_list_transactions &&
    /transaction|movimiento|movements|transacci/.test(lowered)
  )
    return "transactions";
  if (/balance|saldo/.test(lowered)) return "balances";
  return undefined;
}

const refused = (value: unknown) =>
  !!value &&
  typeof value === "object" &&
  typeof (value as { error?: unknown }).error === "string";

/** Reads with the FDX-shaped tools; an error answer is returned as it is. */
export async function demoFdxAnswer(kind: FdxDemoRead, tools: FdxDemoTools) {
  if (kind === "statements") return fdxStatementsByAccount(tools);
  const listed = await tools.fdx_list_accounts!.execute(
    kind === "balances" ? { balances: true } : {},
  );
  if (kind === "balances" || refused(listed)) return listed;
  const accounts = (listed as { accounts?: unknown }).accounts;
  const ids = (Array.isArray(accounts) ? accounts : [])
    .map((a) => (a as { accountId?: unknown } | null)?.accountId)
    .filter((id): id is string => typeof id === "string")
    .slice(0, ACCOUNTS);
  const read = [];
  for (const accountId of ids) {
    const listedAccount = (accounts as Array<Record<string, unknown>>).find(
      (a) => a?.accountId === accountId,
    );
    const moves = await tools.fdx_list_transactions!.execute({ accountId });
    // The account's name, digits and currency, so the answer can say whose
    // transactions these are: the transactions themselves carry none.
    read.push(
      refused(moves) || !moves || typeof moves !== "object"
        ? moves
        : {
            ...(moves as Record<string, unknown>),
            ...pick(listedAccount, [
              "productName",
              "accountNumberDisplay",
              "currency",
            ]),
          },
    );
  }
  return { accounts: read };
}

/**
 * The shared accounts' statements, each list with its account's name,
 * digits and currency: for the demo's answer and the account row alike.
 */
export async function fdxStatementsByAccount(tools: FdxDemoTools) {
  const listed = await tools.fdx_list_accounts!.execute({});
  if (refused(listed)) return listed;
  const accounts = (listed as { accounts?: unknown }).accounts;
  const shared = (Array.isArray(accounts) ? accounts : [])
    .filter(
      (a): a is Record<string, unknown> =>
        !!a && typeof (a as { accountId?: unknown }).accountId === "string",
    )
    .slice(0, ACCOUNTS);
  const read = [];
  for (const account of shared) {
    const statements = await tools.fdx_list_statements!.execute({
      accountId: account.accountId,
    });
    read.push(
      refused(statements) || !statements || typeof statements !== "object"
        ? statements
        : {
            ...(statements as Record<string, unknown>),
            ...pick(account, [
              "productName",
              "accountNumberDisplay",
              "currency",
            ]),
          },
    );
  }
  return { accounts: read };
}

const pick = (from: Record<string, unknown> | undefined, keys: string[]) =>
  Object.fromEntries(
    keys.flatMap((k) => (from?.[k] !== undefined ? [[k, from[k]]] : [])),
  );

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;
function money(amount: unknown, currency: unknown) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  const code =
    typeof (currency as { currencyCode?: unknown })?.currencyCode === "string"
      ? (currency as { currencyCode: string }).currencyCode
      : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}
const day = (value: unknown) =>
  typeof value === "string" ? value.replace("T", " ").slice(0, 16) : undefined;
const lower = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase() : undefined;
const accountName = (a: Record<string, unknown>) =>
  [
    text(a.productName) ?? text(a.accountId) ?? "Account",
    text(a.accountNumberDisplay) ? `···${a.accountNumberDisplay}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

/**
 * A readable answer for the shapes the FDX-shaped tools return, or
 * undefined for anything else (the caller then shows the raw answer).
 */
export function formatFdx(answer: unknown): string | undefined {
  if (!answer || typeof answer !== "object" || refused(answer))
    return undefined;
  const accounts = (answer as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return undefined;
  if (!accounts.length) return "No shared accounts.";
  const lines: string[] = [];
  for (const item of accounts as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.transactions)) {
      lines.push(`${accountName(item)}:`);
      const moves = item.transactions as Array<Record<string, unknown>>;
      if (!moves.length) lines.push("  No transactions.");
      for (const t of moves) {
        const amount = money(t.amount, item.currency);
        const signed =
          amount && t.debitCreditMemo === "DEBIT" ? `−${amount}` : amount;
        lines.push(
          `  - ${[day(t.transactionTimestamp), text(t.description), signed, lower(t.status), text(t.category)].filter(Boolean).join(" · ")}`,
        );
      }
      if (item.truncated === true)
        lines.push("  More transactions exist: ask for a shorter period.");
      continue;
    }
    if (Array.isArray(item.statements)) {
      lines.push(`${accountName(item)}:`);
      const statements = item.statements as Array<Record<string, unknown>>;
      if (!statements.length) lines.push("  No statements.");
      for (const st of statements)
        lines.push(
          `  - ${[text(st.statementDate), text(st.description), lower(st.status)].filter(Boolean).join(" · ")}`,
        );
      if (item.truncated === true)
        lines.push("  More statements exist: ask for a shorter period.");
      continue;
    }
    if (refused(item)) {
      lines.push(`- ${(item as { error: string }).error}`);
      continue;
    }
    lines.push(
      `- ${[accountName(item), lower(item.accountType), lower(item.status)].filter(Boolean).join(" · ")}`,
    );
    const current = money(item.currentBalance, item.currency);
    const available = money(item.availableBalance, item.currency);
    if (current || available)
      lines.push(
        `  ${[current && `Balance ${current}`, available && `available ${available}`, day(item.balanceAsOf) && `as of ${day(item.balanceAsOf)} UTC`].filter(Boolean).join(" · ")}`,
      );
  }
  return lines.join("\n");
}

/** What the demo says around the answer. */
export function demoFdxReply(answer: unknown, show: (v: unknown) => string) {
  // `show` also keeps the exact answer for "Data"; the words are ours.
  const raw = show(answer);
  const shown = formatFdx(answer) ?? raw;
  const error = refused(answer) ? (answer as { error: string }).error : "";
  const statements =
    !error &&
    Array.isArray((answer as { accounts?: unknown })?.accounts) &&
    (
      (answer as { accounts: unknown[] }).accounts as Array<{
        statements?: unknown;
      }>
    ).some((a) => Array.isArray(a?.statements));
  const hint =
    error === "sign_in_required"
      ? " Sign in first; the bank's consent page asks which accounts to share."
      : error === "insufficient_scope"
        ? " This sign-in doesn't include the FDX-shaped data clusters: sign in again with Use FDX on."
        : "";
  const download = statements
    ? "Download a statement as a PDF from Statements in the account row; Iris doesn't read the PDF. "
    : "";
  return `Protocol demo (no LLM). Read through the FDX-shaped tools (poppylab.dev/fdx v1), with only the accounts you shared:\n\n${shown}\n\n${download}${hint ? `${hint.trim()} ` : ""}Turn Use FDX off to read through the Company's own API instead. For natural-language reasoning, select a model.`;
}

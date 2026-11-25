/**
 * Protocol demo (no model) with Use FDX on: a request to read balances or
 * transactions goes to the native FDX-shaped tools (`poppylab.dev/fdx` v1)
 * instead of the Company's own API. They exist only with Use FDX on, so the
 * tools decide, never the Company's name. The demo invents no account id: it
 * lists the accounts the User shared, then reads each one's transactions.
 */
type Tool = { execute: (input?: Record<string, unknown>) => Promise<unknown> };
export type FdxDemoTools = Record<string, Tool | undefined>;
export type FdxDemoRead = "balances" | "transactions";

/** Accounts whose transactions one demo answer reads. */
const ACCOUNTS = 3;

/** Which read the message asks for, if the FDX-shaped tools can answer it. */
export function demoFdxRead(
  message: string,
  tools: FdxDemoTools,
): FdxDemoRead | undefined {
  if (!tools.fdx_list_accounts) return undefined;
  const lowered = message.toLowerCase();
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
  for (const accountId of ids)
    read.push(await tools.fdx_list_transactions!.execute({ accountId }));
  return { accounts: read };
}

/** What the demo says around the answer. */
export function demoFdxReply(answer: unknown, show: (v: unknown) => string) {
  const error = refused(answer) ? (answer as { error: string }).error : "";
  const hint =
    error === "sign_in_required"
      ? " Sign in first; the bank's consent page asks which accounts to share."
      : error === "insufficient_scope"
        ? " This sign-in doesn't include the FDX-shaped data clusters: sign in again with Use FDX on."
        : "";
  return `Protocol demo (no LLM). Read through the FDX-shaped tools (poppylab.dev/fdx v1), with only the accounts you shared:\n\n${show(answer)}\n\n${hint ? `${hint.trim()} ` : ""}Turn Use FDX off to read through the Company's own API instead. For natural-language reasoning, select a model.`;
}

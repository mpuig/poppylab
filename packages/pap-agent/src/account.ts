import {
  browserCaller,
  json,
  readJson,
  toResponse,
  type Caller,
  type CookieStore,
  type Reply,
} from "./web";
import { ProtocolError } from "@poppy-lab/pap-client";
import { decide } from "./account-approvals";
import {
  espiAuthorization,
  fdxConsent,
  fdxStatements,
  useExtension,
} from "./account-extensions";
import { accountRecovery } from "./account-recovery";
import type { AccountHandler, AccountRequest, Action } from "./account-request";
import { signIn, signOut } from "./account-sign-in";
import { connectionAt, connectionNamed } from "./connections";
import {
  companiesView,
  connectionState,
  lostAccess,
  wordsView,
} from "./conversation-view";
import { isAccountCompany, serving } from "./deployment";
import { extensionByKey } from "./domain-extension";
import { keepLines } from "./inspector-log";
import { conversationEnded, overBudget } from "./limits";
import { removeCompany } from "./removing";
import {
  acquireRun,
  createRun,
  readConversation,
  releaseRun,
  type Held,
} from "./runs";
import type { Run } from "./run-types";
import { forgetLostAccount } from "./transcript";
const issuer = "http://juniper.localhost:4100";

/**
 * Each action the page can ask for, and what does it. Use FDX and Use
 * ESPI are named by their extension's key (`useExtension`); `remove` is
 * the one action for a Company the playground may not sign in to.
 */
const ACTIONS = new Map<string, AccountHandler>([
  ["signin", signIn],
  ["signout", signOut],
  ["approve", decide],
  ["decline", decide],
  ["retry", decide],
  ["not_applied", decide],
  ["fdx_consent", fdxConsent],
  ["fdx_revoke", fdxConsent],
  ["espi_authorization", espiAuthorization],
  ["espi_revoke", espiAuthorization],
  ["fdx_statements", fdxStatements],
  ["fdx_statement", fdxStatements],
]);

/** All actions have a tiny fixed schema; bound the stream before parsing. */
async function readAction(request: Request): Promise<Action> {
  const body = await readJson(request, 2048);
  if (!body || typeof body !== "object") throw new Error();
  return body as Action;
}

/**
 * One conversation, as a reload shows it: running, or ended and read-only.
 * `id` names it; a stranger, or a conversation unknown here, is answered
 * `missing`.
 */
export async function readAccount(
  id: string | null,
  caller: Caller,
): Promise<Reply> {
  return (await accountReading(id, caller)).reply;
}
/** `readAccount`'s answer, and the conversation it was read from. */
export async function accountReading(
  id: string | null,
  caller: Caller,
): Promise<{ reply: Reply; run?: Run }> {
  if (!serving())
    return {
      reply: json(
        { error: "Account access is disabled on this deployment." },
        { status: 403 },
      ),
    };
  const visitor = caller.user();
  const run = visitor ? await readConversation(visitor, id) : undefined;
  const reply = json(
    {
      // Unknown here: never started in this browser, or past its keep time.
      missing: !run,
      conversation: run ? id : undefined,
      readOnly: !!run?.archived,
      keptUntil: run?.archived ? run.keepUntil : undefined,
      // What a page that shows one Company reads: the state of the first
      // connection, which is the only one in a conversation with one.
      ...connectionState(run, run?.connections[0]),
      // What the page showed, to show again: the transcript, with Company
      // content and each answer's label, steps and data, and the
      // Inspector's "Session & API calls" lines. Each says which Company it
      // came from. Not the model's context, except in a run that has no
      // transcript yet.
      ...(run ? wordsView(run) : { history: [], log: [] }),
      // Every Company of the conversation with its own state, and the ones
      // that were removed from it.
      ...(run ? companiesView(run) : { connections: [], former: [] }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  return { reply, ...(run ? { run } : {}) };
}
/**
 * One account action (`Action`): `read` gives its body, `conversation`
 * names the conversation, and `shown` is the Company the page shows (the
 * `X-PAP-Company` header), which names the Company when the body doesn't.
 */
export type AccountInput = {
  read: () => Promise<unknown>;
  conversation?: string | undefined;
  shown?: string | null;
};
/** An account action, for any channel, and the conversation it was in. */
export async function accountAction(
  input: AccountInput,
  caller: Caller,
): Promise<Reply & { conversation?: string }> {
  const started: { id?: string } = {};
  const reply = await act(input, caller, started);
  return { ...reply, ...(started.id ? { conversation: started.id } : {}) };
}
/** `GET /api/account?conversation=` as the page reads it. */
export async function accountView(request: Request, cookies: CookieStore) {
  return toResponse(
    await readAccount(
      new URL(request.url).searchParams.get("conversation"),
      await browserCaller(request, cookies),
    ),
  );
}
/** `POST /api/account`, with the conversation in its header both ways. */
export async function account(request: Request, cookies: CookieStore) {
  const done = await accountAction(
    {
      read: () => readAction(request),
      conversation: request.headers.get("x-poppy-conversation") ?? undefined,
      shown: request.headers.get("x-pap-company"),
    },
    await browserCaller(request, cookies),
  );
  const response = toResponse(done);
  if (done.conversation)
    response.headers.set("X-Poppy-Conversation", done.conversation);
  return response;
}

/**
 * The account route's guard, the same for every action: served here, from
 * the playground's own origin, within the budgets, with the conversation
 * held (or a new one started), its body read within its bound, and the
 * connection to the Company it names. Answers instead when any of them
 * fails; the conversation is let go again then.
 */
async function letIn(
  input: AccountInput,
  caller: Caller,
  started: { id?: string },
): Promise<
  | { refused: Reply }
  | {
      visitor: string;
      held: Held;
      body: Action;
      connection: AccountRequest["connection"];
    }
> {
  if (!serving() || !caller.authentic)
    return {
      refused: json(
        { error: "Same-origin requests required" },
        { status: 403 },
      ),
    };
  const visitor = caller.user(true);
  const limited = await overBudget(caller.ip, visitor, "account");
  if (limited) return { refused: limited };
  const named = input.conversation;
  const current = await acquireRun(visitor, named);
  if (current === "busy")
    return {
      refused: json(
        { error: "Wait for the current request." },
        { status: 409 },
      ),
    };
  let held: Held | undefined = current;
  if (!held) {
    // One that ended is still on the page that names it: the page is told,
    // and no sign-in or approval starts in another conversation.
    const over = await conversationEnded(visitor, named);
    if (over) return { refused: over };
    let origin: string;
    try {
      const named = new URL(input.shown ?? issuer);
      if (named.username || named.password || !isAccountCompany(named.origin))
        throw Error();
      origin = named.origin;
    } catch {
      return {
        refused: json(
          { error: "Unsupported account Company." },
          { status: 400 },
        ),
      };
    }
    held = await createRun(visitor, origin);
  }
  started.id = held.id;
  const run = held.run;
  let body: Action;
  try {
    body = (await input.read()) as Action;
  } catch {
    await releaseRun(visitor, held).catch(() => {});
    return {
      refused: json(
        {
          code: "account_request_failed",
          next: "signin",
          error:
            "Account request failed. Retry sign-in, or reconnect if the Company restarted.",
          trace: [],
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  // The Company this action is for: the one the request names, so a
  // sign-in or an approval goes to the Company the User was looking at.
  // `company` names it; without it, the Company the page shows does, which
  // a page with one Company has always sent in this header. A
  // conversation with one Company may leave both out.
  const shown = input.shown;
  const connection = connectionNamed(
    run,
    body.company ?? (shown && connectionAt(run, shown) ? shown : undefined),
  );
  if ("code" in connection) {
    await releaseRun(visitor, held).catch(() => {});
    return {
      refused: json(connection, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      }),
    };
  }
  return { visitor, held, body, connection };
}

/**
 * One account action: let in by `letIn`, done by its handler (`ACTIONS`),
 * and answered with the lines it wrote however it ended, which are kept
 * with the conversation before it is let go.
 */
async function act(
  input: AccountInput,
  caller: Caller,
  started: { id?: string },
): Promise<Reply> {
  const allowed = await letIn(input, caller, started);
  if ("refused" in allowed) return allowed.refused;
  const { visitor, held, body, connection } = allowed;
  const run = held.run;
  if (body.action === "remove") {
    // The User takes this Company out of the conversation, which goes on
    // with the others. Any Company can be removed, whether or not this
    // playground may sign in to it.
    try {
      const removal = await removeCompany(run, connection);
      if (removal.refused)
        return json(
          { ...removal.refused, operations: removal.operations },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      return json(removal, {
        headers: { "Cache-Control": "no-store" },
      });
    } finally {
      await releaseRun(visitor, held).catch(() => {});
    }
  }
  if (!isAccountCompany(new URL(connection.url).origin)) {
    await releaseRun(visitor, held).catch(() => {});
    return json(
      { error: "Connect to a supported account Company first." },
      { status: 400 },
    );
  }
  const trace: string[] = [];
  const request: AccountRequest = {
    run,
    connection,
    caller,
    body,
    trace,
    said: (...lines) => {
      trace.push(...lines);
      return lines;
    },
    written: [],
    knewLost: !!connection.accountUnavailable,
    others: [],
    operationRequested: false,
  };
  const { knewLost } = request;
  const withAccount = !!connection.accountToken;
  try {
    const extension = extensionByKey(body.action);
    if (extension) return await useExtension(request, extension);
    const handler = ACTIONS.get(body.action);
    if (!handler) throw new Error();
    return await handler(request);
  } catch (error) {
    // A request that failed answers with the lines written before it did,
    // as a chat turn does: the page lists what is kept.
    const recovery = accountRecovery(error);
    if (recovery) {
      if (recovery.next === "signin") connection.accountUnavailable = true;
      // With the message about the lost access goes what the page still
      // shows: the answers and proposals Iris got with the account are gone.
      return json(
        { ...recovery, trace, ...lostAccess(run, connection, knewLost) },
        {
          status: recovery.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    if (
      error instanceof ProtocolError &&
      error.retryAt &&
      error.retryAt > Date.now()
    )
      return json(
        {
          error: `${error.message}. Wait before trying again. An uncertain approval is retried with the same approval, never a new proposal.`,
          trace,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.ceil((error.retryAt - Date.now()) / 1000),
            ),
            "Cache-Control": "no-store",
          },
        },
      );
    if (
      error instanceof Error &&
      error.message.startsWith("Set AGENT_PUBLIC_ORIGIN ")
    )
      return json({ error: error.message }, { status: 400 });
    return json(
      {
        code: request.operationRequested
          ? "outcome_unknown"
          : "account_request_failed",
        next: request.operationRequested ? "status" : "signin",
        error: request.operationRequested
          ? "The Company's response is unknown. The change may already have completed. Use Retry the same approval; it is performed at most once. Don't ask for a new proposal yet."
          : "Account request failed. Retry sign-in, or reconnect if the Company restarted.",
        trace,
      },
      {
        status: request.operationRequested ? 502 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } finally {
    keepLines(
      run,
      connection,
      [...request.written, ...trace],
      Date.now(),
      withAccount,
      request.others,
    );
    // However the action ended: a request inside it may have been the one
    // in which the Company refused the sign-in. After the lines are kept,
    // so those written with the account go with the rest.
    forgetLostAccount(run, connection, knewLost);
    await releaseRun(visitor, held).catch(() => {});
  }
}

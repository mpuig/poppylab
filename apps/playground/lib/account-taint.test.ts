/**
 * Random sequences of turns, proposals, approvals and resets in one
 * conversation with up to three Companies. Each text the conversation
 * keeps says which sign-ins' account data is truly in it, and after a
 * sign-in's reset (a new sign-in, a sign-out, a lost access, a removal)
 * none of its data may be left anywhere the conversation keeps words: the
 * model's turns, the transcript, the Inspector's lines, each Company's
 * turns from before its account, and every Company's proposals with
 * their summary, terms, result and stored request.
 *
 * One kind of proposal is left out of the check, as the rules leave it
 * in: an approval that was sent and whose outcome isn't known.
 */
import { describe, expect, it } from "vitest";
import { addConnection } from "./connections";
import { keepLines } from "./inspector-log";
import {
  inheritOperationAccounts,
  noteOperationAccounts,
  operationAccounts,
  recordOperation,
} from "./operation-store";
import type { Connection, Operation, Run, Turn } from "./runtime";
import {
  accountsIn,
  backToPublic,
  forgetCompany,
  forgetLostAccount,
  keepPublicHistory,
  recordDirect,
  recordOutcome,
  recordOwn,
  recordTurn,
  removeConnection,
} from "./transcript";

const ORIGINS = ["https://a.example", "https://b.example", "https://c.example"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Text that says which sign-ins' data is in it: "…|a#1,b#2|". */
const text = (kind: string, taint: Iterable<string>) =>
  `${kind}|${[...new Set(taint)].sort().join(",")}|`;
const taintOf = (content: string | undefined) =>
  new Set(((content ?? "").split("|")[1] ?? "").split(",").filter(Boolean));

/** Everything a proposal holds that the page or a retry could repeat. */
const held = (op: Operation) => JSON.stringify(op);
const taintOfOperation = (op: Operation) => taintOf(op.summary);

/** Every text the conversation keeps, with where it is kept. */
function everything(run: Run): Array<[string, string]> {
  return [
    ...run.history.map((t): [string, string] => ["history", t.content]),
    ...(run.transcript ?? []).map((t): [string, string] => [
      "transcript",
      t.content,
    ]),
    ...(run.log ?? []).map((l): [string, string] => ["log", l.text]),
    ...run.connections.flatMap((c) => [
      ...(c.publicHistory ?? []).map((t): [string, string] => [
        `publicHistory(${c.url})`,
        t.content,
      ]),
      ...Object.values(c.operations ?? {})
        .filter((op) => op.state !== "uncertain")
        .flatMap((op): Array<[string, string]> =>
          // The summary, the terms, the result and the request each carry
          // the same mark.
          [...held(op).matchAll(/[a-z]+\|[^|"]*\|/g)].map((found) => [
            `operation ${op.operation_id} at ${c.url}`,
            found[0],
          ]),
        ),
    ]),
  ];
}

/**
 * One sequence. `legacy` starts from a conversation stored before entries
 * said which Company they came from. `forget` is the mutant: a turn's
 * proposals are not listed with the accounts of the turns the model was
 * sent, which is the defect this file is here for.
 */
function simulate(seed: number, legacy: boolean, forget = false) {
  const random = rng(seed);
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(random() * list.length)]!;
  const epochs: Record<string, number> = {};
  const signin = new Map<Connection, string>();
  const steps: string[] = [];
  let revisions = 0;
  const run: Run = {
    protocol: "1.0",
    expires: Date.now() + 1e6,
    calls: 0,
    busy: false,
    history: [],
    connections: [],
    visitor: "v",
  };
  const mark = (c: Connection) => {
    epochs[c.url] = (epochs[c.url] ?? 0) + 1;
    const id = `${new URL(c.url).host[0]}#${epochs[c.url]}`;
    signin.set(c, id);
    return id;
  };
  if (legacy) {
    const a: Connection = { url: ORIGINS[0]!, user: "" };
    run.connections.push(a);
    const tag = { company: ORIGINS[0]! };
    const pub: Turn[] = [
      { role: "user", content: text("lu", []), ...tag },
      { role: "assistant", content: text("la", []), ...tag },
    ];
    run.history.push(...pub);
    run.transcript = pub.map((t) => ({ ...t, signedOut: true as const }));
    run.log = [{ at: 1, text: text("ll", []), signedOut: true, ...tag }];
    if (random() < 0.7) {
      a.publicHistory = structuredClone(pub);
      a.accountToken = "r";
      const id = mark(a);
      const acc: Turn[] = [
        { role: "user", content: text("lu", [id]), ...tag },
        { role: "assistant", content: text("la", [id]), ...tag },
      ];
      run.history.push(...acc);
      run.transcript.push(...acc);
      run.log.push({ at: 2, text: text("ll", [id]), ...tag });
    }
    steps.push(`legacy(${a.accountToken ? "in" : "out"})`);
  }
  const check = (gone: string, why: string) => {
    for (const [where, content] of everything(run))
      if (taintOf(content).has(gone))
        throw new Error(
          `seed ${seed}${legacy ? " legacy" : ""}: ${gone} survives ${why} in ${where}: ${content}\n${steps.join(" → ")}`,
        );
  };
  /** The Company answers a request with terms that repeat it. */
  const propose = (c: Connection, taint: Iterable<string>) => {
    try {
      return recordOperation(
        c,
        {
          operation_id: `op_${1 + Math.floor(random() * 3)}`,
          revision: `r${++revisions}`,
          summary: text("s", taint),
          terms: { memo: text("t", taint) },
          expires_at: new Date(Date.now() + 600000).toISOString(),
        },
        { url: `${c.url}/api/change`, body: { memo: text("q", taint) } },
      );
    } catch {
      // A performed operation takes no new revision.
      return undefined;
    }
  };
  for (let i = 0; i < 40; i++) {
    const free = ORIGINS.filter(
      (o) => !run.connections.some((c) => c.url === o),
    );
    const r = random();
    if (!run.connections.length || (r < 0.06 && free.length)) {
      const url = pick(free);
      addConnection(run, url);
      steps.push(`add ${url[8]}`);
      continue;
    }
    const c = pick(run.connections);
    const name = c.url[8]!;
    const own = () => (c.accountToken && signin.get(c) ? [signin.get(c)!] : []);
    if (r < 0.3) {
      // A model turn: sent the last ten turns of the whole conversation.
      const context = run.history.slice(-10);
      const taint = new Set([
        ...own(),
        ...context.flatMap((t) => [...taintOf(t.content)]),
      ]);
      // The proposals its requests left are the turn's, as the route
      // notes them when the turn ends.
      const before = new Set(Object.values(c.operations ?? {}));
      const proposed = random() < 0.4 ? propose(c, taint) : undefined;
      recordTurn(run, c, text("u", taint), text("a", taint), {
        context,
        trace: [text("step", taint)],
        company:
          random() < 0.3
            ? [{ author: "x", human: false, text: text("c", taint) }]
            : [],
      });
      run.history = run.history.slice(-10);
      noteOperationAccounts(
        c,
        before,
        accountsIn(run, c, forget ? [] : context),
      );
      keepLines(
        run,
        c,
        [text("l", taint)],
        Date.now(),
        !!c.accountToken,
        accountsIn(run, c, context),
      );
      steps.push(
        `model ${name}${proposed ? ` (${proposed.operation_id})` : ""}`,
      );
    } else if (r < 0.42) {
      // The demo's rules: sent no turns, so the Company's own account only.
      const taint = new Set(own());
      const before = new Set(Object.values(c.operations ?? {}));
      const proposed = random() < 0.3 ? propose(c, taint) : undefined;
      recordTurn(run, c, text("u", taint), text("a", taint), { demo: true });
      run.history = run.history.slice(-10);
      noteOperationAccounts(c, before, accountsIn(run, c));
      keepLines(run, c, [text("l", taint)], Date.now(), !!c.accountToken, []);
      steps.push(
        `demo ${name}${proposed ? ` (${proposed.operation_id})` : ""}`,
      );
    } else if (r < 0.48) {
      const about = random() < 0.5 ? c : undefined;
      recordOwn(
        run,
        about,
        text("u", []),
        text("a", []),
        random() < 0.3 ? false : text("a", []),
      );
      run.history = run.history.slice(-10);
      steps.push(`own ${about ? name : "-"}`);
    } else if (r < 0.58 && c.accountToken) {
      // The User approves one of its proposals, as the account route does.
      const op = Object.values(c.operations ?? {}).find(
        (o) => o.state === "proposed",
      );
      if (!op) continue;
      // What the Company answers repeats the terms, with its own account.
      const taint = new Set([...taintOfOperation(op), ...own()]);
      const others = operationAccounts(c, op.operation_id);
      const how = random();
      if (how < 0.5) {
        op.state = "succeeded";
        op.result = { summary: text("r", taint) };
        delete op.request;
        recordOutcome(run, c, op, "performed", text("o", taint));
      } else if (how < 0.65) {
        op.state = "refused";
        op.result = { summary: text("r", taint) };
        recordOutcome(run, c, op, "declined", text("o", taint));
      } else if (how < 0.8) {
        // A lost answer: the approval stays, to be sent again.
        op.state = "uncertain";
        op.approval = { approved_at: Date.now(), reference: `apr_${i}` };
      } else {
        // New terms in answer to the approval, under this ID or another.
        const request = op.request!;
        const next = recordOperation(
          c,
          {
            operation_id: how < 0.9 ? op.operation_id : `op_n${i}`,
            revision: `r${++revisions}`,
            summary: text("s", taint),
            terms: { memo: text("t", taint) },
            expires_at: new Date(Date.now() + 600000).toISOString(),
          },
          request,
          true,
        );
        inheritOperationAccounts(c, op.operation_id, next.operation_id);
      }
      keepLines(run, c, [text("l", taint)], Date.now(), true, others);
      steps.push(`approve ${name} ${op.operation_id} → ${op.state}`);
    } else if (r < 0.63) {
      const taint = new Set(own());
      recordDirect(
        run,
        c,
        name,
        "say",
        text("d", taint),
        text("a", taint),
        true,
        {
          company: [
            { author: "x", human: false, text: text("c", taint), direct: true },
          ],
        },
      );
      run.history = run.history.slice(-10);
      keepLines(run, c, [text("l", taint)], Date.now(), !!c.accountToken, []);
      steps.push(`direct ${name}`);
    } else if (r < 0.75) {
      // The callback, for a sign-in that may be another account.
      const before = c.accountToken ? signin.get(c) : undefined;
      if (!c.accountToken) keepPublicHistory(run, c);
      c.accountToken = `r${i}`;
      delete c.accountUnavailable;
      backToPublic(run, c);
      keepLines(run, c, [text("signin", [])], Date.now(), false);
      steps.push(`signin ${name}`);
      if (before) check(before, `a new sign-in at ${name}`);
      mark(c);
    } else if (r < 0.84 && c.accountToken) {
      const before = signin.get(c)!;
      delete c.accountToken;
      delete c.accountUnavailable;
      c.operations = {};
      delete c.operationAccounts;
      forgetCompany(run, c);
      steps.push(`signout ${name}`);
      check(before, `sign-out at ${name}`);
    } else if (r < 0.9 && c.accountToken && !c.accountUnavailable) {
      const before = signin.get(c)!;
      c.accountUnavailable = true;
      forgetLostAccount(run, c, false);
      steps.push(`lost ${name}`);
      check(before, `lost access at ${name}`);
      // What is said afterwards is read with no account, yet the code
      // counts it as this sign-in's until the next one: so does this.
    } else if (r < 0.97) {
      const before = c.accountToken ? signin.get(c) : undefined;
      removeConnection(run, c);
      steps.push(`remove ${name}`);
      if (before) check(before, `removing ${name}`);
    }
  }
}

const SEEDS = 2500;
const failures = (forget: boolean) => {
  const found: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++)
    for (const legacy of [false, true])
      try {
        simulate(seed, legacy, forget);
      } catch (error) {
        found.push((error as Error).message);
      }
  return found;
};

describe("what an account's reset leaves, over random sequences", () => {
  it("is nothing of that account: in no turn, entry, line or proposal of any Company", () => {
    const found = failures(false);
    expect(found.slice(0, 3).join("\n\n")).toBe("");
    expect(found).toHaveLength(0);
  });

  it("is found out when a turn's proposals aren't listed with the accounts the model was sent", () => {
    // The check itself has teeth: without the note, another Company's
    // proposal outlives the account it was written from, and so does the
    // model's line about how it ended. Each failure names the first place.
    const found = failures(true);
    for (const where of [/ in operation op_/, / in history: o\|/])
      expect(found.some((failure) => where.test(failure))).toBe(true);
  });
});

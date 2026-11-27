import { randomId } from "@poppy-lab/pap-client";
import { companyProfile } from "@poppy-lab/pap-core";
import { runModel } from "@poppy-lab/llm-adapters/server";
import { agentName } from "./agent";
import { accountNote } from "./account-permissions";
import { companyRef, originOf } from "./connections";
import { companiesView, lostAccess } from "./conversation-view";
import { demoPayBill } from "./demo-pay-bill";
import { modelProvider } from "./free-model";
import { readable } from "./demo-text";
import { offeredTools } from "./routing";
import { connect, type Connection } from "./runtime";
import {
  modelTools,
  newParts,
  recording,
  SEVERAL_LIMITS,
  severalNote,
  severalSteps,
  type Call,
  type Part,
} from "./several";
import { recordTurn } from "./transcript";
import { askAfter, before } from "./chat-answers";
import { companiesNow, turnState, type HeldTurn } from "./chat-turn";
import { spokenText } from "./spoken";
import { json } from "./web";

/**
 * A turn whose task needs several Companies (`several.ts`): the tools of
 * each, every call made with its own Company's Session and sign-in, and
 * an answer that says what went to each. `companies` is in the order the
 * task uses them; `at` is the one it ends at, whose state the answer
 * carries as any turn's, and the page gets all of theirs.
 */
export async function severalTurn(
  turn: HeldTurn,
  companies: Connection[],
  at: Connection,
) {
  const { scope, conversation, lab, provider } = turn;
  scope.parts = newParts(
    companies.map((c) => ({
      connection: c,
      ref: companyRef(conversation, originOf(c)),
      lab: lab.find((l) => originOf(l) === originOf(c))?.id,
    })),
  );
  const parts = scope.parts;
  scope.knewLost = !!at.accountUnavailable;
  scope.stage = "pap";
  for (const part of parts) {
    try {
      part.tools = await connect(part.connection, part.trace, part.shown);
    } catch (error) {
      scope.failure = { connection: part.connection, error };
      throw error;
    }
    part.connection.offered = offeredTools(part.tools);
  }
  conversation.calls++;
  const calls: Call[] = [];
  const tools = parts.map((part) =>
    recording(part, calls, (c, error) => {
      scope.failure = { connection: c, error };
    }),
  );
  if (provider === "demo") {
    // Demo mode's one example across two Companies: the bill at the
    // first, its payment at the second (`demo-pay-bill.ts`). The answer
    // is about the one where something waits for the User, a sign-in
    // under the answer, or else where the task ended.
    const signedIn = (part: Part) =>
      !!part.connection.accountToken && !part.connection.accountUnavailable;
    const [biller, bank] = parts as [Part, Part];
    const done = await demoPayBill(
      {
        tools: tools[0]!,
        name: biller.ref.name,
        signedIn: signedIn(biller),
      },
      { tools: tools[1]!, name: bank.ref.name, signedIn: signedIn(bank) },
      randomId,
      readable,
    );
    const end = done.at === "biller" ? biller : bank;
    scope.connection = end.connection;
    scope.knewLost = end.knewLost;
    return severalAnswer(turn, end.connection, done.text, calls, true);
  }
  scope.stage = "provider";
  scope.context = conversation.history.slice(-10);
  const offered = modelTools(parts, tools);
  for (const { part, count } of offered.left)
    part.trace.push(
      `Offered the model ${Object.keys(part.tools).length - count} of ${part.ref.name}'s ${Object.keys(part.tools).length} tools · at most ${SEVERAL_LIMITS.tools} in a turn with several Companies`,
    );
  const text = await runModel(
    modelProvider(provider),
    [
      ...scope.context.map(({ role, content }) => ({ role, content })),
      { role: "user", content: turn.asked },
    ],
    offered.tools,
    {
      ...turn.modelConfig,
      name: agentName(),
      steps: SEVERAL_LIMITS.steps,
      // Whose each tool is and what may cross between them (§10.1),
      // then the User's account at each, as a turn with one is told.
      context: [
        severalNote(parts),
        ...parts.map(({ connection: c }) =>
          accountNote(c.company!.document.organization.name, {
            signedIn: !!c.accountToken,
            lost: !!c.accountUnavailable,
            granted: c.scopes ?? "",
            profile: companyProfile(c.company!),
          }),
        ),
      ].join("\n\n"),
    },
  );
  return severalAnswer(turn, at, text, calls, false);
}

/**
 * The answer to a turn with several Companies, kept as any turn is:
 * each step and each piece of Company content with its own Company,
 * "Data" with each call's, and the turn as holding what any of them
 * showed with the User's account.
 */
function severalAnswer(
  turn: HeldTurn,
  at: Connection,
  text: string,
  calls: Call[],
  demo: boolean,
) {
  const { scope, conversation } = turn;
  const { parts, trace } = scope;
  const exact = calls.length
    ? JSON.stringify(calls).slice(0, 20000)
    : undefined;
  const steps = severalSteps(parts, trace);
  const content = parts.flatMap((part) =>
    part.shown.map((entry) => ({ ...entry, company: part.ref.origin })),
  );
  recordTurn(conversation, at, turn.asked, text, {
    company: content,
    steps,
    turn: parts.map((part) => part.connection),
    demo,
    data: exact,
    context: scope.context,
    typed: turn.typed,
  });
  conversation.history = conversation.history.slice(-10);
  // What waits for the User now, asked in the agent's own words: a
  // proposal at any of them, or the sign-in the task stopped for.
  const question = askAfter(turn, scope.before ?? before(conversation), [
    ...parts
      .filter((part) => part.connection !== at)
      .map((part) => ({ connection: part.connection, trace: part.trace })),
    ...parts
      .filter((part) => part.connection === at)
      .map((part) => ({ connection: part.connection, trace: part.trace })),
  ]);
  // Any of them may have stopped taking the sign-in during the turn.
  let lost: Record<string, unknown> = {};
  for (const part of parts) {
    const gone = lostAccess(conversation, part.connection, part.knewLost);
    if (!gone) continue;
    const { operations, ...rest } = gone;
    lost = {
      ...lost,
      ...rest,
      ...(part.connection === at ? { operations } : {}),
    };
  }
  const from = companyRef(conversation, originOf(at));
  return json(
    {
      text,
      spoken: spokenText(text),
      ...(question ? { question } : {}),
      ...(exact !== undefined ? { data: exact } : {}),
      trace: [...trace, ...parts.flatMap((part) => part.trace)],
      // Each Company's own lines, for the Inspector to say whose.
      traces: [
        ...(trace.length ? [{ from, trace }] : []),
        ...parts.map((part) => ({ from: part.ref, trace: part.trace })),
      ],
      steps,
      using: parts.map((part) => part.ref),
      mode: turn.provider,
      from,
      ...(scope.did.before ? { before: scope.did.before } : {}),
      ...turnState(at),
      company: parts.flatMap((part) =>
        part.shown.map((entry) => ({ ...entry, from: part.ref })),
      ),
      ...companiesNow(turn),
      ...lost,
      // Each Company's state, its proposals among it: a proposal at
      // each makes its own card in Needs you.
      ...companiesView(conversation),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

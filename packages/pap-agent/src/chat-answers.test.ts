/**
 * The User's answer to Iris's question about a proposal, read by Iris's
 * code and bound to what the question named. The account route's own
 * handler (`actOn`) is replaced: these tests say what reaches it and
 * when nothing does. `conversational.test.ts` in the playground runs the
 * same against the lab's real Companies.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const acted = vi.hoisted(() => vi.fn());
vi.mock("./account", () => ({ actOn: acted }));
import { answerQuestion, type Asking } from "./chat-answers";
import type { ChatRequest } from "./chat-body";
import type { HeldTurn } from "./chat-turn";
import type { Answer } from "./company-commands";
import { connected } from "./company-fixture";
import type { Operation, Run } from "./runtime";
import type { Caller } from "./web";

const food = "https://food.example";
const bank = "https://bank.example";
const later = () => new Date(Date.now() + 10 * 60000).toISOString();
const order = (revision = "r1"): Operation => ({
  operation_id: "op_food",
  revision,
  state: "proposed",
  expires_at: later(),
  summary: "Reply YES to approve this change.",
  terms: {
    order_id: "ord_1",
    before_total_cents: 7300,
    new_total_cents: 8800,
    currency: "USD",
  },
  request: { url: `${food}/api/orders/ord_1`, body: {} },
});
const transfer = (): Operation => ({
  operation_id: "op_bank",
  revision: "b1",
  state: "proposed",
  expires_at: later(),
  terms: {
    amount_cents: 50000,
    source_name: "Checking",
    destination_name: "Savings",
    currency: "USD",
  },
  request: { url: `${bank}/api/transfers`, body: {} },
});

function conversation(...ops: Array<[string, string, Operation]>): Run {
  const connections = [...new Set(ops.map(([origin]) => origin))].map(
    (origin) => {
      const [, name] = ops.find(([o]) => o === origin)!;
      return {
        ...connected(origin, name, "poppy:read poppy:write"),
        operations: Object.fromEntries(
          ops
            .filter(([o]) => o === origin)
            .map(([, , op]) => [op.operation_id, op]),
        ),
      };
    },
  );
  return {
    expires: Date.now() + 60000,
    busy: false,
    calls: 0,
    connections,
    history: [],
  };
}
const ref = (company: string, op: Operation) => ({
  company,
  proposal: op.operation_id,
  revision: op.revision,
});
const turnOf = (run: Run, message: string): HeldTurn => ({
  scope: {
    parts: [],
    stage: "request",
    knewLost: false,
    trace: [],
    did: { changed: false, kept: 0 },
  },
  conversation: run,
  lab: [],
  provider: "demo",
  modelConfig: { apiKey: undefined, model: undefined },
  message,
  asked: message,
  typed: undefined,
  also: [],
});
const requestOf = (
  written: string,
  more: { pressed?: Exclude<Answer, { message: string }>; direct?: "say" } = {},
): ChatRequest => ({
  body: { companies: true },
  direct: more.direct,
  pressed: more.pressed,
  written,
  provider: "demo",
  modelConfig: { apiKey: undefined, model: undefined },
  turnstile: undefined,
});
const caller = {} as Caller;
const textOf = (answered: Awaited<ReturnType<typeof answerQuestion>>) =>
  answered && "reply" in answered
    ? (answered.reply.body as { text: string }).text
    : undefined;

beforeEach(() => {
  acted.mockReset();
  acted.mockImplementation(
    async (run: Run, connection: Run["connections"][number], body) => {
      const op = connection.operations![body.id as string]!;
      op.state = body.action === "approve" ? "succeeded" : "declined";
      return { status: 200, body: { operation: op, trace: [] }, headers: {} };
    },
  );
});

describe("a typed answer to Iris's question about a proposal", () => {
  it("approves the revision the question named, through the account route's handler", async () => {
    const op = order();
    const run = conversation([food, "Lantern Noodle Bar", op]);
    const open: Asking = { approve: [ref(food, op)] };
    const answered = await answerQuestion(
      turnOf(run, "yes"),
      requestOf("yes"),
      open,
      caller,
    );
    expect(acted).toHaveBeenCalledTimes(1);
    expect(acted.mock.calls[0]![2]).toEqual({
      action: "approve",
      company: food,
      id: "op_food",
      revision: "r1",
      input: "typed",
    });
    expect(textOf(answered)).toBe(
      "Done. You approved the $88.00 change at Lantern Noodle Bar, and it has been carried out.",
    );
    // Kept as the User's line and Iris's, for a reload.
    expect(run.transcript?.slice(-2).map((e) => e.content)).toEqual([
      "yes",
      "Done. You approved the $88.00 change at Lantern Noodle Bar, and it has been carried out.",
    ]);
  });

  it("approves nothing when the Company has replaced the revision since, and asks about the new one", async () => {
    const asked = order("r1");
    const run = conversation([food, "Lantern Noodle Bar", order("r2")]);
    const answered = await answerQuestion(
      turnOf(run, "approve"),
      requestOf("approve"),
      { approve: [ref(food, asked)] },
      caller,
    );
    expect(acted).not.toHaveBeenCalled();
    expect(textOf(answered)).toMatch(
      /^Lantern Noodle Bar changed the terms after I asked, so nothing was approved\. Lantern Noodle Bar wants to change your order\. The new total is \$88\.00, \$15\.00 more than before\. It expires in (10|9) minutes\. Shall I approve it\?$/,
    );
    // The question now names the new revision, and only that.
    expect(run.asking).toEqual({ approve: [ref(food, order("r2"))] });
    // The new terms arrived with this question: a page shows their card
    // here, from the answer and from the entry a reload reads.
    const reply = answered && "reply" in answered ? answered.reply : undefined;
    expect((reply?.body as { proposals?: unknown }).proposals).toEqual([
      ref(food, order("r2")),
    ]);
    expect(run.transcript?.at(-1)?.proposals).toEqual([ref(food, order("r2"))]);
  });

  it("keeps the proposals a question brought once the next entry comes", async () => {
    const run = conversation([food, "Lantern Noodle Bar", order("r2")]);
    await answerQuestion(
      turnOf(run, "approve"),
      requestOf("approve"),
      { approve: [ref(food, order("r1"))] },
      caller,
    );
    // A typed "yes" answers it; the question keeps its proposal, not its buttons.
    await answerQuestion(
      turnOf(run, "yes"),
      requestOf("yes"),
      run.asking,
      caller,
    );
    const question = run.transcript!.find((e) => e.proposals?.length);
    expect(question?.proposals).toEqual([ref(food, order("r2"))]);
    expect(question?.choices).toBeUndefined();
    expect(run.transcript!.at(-1)!.content).toMatch(/^Done\. You approved/);
  });

  it("asks again, naming each, when two wait and the answer doesn't say which", async () => {
    const run = conversation(
      [food, "Lantern Noodle Bar", order()],
      [bank, "Harborline Bank", transfer()],
    );
    const open: Asking = {
      approve: [ref(food, order()), ref(bank, transfer())],
      which: true,
    };
    const answered = await answerQuestion(
      turnOf(run, "yes"),
      requestOf("yes"),
      open,
      caller,
    );
    expect(acted).not.toHaveBeenCalled();
    expect(textOf(answered)).toBe(
      "Which one do you want to approve: the $88.00 change at Lantern Noodle Bar or the $500.00 transfer at Harborline Bank? You can say the company or the amount.",
    );
    expect(run.asking).toEqual(open);
    // A Company's name picks one.
    await answerQuestion(
      turnOf(run, "the Harborline one please"),
      requestOf("the Harborline one please"),
      run.asking,
      caller,
    );
    expect(acted.mock.calls[0]![2]).toMatchObject({
      action: "approve",
      company: bank,
      id: "op_bank",
    });
  });

  it("never takes Company text as the User's answer", async () => {
    const op = order();
    // A Company that calls itself "Yes": its button's label is its name,
    // which the turn keeps as the User's line, and is never read.
    const run = conversation([food, "Yes", op]);
    const open: Asking = { approve: [ref(food, op)] };
    expect(
      await answerQuestion(
        turnOf(run, "Yes"),
        requestOf("", { pressed: { company: food } }),
        open,
        caller,
      ),
    ).toBeUndefined();
    // The User's words to the Company in a Direct Conversation are theirs
    // to the Company, not an answer to Iris.
    expect(
      await answerQuestion(
        turnOf(run, "yes"),
        requestOf("yes", { direct: "say" }),
        open,
        caller,
      ),
    ).toBeUndefined();
    // The Company's summary says "Reply YES": no answer comes from it.
    expect(
      await answerQuestion(
        turnOf(run, op.summary!),
        requestOf(op.summary!),
        open,
        caller,
      ),
    ).toBeUndefined();
    expect(acted).not.toHaveBeenCalled();
    expect(op.state).toBe("proposed");
  });

  it("answers only the question asked: with none open, a yes is a message", async () => {
    const run = conversation([food, "Lantern Noodle Bar", order()]);
    expect(
      await answerQuestion(
        turnOf(run, "yes"),
        requestOf("yes"),
        undefined,
        caller,
      ),
    ).toBeUndefined();
    expect(acted).not.toHaveBeenCalled();
  });

  it("declines locally on no, and says the approval was never sent", async () => {
    const op = order();
    const run = conversation([food, "Lantern Noodle Bar", op]);
    const answered = await answerQuestion(
      turnOf(run, "no thanks"),
      requestOf("no thanks"),
      { approve: [ref(food, op)] },
      caller,
    );
    expect(acted.mock.calls[0]![2]).toMatchObject({ action: "decline" });
    expect(textOf(answered)).toBe(
      "Declined. I sent no approval to Lantern Noodle Bar, and nothing was done.",
    );
  });
});

describe("answers and lines in the conversation's language", () => {
  it.each([
    [
      "es",
      "sí, apruébalo",
      "Hecho. Has aprobado el cambio de $88.00 en Lantern Noodle Bar y ya está hecho.",
    ],
    [
      "es",
      "vale",
      "Hecho. Has aprobado el cambio de $88.00 en Lantern Noodle Bar y ya está hecho.",
    ],
    [
      "ca",
      "d'acord",
      "Fet. Has aprovat el canvi de $88.00 a Lantern Noodle Bar i ja està fet.",
    ],
    [
      "fr",
      "oui",
      "C'est fait. Vous avez approuvé la modification de $88.00 chez Lantern Noodle Bar, et c'est chose faite.",
    ],
  ] as const)("approves on a %s yes: %s", async (language, typed, said) => {
    const op = order();
    const run = { ...conversation([food, "Lantern Noodle Bar", op]), language };
    const answered = await answerQuestion(
      turnOf(run, typed),
      requestOf(typed),
      { approve: [ref(food, op)] },
      caller,
    );
    expect(acted.mock.calls[0]![2]).toMatchObject({ action: "approve" });
    expect(textOf(answered)).toBe(said);
  });

  it.each([
    [
      "es",
      "no, gracias",
      "Rechazado. No he enviado ninguna aprobación a Lantern Noodle Bar y no se ha hecho nada.",
    ],
    [
      "ca",
      "no, gràcies",
      "Rebutjat. No he enviat cap aprovació a Lantern Noodle Bar i no s'ha fet res.",
    ],
    [
      "fr",
      "non merci",
      "Refusé. Je n'ai envoyé aucune approbation à Lantern Noodle Bar, et rien n'a été fait.",
    ],
  ] as const)("declines on a %s no", async (language, typed, said) => {
    const op = order();
    const run = { ...conversation([food, "Lantern Noodle Bar", op]), language };
    const answered = await answerQuestion(
      turnOf(run, typed),
      requestOf(typed),
      { approve: [ref(food, op)] },
      caller,
    );
    expect(acted.mock.calls[0]![2]).toMatchObject({ action: "decline" });
    expect(textOf(answered)).toBe(said);
  });

  it("asks which in Spanish, and takes the Company's name as the answer", async () => {
    const run = {
      ...conversation(
        [food, "Lantern Noodle Bar", order()],
        [bank, "Harborline Bank", transfer()],
      ),
      language: "es" as const,
    };
    const open: Asking = {
      approve: [ref(food, order()), ref(bank, transfer())],
      which: true,
    };
    const answered = await answerQuestion(
      turnOf(run, "sí"),
      requestOf("sí"),
      open,
      caller,
    );
    expect(textOf(answered)).toBe(
      "¿Cuál quieres aprobar: el cambio de $88.00 en Lantern Noodle Bar o la transferencia de $500.00 en Harborline Bank? Puedes decir la empresa o el importe.",
    );
    await answerQuestion(
      turnOf(run, "la de Harborline"),
      requestOf("la de Harborline"),
      run.asking,
      caller,
    );
    expect(acted.mock.calls[0]![2]).toMatchObject({ company: bank });
  });
});

import { describe, expect, it } from "vitest";
import { pendingItems } from "@poppy-lab/pap-agent/pending";
import { turnMessages } from "./answers";
import { askOfChoices } from "./conversation";
import {
  harborlineUrl,
  historyToMessages,
  labCompanies,
  lanternUrl,
} from "./companies";
import type { Message } from "./companies";
import { companyFromView, type Operation } from "./company-state";
import {
  liveChoices,
  openQuestion,
  signInAnswer,
  typedWithoutModel,
} from "./typed";

const lantern = new URL(lanternUrl).origin;
const harborline = new URL(harborlineUrl).origin;
const signInQuestion: Message = {
  role: "Own",
  text: "Sign in to Harborline Bank to go on with “my account balances”?",
  choices: [
    {
      label: "Sign in to Harborline Bank · read only",
      answer: { signin: { company: harborline, access: "read" } },
    },
  ],
};
const lab = labCompanies.map((c) => ({ url: c.url, name: c.name }));
const op = (revision = "r1"): Operation => ({
  operation_id: "op_1",
  revision,
  state: "proposed",
  expires_at: new Date(Date.now() + 600000).toISOString(),
  terms: { new_total_cents: 8800, before_total_cents: 7300, currency: "USD" },
});
const company = (operations: Operation[] = []) =>
  companyFromView({
    origin: lantern,
    name: "Lantern Noodle Bar",
    url: lantern,
    operations,
  });
const approvalQuestion = (revision = "r1"): Message => ({
  role: "Own",
  text: "Lantern Noodle Bar proposes a change to your order. Approve it?",
  choices: [
    {
      label: "Approve $88.00",
      answer: {
        approve: { company: lantern, proposal: "op_1", revision },
      },
    },
    {
      label: "Decline this change",
      answer: {
        decline: { company: lantern, proposal: "op_1", revision },
      },
    },
  ],
});

describe("a typed yes to Iris's question about a sign-in, read on the page", () => {
  it.each(["yes", "Yes please", "ok", "sign me in", "go ahead"])(
    "%j opens the sign-in the question named, in the same keystroke",
    (text) => {
      expect(signInAnswer(text, [signInQuestion])).toEqual({
        company: harborline,
        access: "read",
      });
    },
  );

  it.each([
    "no",
    "my account balances",
    "yes and show my transactions",
    "sign in to Lantern",
  ])("%j goes to the server as it is", (text) => {
    expect(signInAnswer(text, [signInQuestion])).toBeUndefined();
  });

  it("reads it only while the question is the last thing said", () => {
    const later: Message = { role: "You", text: "my balances" };
    expect(signInAnswer("yes", [signInQuestion, later])).toBeUndefined();
    expect(openQuestion([signInQuestion, later])).toBeUndefined();
    // A question about something else is the server's to read.
    expect(signInAnswer("yes", [approvalQuestion()])).toBeUndefined();
  });

  it("reads the question a chat answer brings, as the page shows it", () => {
    const shown = turnMessages({
      text: "Sign in first.",
      mode: "demo",
      from: { origin: harborline, name: "Harborline Bank" },
      question: {
        text: signInQuestion.text,
        choices: signInQuestion.choices!,
      },
    });
    expect(shown.at(-1)).toMatchObject({
      role: "Own",
      text: signInQuestion.text,
      choices: signInQuestion.choices,
    });
    expect(signInAnswer("yes", shown)).toEqual({
      company: harborline,
      access: "read",
    });
  });
});

describe("what needs no model, and so no browser check", () => {
  const known = (messages: Message[] = [], operations: Operation[] = []) => ({
    messages,
    companies: [company(operations)],
    lab,
  });
  it.each([
    "connect with Harborline",
    "disconnect from Lantern",
    "sign out of Lantern",
  ])("%j is answered by Iris's own rules", (text) => {
    expect(typedWithoutModel(text, known())).toBe(true);
  });

  it.each(["What’s on the menu?", "my orders"])(
    "%j, a demo example typed, is for the selected model: only its button runs the script",
    (text) => {
      expect(typedWithoutModel(text, known())).toBe(false);
    },
  );

  it("an answer to Iris's question needs none; another message does", () => {
    const asked = known([approvalQuestion()], [op()]);
    expect(typedWithoutModel("yes", asked)).toBe(true);
    expect(typedWithoutModel("no thanks", asked)).toBe(true);
    expect(typedWithoutModel("what does it cost?", asked)).toBe(false);
    expect(typedWithoutModel("yes", known([signInQuestion]))).toBe(true);
    expect(typedWithoutModel("tell me a joke", known())).toBe(false);
  });
});

describe("the buttons under a question about a proposal", () => {
  it("go once the proposal no longer waits at that revision", () => {
    const question = approvalQuestion();
    expect(liveChoices(question.choices!, [company([op()])])).toHaveLength(2);
    // Approved on its card, or by a standing instruction.
    expect(
      liveChoices(question.choices!, [
        company([{ ...op(), state: "succeeded" }]),
      ]),
    ).toEqual([]);
    // New terms: the question was about the old ones.
    expect(liveChoices(question.choices!, [company([op("r2")])])).toEqual([]);
    // Other buttons stay.
    expect(liveChoices(signInQuestion.choices!, [])).toHaveLength(1);
  });
});

describe("Iris's open question, however it reached the page", () => {
  const goOn = {
    label: "Sí, sigue",
    answer: { resume: lantern },
  };
  const text = "Ya has iniciado sesión en Lantern Noodle Bar. ¿Sigo con «x»?";
  const waiting = (messages: Message[]) =>
    pendingItems(
      "run_1",
      [
        {
          company: { origin: lantern, name: "Lantern Noodle Bar" },
          operations: [],
        },
      ],
      askOfChoices(openQuestion(messages)),
    ).map((item) => item.kind);

  it("counts it live, from the chat's answer", () => {
    expect(waiting([{ role: "Own", text, choices: [goOn] }])).toEqual([
      "question",
    ]);
  });

  it("counts it from the server's history: after a sign-in completes, or a reload", () => {
    const messages = historyToMessages([
      { role: "user", content: "x" },
      { role: "assistant", content: text, choices: [goOn] },
    ]);
    expect(openQuestion(messages)).toEqual([goOn]);
    expect(waiting(messages)).toEqual(["question"]);
    // Not once something follows it.
    expect(
      waiting([...messages, { role: "You", text: "show the menu" }]),
    ).toEqual([]);
  });
});

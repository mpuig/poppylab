import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewOperation } from "@/lib/operation-presentation";
import { Conversation } from "./conversation";
import { companyFromView } from "./company-state";
import type { Playground } from "./use-playground";

const summary = "Change order ord_LNB1001. New total USD 43.00.";
/** The demo's answer about a change, as the chat route writes it. */
const answer = {
  role: "Demo" as const,
  text: `Protocol demo (no LLM). The demo read your scheduled order ord_LNB1001 and asked for: add 1 × Matcha ice cream.\n\nThe company answered:\n\nThe company is holding this change until you approve it:\n${summary}\n\nThe Company holds a change until you click Approve. For natural-language reasoning, select a model.`,
  data: JSON.stringify({
    status: "approval_required",
    operation_id: "op_1",
    summary,
  }),
};
const operation = (marks: Partial<ReviewOperation>): ReviewOperation => ({
  operation_id: "op_1",
  revision: "1",
  state: "proposed",
  summary,
  terms: { new_total_cents: 4300, currency: "USD" },
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  ...marks,
});
/** The chat as the page shows it: only what this view reads of the hook. */
const chat = (op: ReviewOperation) =>
  renderToStaticMarkup(
    createElement(Conversation, {
      p: {
        companies: [
          companyFromView({
            origin: "http://noodles.localhost:4200",
            name: "Lantern Noodle Bar",
            operations: [op],
          }),
        ],
        former: [],
        busy: false,
        readOnly: true,
        messages: [{ role: "You", text: "Add a matcha ice cream" }, answer],
        instructions: {},
        heldBack: {},
      } as unknown as Playground,
      transcript: { current: null },
      taskInput: { current: null },
    }),
  );

it("shows the demo's answer as written while its change waits for the person", () => {
  for (const op of [
    operation({}),
    // Approved by the person: they did click Approve.
    operation({ state: "succeeded", approvedBy: { approver: "user" } }),
  ]) {
    const html = chat(op);
    expect(html).toContain(
      "The company is holding this change until you approve it:",
    );
    expect(html).toContain(
      "The Company holds a change until you click Approve. For natural-language reasoning, select a model.",
    );
  }
});

it("says in the demo's answer that Iris approved the change, once it did", () => {
  const html = chat(
    operation({
      state: "succeeded",
      approvedBy: {
        approver: "agent",
        rule: "$43.00 within your limit of $50.00",
      },
    }),
  );
  expect(html).toContain("The company held this change until it was approved:");
  expect(html).toContain(
    "Iris approved this change on your standing instruction, so there is nothing for you to approve. For natural-language reasoning, select a model.",
  );
  expect(html).not.toContain("holds a change");
  expect(html).not.toContain("until you click Approve");
  expect(html).not.toContain("is holding this change");
});

import { describe, expect, it } from "vitest";
import {
  allowanceReason,
  MAX_PER_HOUR,
} from "@poppy-lab/pap-agent/auto-approval";
import type {
  Approval,
  Instruction,
} from "@poppy-lab/pap-agent/standing-instructions";
import { harborlineUrl, lanternUrl, type Message } from "./companies";
import {
  companyFromView,
  type CompanyState,
  type Operation,
} from "./company-state";
import {
  applyRetryMessage,
  pickAutoApproval,
  retryOriginFor,
  type PageMessage,
} from "./use-playground";

const lantern = new URL(lanternUrl).origin;
const harborline = new URL(harborlineUrl).origin;

const future = () => new Date(Date.now() + 10 * 60_000).toISOString();

const instruction: Instruction = {
  maxCents: 2500,
  currency: "USD",
};

const proposal = (id: string, more: Partial<Operation> = {}): Operation => ({
  operation_id: id,
  revision: "1",
  state: "proposed",
  summary: `Order ${id} for $12.00`,
  terms: { total_cents: 1200, currency: "USD" },
  expires_at: future(),
  ...more,
});

const signedInCompany = (
  origin: string,
  name: string,
  operations: Operation[],
): CompanyState =>
  companyFromView({
    origin,
    name,
    signedIn: true,
    scopes: "orders:write",
    operations,
  });

describe("pickAutoApproval across multiple Companies", () => {
  it("continues past an already-recorded left decision so a later Company's proposal is approved", () => {
    const reason = allowanceReason("count", instruction);
    const recentFull: Approval[] = Array.from({ length: MAX_PER_HOUR }, () => ({
      at: Date.now() - 1000,
      cents: 500,
    }));
    const first = signedInCompany(lantern, "Lantern Noodle Bar", [
      proposal("op_lantern", { notApplied: reason }),
    ]);
    const second = signedInCompany(harborline, "Harborline Bank", [
      proposal("op_harbor"),
    ]);

    const decided = new Map<string, Set<string>>();
    const decidedAt = (origin: string) => {
      let set = decided.get(origin);
      if (!set) decided.set(origin, (set = new Set()));
      return set;
    };

    const picked = pickAutoApproval(
      [first, second],
      { [lantern]: instruction, [harborline]: instruction },
      false,
      decidedAt,
      (origin) => (origin === lantern ? recentFull : []),
    );

    expect(picked.heldBack).toEqual([
      { key: `${lantern} op_lantern:1`, reason },
    ]);
    expect(picked.action).toMatchObject({
      kind: "approve",
      company: second,
      op: expect.objectContaining({ operation_id: "op_harbor" }),
      cents: 1200,
    });
  });

  it("stops to record an unrecorded left decision on the server first", () => {
    const reason = allowanceReason("count", instruction);
    const recentFull: Approval[] = Array.from({ length: MAX_PER_HOUR }, () => ({
      at: Date.now() - 1000,
      cents: 500,
    }));
    const first = signedInCompany(lantern, "Lantern Noodle Bar", [
      proposal("op_lantern"),
    ]);
    const second = signedInCompany(harborline, "Harborline Bank", [
      proposal("op_harbor"),
    ]);

    const decided = new Map<string, Set<string>>();
    const decidedAt = (origin: string) => {
      let set = decided.get(origin);
      if (!set) decided.set(origin, (set = new Set()));
      return set;
    };

    const picked = pickAutoApproval(
      [first, second],
      { [lantern]: instruction, [harborline]: instruction },
      false,
      decidedAt,
      (origin) => (origin === lantern ? recentFull : []),
    );

    expect(picked.heldBack).toEqual([
      { key: `${lantern} op_lantern:1`, reason },
    ]);
    expect(picked.action).toMatchObject({
      kind: "left",
      company: first,
      allowance: "count",
    });
  });
});

describe("retryMessage provenance", () => {
  it("restores a failed typed message into the composer and drops only its own bubble", () => {
    const earlier: Message = { role: "You", text: "Check my orders" };
    const reply: Message = { role: "Agent", text: "You have one order." };
    const failed: Message = { role: "You", text: "Check my orders" };
    const retry = retryOriginFor({ message: "Check my orders" }, [failed]);
    const list: PageMessage[] = [
      earlier,
      reply,
      failed,
      { role: "Error", text: "Network error", ...(retry ? { retry } : {}) },
    ];

    const next = applyRetryMessage(list, 3);
    expect(next.task).toBe("Check my orders");
    expect(next.messages).toEqual([earlier, reply]);
  });

  it("never pulls an unrelated earlier You message into the composer when a direct action fails", () => {
    const earlier: Message = { role: "You", text: "Track my order" };
    const reply: Message = { role: "Agent", text: "They invited you to talk." };
    const retry = retryOriginFor(
      { message: "Talk to the Company directly" },
      [],
    );
    expect(retry).toBeUndefined();

    const list: PageMessage[] = [
      earlier,
      reply,
      {
        role: "Error",
        text: "Could not join direct conversation",
        ...(retry ? { retry } : {}),
      },
    ];

    const next = applyRetryMessage(list, 2);
    expect(next.task).toBeUndefined();
    expect(next.messages).toEqual([earlier, reply]);
  });

  it("never pulls a quick-reply button label into the composer, and restores the question", () => {
    const earlier: Message = { role: "You", text: "Check my balance" };
    const question: Message = {
      role: "Own",
      text: "Which company?",
      choices: [{ label: "Harborline Bank", answer: { company: harborline } }],
    };
    const choiceBubble: Message = { role: "You", text: "Harborline Bank" };
    const retry = retryOriginFor({ answer: { company: harborline } }, [
      choiceBubble,
    ]);
    expect(retry).toEqual({ said: choiceBubble });

    const list: PageMessage[] = [
      earlier,
      question,
      choiceBubble,
      { role: "Error", text: "Chat failed.", ...(retry ? { retry } : {}) },
    ];

    const next = applyRetryMessage(list, 3);
    expect(next.task).toBeUndefined();
    expect(next.messages).toEqual([earlier, question]);
  });
});

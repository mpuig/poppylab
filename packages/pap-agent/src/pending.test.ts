import { describe, expect, it } from "vitest";
import { pendingItems, proposalText } from "./pending";
import { openAsk, pendingOf } from "./pending-runs";
import { connected } from "./company-fixture";
import type { ReviewOperation } from "./operation-presentation";
import type { Run } from "./runtime";

const now = Date.parse("2026-11-27T12:00:00Z");
const food = { origin: "https://food.example", name: "Lantern Noodle Bar" };
const bank = { origin: "https://bank.example", name: "Harborline Bank" };
const op = (
  id: string,
  more: Partial<ReviewOperation> = {},
): ReviewOperation => ({
  operation_id: id,
  revision: `${id}-r1`,
  state: "proposed",
  expires_at: new Date(now + 600000).toISOString(),
  summary: "Reply YES to approve.",
  terms: { order_id: "ord_1", new_total_cents: 8800, currency: "USD" },
  ...more,
});

describe("what waits for the User", () => {
  it("lists each waiting proposal in the agent's words, with its Company and expiry", () => {
    const items = pendingItems(
      "c1",
      [
        {
          company: food,
          operations: [
            op("op_1"),
            op("op_2", { state: "succeeded" }),
            op("op_3", { expires_at: new Date(now - 1).toISOString() }),
          ],
        },
      ],
      undefined,
      now,
    );
    expect(items).toEqual([
      {
        conversation: "c1",
        kind: "proposal",
        company: food,
        text: "Approve or decline the $88.00 change",
        expiresAt: new Date(now + 600000).toISOString(),
        proposal: { id: "op_1", revision: "op_1-r1" },
      },
    ]);
    // Never the Company's words.
    expect(JSON.stringify(items)).not.toContain("Reply YES");
  });

  it("keeps an approval with an unknown outcome, with no expiry", () => {
    expect(proposalText(op("op_1", { state: "uncertain" }))).toBe(
      "Check the $88.00 change you approved: its outcome is unknown",
    );
    const [item] = pendingItems(
      "c1",
      [{ company: food, operations: [op("op_1", { state: "uncertain" })] }],
      undefined,
      now,
    );
    expect(item?.expiresAt).toBeUndefined();
  });

  it("lists a sign-in under way once, not again as the question about it", () => {
    const items = pendingItems(
      "c1",
      [
        { company: food, operations: [], signingIn: now + 60000 },
        { company: bank, operations: [], accessLost: true },
      ],
      { signin: { company: food.origin, access: "read" } },
      now,
    );
    expect(items.map((i) => [i.kind, i.company?.name, i.text])).toEqual([
      [
        "signin",
        "Lantern Noodle Bar",
        "Finish signing in on the company’s own page",
      ],
      [
        "signin",
        "Harborline Bank",
        "Sign in again: the company no longer takes your sign-in",
      ],
    ]);
  });

  it("lists the agent's open question, until it runs out", () => {
    const company = [{ company: food, operations: [] }];
    expect(
      pendingItems(
        "c1",
        company,
        { signin: { company: food.origin, access: "write" } },
        now,
      )[0]?.text,
    ).toBe("Give change permission, if you want the change");
    expect(
      pendingItems(
        "c1",
        company,
        { resume: food.origin, until: now + 1000 },
        now,
      )[0],
    ).toMatchObject({ kind: "question", company: food });
    expect(
      pendingItems("c1", company, { resume: food.origin, until: now }, now),
    ).toEqual([]);
    expect(
      pendingItems("c1", company, { invitation: food.origin }, now)[0]?.text,
    ).toBe("Answer the invitation to talk with it directly");
    expect(pendingItems("c1", [], { which: true }, now)[0]).toEqual({
      conversation: "c1",
      kind: "question",
      text: "Say which company your request is for",
    });
  });

  it("reads a stored conversation, and nothing of one that ended", () => {
    const connection = {
      ...connected(food.origin, food.name, "poppy:read"),
      operations: { op_1: { ...op("op_1"), state: "proposed" as const } },
      auth: {
        state: "secret-state",
        verifier: "secret-verifier",
        expires: now + 60000,
        issuer: food.origin,
        scopes: "poppy:read",
      },
    };
    const run: Run = {
      expires: now + 60000,
      busy: false,
      calls: 0,
      connections: [connection],
      history: [],
      asking: { signin: { company: food.origin, access: "read" } },
    };
    const items = pendingOf("c1", run, now);
    expect(items.map((i) => i.kind)).toEqual(["proposal", "signin"]);
    expect(JSON.stringify(items)).not.toMatch(/secret/);
    expect(pendingOf("c1", { ...run, archived: true }, now)).toEqual([]);
    expect(pendingOf("c1", { ...run, expires: now }, now)).toEqual([]);
    expect(openAsk({ ...run, asking: { resume: food.origin } }, now)).toBe(
      undefined,
    );
  });
});

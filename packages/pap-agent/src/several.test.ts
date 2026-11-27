import { describe, expect, it } from "vitest";
import type { ApiTool } from "@poppy-lab/pap-client";
import { connected } from "./company-fixture";
import {
  modelTools,
  newParts,
  recording,
  SEVERAL_LIMITS,
  severalSteps,
  toolKeys,
  type Call,
} from "./several";

const tool = (description = "Reads something."): ApiTool => ({
  description,
  schema: { type: "object" },
  execute: async () => ({ ok: true }),
});
const parts = (...companies: Array<[string, string, string?]>) =>
  newParts(
    companies.map(([origin, name, lab]) => ({
      connection: connected(origin, name),
      ref: { origin, name },
      lab,
    })),
  );

describe("the tools of a turn with several Companies", () => {
  it("names each Company's tools with a key of its own", () => {
    expect(
      toolKeys([
        { name: "Fernwick Power & Light", lab: "fernwick" },
        { name: "Kestrel Bank & Trust Company of the North" },
        { name: "Kestrel Bank & Trust Company of the North" },
        { name: "€€€" },
      ]),
    ).toEqual(["fernwick", "kestrel_bank_tru", "kestrel_bank_tru2", "company"]);
  });

  it("keeps names within the providers' limit and says whose each tool is", () => {
    const [power, bank] = parts(
      ["https://power.example", "Ashby Power"],
      ["https://bank.example", "Kestrel Bank"],
    );
    const long = "x".repeat(80);
    const { tools } = modelTools(
      [power!, bank!],
      [
        { bills: tool(), [long]: tool(), [`${long}y`]: tool() },
        { "pay.bill": tool("Pays.") },
      ],
    );
    const names = Object.keys(tools);
    expect(names).toHaveLength(4);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(new Set(names).size).toBe(4);
    expect(tools["kestrel_bank__pay_bill"]!.description).toBe(
      "At Kestrel Bank (bank.example): Pays.",
    );
  });

  it("offers at most its share of the tools of each Company, and says how many it left out", () => {
    const many = (n: number) =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`t${i}`, tool()]),
      );
    const all = parts(
      ["https://a.example", "A"],
      ["https://b.example", "B"],
      ["https://c.example", "C"],
    );
    const { tools, left } = modelTools(all, [many(40), many(10), many(32)]);
    expect(Object.keys(tools)).toHaveLength(32 + 10 + 32);
    expect(Object.keys(tools).length).toBeLessThanOrEqual(SEVERAL_LIMITS.tools);
    expect(left.map((l) => [l.part.ref.name, l.count])).toEqual([["A", 8]]);
  });
});

describe("what a turn with several Companies keeps of each call", () => {
  it("puts the arguments of a call with the step it made, at its Company", async () => {
    const [power, bank] = parts(
      ["https://power.example", "Ashby Power"],
      ["https://bank.example", "Kestrel Bank"],
    );
    power!.tools = {
      bills: {
        ...tool(),
        execute: async () => {
          power!.trace.push("GET /api/bills · Poppy Session");
          return { amount_cents: 1200 };
        },
      },
    };
    bank!.tools = {
      pay: {
        ...tool(),
        execute: async () => {
          bank!.trace.push("POST /api/pay · Poppy Session");
          return { status: "approval_required" };
        },
      },
    };
    const calls: Call[] = [];
    const failed: unknown[] = [];
    const fail = (_: unknown, error: unknown) => failed.push(error);
    await recording(power!, calls, fail).bills!.execute();
    await recording(bank!, calls, fail).pay!.execute({
      amount_cents: 1200,
      reference: "R-1",
    });
    expect(calls).toEqual([
      { company: power!.ref, tool: "bills", output: { amount_cents: 1200 } },
      {
        company: bank!.ref,
        tool: "pay",
        output: { status: "approval_required" },
      },
    ]);
    expect(
      severalSteps([power!, bank!]).map((s) => [s.company, s.text, s.args]),
    ).toEqual([
      ["https://power.example", "Read /api/bills", undefined],
      [
        "https://bank.example",
        "Sent a request to /api/pay",
        '{"amount_cents":1200,"reference":"R-1"}',
      ],
    ]);
    // A call that fails names the Company it failed at.
    bank!.tools.pay!.execute = async () => {
      throw new Error("refused");
    };
    await expect(
      recording(bank!, calls, fail).pay!.execute({ amount_cents: 1 }),
    ).rejects.toThrow("refused");
    expect(failed).toHaveLength(1);
  });
});

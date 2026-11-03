import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
import { openApiTools } from "./openapi.ts";
it.each(["food", "flowers", "stays"])(
  "compiles the published %s Sandbox contract without bespoke tools",
  async (company) => {
    const spec = JSON.parse(
      readFileSync(
        join(__dirname, "fixtures", company + "-openapi.json"),
        "utf8",
      ),
    );
    const request = vi
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ ok: true });
    const opts = {
      allowProposals: true,
      allowOperationResponses: true,
      blockedPaths: ["/poppy/operations"],
      request,
      trace: vi.fn(),
    };
    const tools = openApiTools(
      spec,
      `https://${company}.papsandbox.com/poppy/openapi.json`,
      opts,
    );
    expect(Object.keys(tools)).toHaveLength(4);
    if (company === "stays") {
      await tools.availability!.execute({
        check_in: "2026-11-01",
        check_out: "2026-11-03",
      });
      await expect(
        tools.availability!.execute({
          check_in: "2026-02-30",
          check_out: "2026-11-03",
        }),
      ).rejects.toThrow();
      await tools.change_booking!.execute({
        booking_id: "b_1",
        rate_plan: "rp_flex_bb",
        check_in: "2026-11-01",
      });
      expect(request).toHaveBeenLastCalledWith(
        "https://stays.papsandbox.com/poppy/bookings/b_1/changes",
        "POST",
        { rate_plan: "rp_flex_bb", check_in: "2026-11-01" },
        ["poppy:write"],
      );
    } else {
      await tools.change_order!.execute({
        order_id: "o_1",
        add: [{ product_id: "p_1", quantity: 2 }],
        ...(company === "flowers" ? { card_message: "Hola" } : { slot: "sat" }),
      });
      expect(request.mock.calls[0]![3]).toEqual(["poppy:write"]);
      for (const add of [
        [{ product_id: "p_1", quantity: 11 }],
        [{ quantity: 1 }],
        [{ product_id: "p_1", approved_by: "user" }],
        Array.from({ length: 21 }, () => ({ product_id: "p_1" })),
      ])
        await expect(
          tools.change_order!.execute({ order_id: "o_1", add }),
        ).rejects.toThrow();
    }
    const reads = openApiTools(
      spec,
      `https://${company}.papsandbox.com/poppy/openapi.json`,
      { ...opts, allowProposals: false },
    );
    expect(Object.keys(reads)).toHaveLength(3);
    expect(Object.keys(tools).some((n) => /confirm|cancel/.test(n))).toBe(
      false,
    );
  },
);

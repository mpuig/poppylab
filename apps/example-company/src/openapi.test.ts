import { it, expect, vi } from "vitest";
import { openApiTools } from "@poppy-lab/pap-client";
import { accountPaths } from "./openapi.js";
it("generates all account tools from the published contract, including order IDs", async () => {
  const request = vi.fn(async () => ({ ok: true }));
  const tools = openApiTools(
    { paths: accountPaths },
    "http://juniper.localhost:4100/openapi.json",
    {
      allowProposals: true,
      blockedPaths: ["/api/account/operations"],
      trace: vi.fn(),
      request,
    },
  );
  expect(Object.keys(tools).sort()).toEqual(
    [
      "my_basket",
      "my_orders",
      "order_details",
      "my_deliveries",
      "propose_basket_quantity",
      "propose_delivery_item_quantity",
      "propose_delivery_change",
      "propose_checkout",
    ].sort(),
  );
  await tools.order_details!.execute({ order_id: "ord_123" });
  expect(request).toHaveBeenLastCalledWith(
    "http://juniper.localhost:4100/api/account/orders/ord_123",
    "GET",
    undefined,
    ["poppy:read"],
  );
  await tools.propose_basket_quantity!.execute({
    product_id: "apples",
    quantity: 2,
  });
  expect(request).toHaveBeenLastCalledWith(
    "http://juniper.localhost:4100/api/account/basket-change",
    "POST",
    { product_id: "apples", quantity: 2 },
    ["poppy:read", "poppy:write"],
  );
  expect(
    Object.keys(tools).some((n) => /confirm|cancel|revoke|token/.test(n)),
  ).toBe(false);
});

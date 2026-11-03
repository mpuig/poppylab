import { catalogue } from "./operations.js";
const read = (
  operationId: string,
  summary: string,
  parameters?: unknown[],
) => ({
  get: {
    operationId,
    summary,
    "x-poppy-scopes": ["poppy:read"],
    responses: { "200": { description: "Account data" } },
    ...(parameters ? { parameters } : {}),
  },
});
const day = { type: "string", enum: ["Tuesday", "Thursday", "Saturday"] };
const quantities = {
  product_id: { type: "string", enum: catalogue.map((p) => p.id) },
  quantity: { type: "integer", minimum: 0, maximum: 32 },
};
const proposal = (
  operationId: string,
  summary: string,
  properties: Record<string, unknown>,
) => ({
  post: {
    operationId,
    summary,
    "x-poppy-scopes": ["poppy:read", "poppy:write"],
    "x-poppy-proposal": true,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties,
            required: Object.keys(properties),
            additionalProperties: false,
          },
        },
      },
    },
    responses: {
      "200": {
        description:
          "Performed. Only after a retry carrying the user's approval in Poppy-Approval (Operations v2).",
      },
      "403": {
        description:
          "approval_required: nothing was performed. The body holds the operation (terms, revision, expiry) for the user to approve.",
      },
    },
  },
});
export const accountPaths = {
  "/api/account/basket": read(
    "my_basket",
    "Read current basket quantities, prices and totals. Separate from recurring delivery.",
  ),
  "/api/account/orders": read(
    "my_orders",
    "Read fictional orders, their items, totals and status.",
  ),
  "/api/account/orders/{order_id}": read(
    "order_details",
    "Read one fictional order by its ID.",
    [
      {
        name: "order_id",
        in: "path",
        required: true,
        schema: { type: "string", maxLength: 100 },
      },
    ],
  ),
  "/api/account/deliveries": read(
    "my_deliveries",
    "Read recurring delivery items, quantities, day and weekly total. Separate from basket.",
  ),
  "/api/account/basket-change": proposal(
    "propose_basket_quantity",
    "Propose setting absolute basket quantity; 0 removes it. Read basket first when adding. Does not alter recurring delivery or past orders.",
    quantities,
  ),
  "/api/account/delivery-items-change": proposal(
    "propose_delivery_item_quantity",
    "Propose setting absolute recurring weekly delivery quantity; 0 removes it. Read my_deliveries first. Does not alter basket or past orders.",
    quantities,
  ),
  "/api/account/delivery-change": proposal(
    "propose_delivery_change",
    "Propose a new recurring delivery day.",
    { day },
  ),
  "/api/account/checkout": proposal(
    "propose_checkout",
    "Propose fictional checkout of the current basket; full totals and delivery terms require approval. Calling it again with another day revises the same pending checkout (same operation_id, new revision). No real payment or shipment.",
    { day },
  ),
};

/**
 * An agent's browser at Lantern (§6): the suite every Company on the
 * gateway runs, with Lantern's account page. The join's three steps are
 * tested where they are built, in the gateway.
 */
import { browserJoinSuite } from "@poppy-lab/pap-company/testing";
import { lantern } from "./lantern.ts";

browserJoinSuite({
  company: lantern,
  name: "Lantern",
  account: "elena",
  accountHeader: "x-lantern-account",
  scopes: "orders:read orders:write",
  parts: [
    {
      name: "Scheduled orders and the last delivery",
      scope: "orders:read",
      ids: ["order-list", "delivered-order"],
      state: { orders: [], delivered: null },
    },
  ],
  own: ["logout", "access-list", "activity-list", "agent-feedback"],
  ownState: ["agents", "activity"],
  writes: [
    ["POST", "/site/login"],
    ["POST", "/site/logout"],
    ["POST", "/site/orders/x"],
    ["POST", "/site/access/x/revoke"],
  ],
});

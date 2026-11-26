/**
 * An agent's browser at Juniper (§6): the suite every Company on the
 * gateway runs, with Juniper's account page. Juniper has one read scope,
 * so a joined browser sees the whole account or none of it, and its page
 * has the most to leave out: every editor and form.
 */
import { browserJoinSuite } from "@poppy-lab/pap-company/testing";
import { juniperCompany } from "./juniper.js";

browserJoinSuite({
  company: juniperCompany({ portal: true }),
  name: "Juniper",
  account: "elena",
  accountHeader: "x-juniper-account",
  scopes: "poppy:read poppy:write",
  parts: [
    {
      name: "Shopping, deliveries, orders, billing, support cases and profile",
      scope: "poppy:read",
      ids: [
        "basket-items",
        "delivery-items",
        "order-list",
        "invoice-list",
        "case-list",
        "profile-data",
      ],
      state: {
        basket: undefined,
        delivery: undefined,
        orders: undefined,
        profile: undefined,
      },
    },
  ],
  own: [
    "logout",
    "edit-basket",
    "basket-form",
    "edit-delivery",
    "delivery-form",
    "case-form",
    "reply-form",
    "edit-profile",
    "profile-form",
    "access-list",
    "activity-list",
    "agent-feedback",
  ],
  ownState: ["agents", "activity"],
  writes: [
    ["POST", "/site/login"],
    ["POST", "/site/logout"],
    ["POST", "/site/cases"],
    ["POST", "/site/cases/x/messages"],
    ["POST", "/site/basket"],
    ["POST", "/site/delivery"],
    ["POST", "/site/profile"],
    ["POST", "/site/access/x/revoke"],
  ],
});

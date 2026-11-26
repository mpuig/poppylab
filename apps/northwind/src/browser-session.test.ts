/**
 * An agent's browser at Northwind (§6): the suite every Company on the
 * gateway runs, with Northwind's account page. The join's three steps are
 * tested where they are built, in the gateway.
 */
import { browserJoinSuite } from "@poppy-lab/pap-company/testing";
import { northwind } from "./northwind.ts";

browserJoinSuite({
  company: northwind,
  name: "Northwind",
  account: "elena",
  accountHeader: "x-northwind-account",
  scopes:
    "flights:search bookings:read profile:read preferences:write bookings:change",
  parts: [
    {
      name: "Upcoming trips",
      scope: "bookings:read",
      ids: ["trip-list"],
      state: { bookings: [] },
    },
    {
      name: "Gale loyalty and passenger preferences",
      scope: "profile:read",
      ids: ["loyalty", "preferences"],
      state: { loyalty: null, preference: null },
    },
  ],
  own: ["logout", "access-list", "activity-list", "agent-feedback"],
  ownState: ["agents", "activity"],
  writes: [
    ["POST", "/site/login"],
    ["POST", "/site/logout"],
    ["POST", "/site/access/x/revoke"],
  ],
});

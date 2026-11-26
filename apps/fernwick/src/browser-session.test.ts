/**
 * An agent's browser at Fernwick (§6): the suite every Company on the
 * gateway runs, with Fernwick's portal, and what is Fernwick's own: a
 * joined browser sees the meters its grant shares, and of each one what
 * its scopes read, the plan and bills or the use of energy.
 */
import { expect, it } from "vitest";
import {
  browser,
  browserJoinSuite,
  BROWSER_SCOPE,
  join,
  setup,
} from "@poppy-lab/pap-company/testing";
import { fernwick } from "./fernwick.ts";

const both = { "espi_meter_UP-E1": "yes", "espi_meter_UP-E2": "yes" };

browserJoinSuite({
  company: fernwick,
  name: "Fernwick",
  account: "elena",
  accountHeader: "x-fernwick-account",
  scopes: "account:read plan:write espi:usage espi:summary espi:customer",
  consent: { allow_plan_write: "yes", ...both },
  parts: [
    {
      name: "Rate plans and bills",
      scope: "account:read",
      ids: ["bills"],
      state: {},
    },
    {
      name: "This month's use and the last seven days",
      scope: "espi:usage",
      ids: ["days"],
      state: {},
    },
  ],
  own: ["logout", "access", "activity", "agent-feedback"],
  ownState: ["agents", "activity"],
  writes: [
    ["POST", "/site/login"],
    ["POST", "/site/logout"],
    ["POST", "/site/access/x/revoke"],
  ],
});

it("shows an agent's browser the meters its grant shares, and of each what its scopes read", async () => {
  const x = await setup({ isolation: "visitor" }, fernwick);
  type Meter = Record<string, unknown> & { id: string };
  const state = async (scopes: string, consent: Record<string, string>) => {
    const tokens = await x.signIn(`${scopes} ${BROWSER_SCOPE}`, {
      account: "elena",
      allow_browser: "yes",
      ...consent,
    });
    if ("refused" in tokens) throw new Error("refused");
    const b = browser(x);
    await join(x, b, { access: tokens.access_token });
    return (await (await b.get("/site/state")).json()) as {
      customer: Record<string, string>;
      meters: Meter[];
    };
  };
  // Both scopes, one meter shared: that meter, whole.
  const whole = await state("account:read espi:usage", {
    "espi_meter_UP-E2": "yes",
  });
  expect(whole.meters.map((meter) => meter.id)).toEqual(["UP-E2"]);
  expect(Object.keys(whole.meters[0]!).sort()).toEqual([
    "bills",
    "days",
    "id",
    "label",
    "month_energy_cents",
    "month_kwh",
    "plan",
  ]);
  // No scope reads the email, in either API.
  expect(whole.customer).toMatchObject({ name: "Elena Maren", email: "" });
  expect(whole.customer.address).not.toBe("");
  // The plan and bills without the use, and the use without them.
  const plans = await state("account:read", both);
  expect(plans.meters.map((meter) => Object.keys(meter).sort())).toEqual([
    ["bills", "id", "label", "plan"],
    ["bills", "id", "label", "plan"],
  ]);
  const use = await state("espi:usage", both);
  for (const meter of use.meters) {
    expect(meter).not.toHaveProperty("plan");
    expect(meter).not.toHaveProperty("bills");
    expect(meter.days).toHaveLength(7);
  }
  expect(use.customer).toMatchObject({ account_number: "", address: "" });
  // Neither: no meter at all, only who the account is.
  const neither = await state("espi:customer", {});
  expect(neither.meters).toEqual([]);
  expect(neither.customer.address).not.toBe("");
});

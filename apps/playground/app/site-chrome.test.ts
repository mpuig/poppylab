import { expect, it } from "vitest";
import { demoExamplesFor } from "@poppy-lab/pap-agent/demo-examples";
import { companies } from "./site-chrome";

it("asks, on each home card, for something the keyless demo runs at that Company", () => {
  for (const company of companies)
    expect(
      demoExamplesFor(company.ask).map((e) => e.company),
      company.ask,
    ).toContain(company.id);
});

it("names the home's request across two Companies as the demo runs it", () => {
  expect(demoExamplesFor("Pay my Fernwick bill from checking.")).toEqual([
    {
      company: "harborline",
      with: "fernwick",
      text: "Pay my Fernwick bill from checking.",
    },
  ]);
});

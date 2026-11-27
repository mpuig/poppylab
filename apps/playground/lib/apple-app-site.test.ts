import { expect, it } from "vitest";
import { appleAppIds, appleAppSiteAssociation } from "./apple-app-site";

it("lists the configured apps for passkeys", () => {
  expect(appleAppSiteAssociation("B763SLJC72.dev.poppylab.app")).toEqual({
    webcredentials: { apps: ["B763SLJC72.dev.poppylab.app"] },
  });
  expect(appleAppIds("A1B2C3D4E5.a.b, B763SLJC72.dev.poppylab.app")).toEqual([
    "A1B2C3D4E5.a.b",
    "B763SLJC72.dev.poppylab.app",
  ]);
});

it("serves nothing without an app, and refuses an ID that isn't one", () => {
  expect(appleAppSiteAssociation("")).toBeUndefined();
  expect(() => appleAppIds("dev.poppylab.app")).toThrow(/TEAMID/);
});

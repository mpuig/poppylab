import { expect, it } from "vitest";
import {
  rememberSignInCompany,
  signedInText,
  takeSignInCompany,
} from "./company";

/** A tab's storage, as far as these two functions use it. */
function storage(blocked = false) {
  const values = new Map<string, string>();
  const refuse = () => {
    throw new Error("SecurityError");
  };
  return {
    values,
    getItem: (key: string) => (blocked ? refuse() : (values.get(key) ?? null)),
    setItem: (key: string, value: string) =>
      void (blocked ? refuse() : values.set(key, value)),
    removeItem: (key: string) => void (blocked ? refuse() : values.delete(key)),
  };
}

it("names the Company the sign-in was started at, where the rest of the flow does", () => {
  expect(signedInText("Juniper Market")).toBe(
    "Signed in to Juniper Market. Close this tab and return to Poppy Lab.",
  );
  // Not known in this browser: the sentence the page always had.
  expect(signedInText(undefined)).toBe(
    "Signed in to the Company account. Close this tab and return to Poppy Lab.",
  );
});

it("hands the name from the playground tab to the tab the sign-in lands in, once", () => {
  const tab = storage();
  rememberSignInCompany("Juniper Market", () => tab);
  // Nothing but the name is kept.
  expect([...tab.values.values()]).toEqual(["Juniper Market"]);
  expect(takeSignInCompany(() => tab)).toBe("Juniper Market");
  // A tab opened on that address later doesn't repeat it.
  expect(takeSignInCompany(() => tab)).toBeUndefined();
  expect(tab.values.size).toBe(0);

  // Another sign-in in the same tab replaces the name, and one without a
  // name removes it.
  rememberSignInCompany("Juniper Market", () => tab);
  rememberSignInCompany("Lantern Noodle Bar", () => tab);
  expect(takeSignInCompany(() => tab)).toBe("Lantern Noodle Bar");
  rememberSignInCompany("Juniper Market", () => tab);
  rememberSignInCompany(undefined, () => tab);
  expect(takeSignInCompany(() => tab)).toBeUndefined();
});

it("names its own Company in each tab when two sign-ins are under way at once", () => {
  // Each sign-in has its own tab, and its name goes into that tab.
  const lantern = storage();
  const harborline = storage();
  rememberSignInCompany("Lantern Noodle Bar", () => lantern);
  rememberSignInCompany("Harborline Bank", () => harborline);
  // The one started first lands first, and still names its own Company.
  expect(signedInText(takeSignInCompany(() => lantern))).toBe(
    "Signed in to Lantern Noodle Bar. Close this tab and return to Poppy Lab.",
  );
  expect(signedInText(takeSignInCompany(() => harborline))).toBe(
    "Signed in to Harborline Bank. Close this tab and return to Poppy Lab.",
  );
});

it("keeps a short display name and nothing else", () => {
  const tab = storage();
  for (const name of [
    "",
    "   ",
    "x".repeat(81),
    "Juniper\nMarket",
    "a\u0000b",
  ]) {
    rememberSignInCompany(name, () => tab);
    expect(takeSignInCompany(() => tab)).toBeUndefined();
  }
  // Whatever else is found under the key is held to the same rule.
  rememberSignInCompany("Juniper Market", () => tab);
  const [key] = [...tab.values.keys()];
  tab.values.set(key!, "y".repeat(500));
  expect(takeSignInCompany(() => tab)).toBeUndefined();
  // Markup is only ever text: the page renders the sentence as a string.
  rememberSignInCompany("<b>Juniper</b>", () => tab);
  expect(signedInText(takeSignInCompany(() => tab))).toBe(
    "Signed in to <b>Juniper</b>. Close this tab and return to Poppy Lab.",
  );
});

it("names no Company when the browser blocks storage", () => {
  const tab = storage(true);
  expect(() =>
    rememberSignInCompany("Juniper Market", () => tab),
  ).not.toThrow();
  expect(takeSignInCompany(() => tab)).toBeUndefined();
  // Nor when the tab's storage can't be reached at all.
  const unreachable = () => {
    throw new Error("SecurityError");
  };
  expect(() =>
    rememberSignInCompany("Juniper Market", unreachable),
  ).not.toThrow();
  expect(takeSignInCompany(unreachable)).toBeUndefined();
});

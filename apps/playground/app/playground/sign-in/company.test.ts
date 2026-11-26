import { expect, it } from "vitest";
import {
  rememberSignInCompany,
  signedInText,
  takeSignInCompany,
} from "./company";

/** A browser's storage, as far as these two functions use it. */
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
  const store = storage();
  rememberSignInCompany("Juniper Market", store);
  // Nothing but the name is kept.
  expect([...store.values.values()]).toEqual(["Juniper Market"]);
  expect(takeSignInCompany(store)).toBe("Juniper Market");
  // A tab opened on that address later doesn't repeat it.
  expect(takeSignInCompany(store)).toBeUndefined();
  expect(store.values.size).toBe(0);

  // A later sign-in replaces the name, and one without a name removes it.
  rememberSignInCompany("Juniper Market", store);
  rememberSignInCompany("Lantern Noodle Bar", store);
  expect(takeSignInCompany(store)).toBe("Lantern Noodle Bar");
  rememberSignInCompany("Juniper Market", store);
  rememberSignInCompany(undefined, store);
  expect(takeSignInCompany(store)).toBeUndefined();
});

it("keeps a short display name and nothing else", () => {
  const store = storage();
  for (const name of [
    "",
    "   ",
    "x".repeat(81),
    "Juniper\nMarket",
    "a\u0000b",
  ]) {
    rememberSignInCompany(name, store);
    expect(takeSignInCompany(store)).toBeUndefined();
  }
  // Whatever else is found under the key is held to the same rule.
  rememberSignInCompany("Juniper Market", store);
  const [key] = [...store.values.keys()];
  store.values.set(key!, "y".repeat(500));
  expect(takeSignInCompany(store)).toBeUndefined();
  // Markup is only ever text: the page renders the sentence as a string.
  rememberSignInCompany("<b>Juniper</b>", store);
  expect(signedInText(takeSignInCompany(store))).toBe(
    "Signed in to <b>Juniper</b>. Close this tab and return to Poppy Lab.",
  );
});

it("names no Company when the browser blocks storage", () => {
  const store = storage(true);
  expect(() => rememberSignInCompany("Juniper Market", store)).not.toThrow();
  expect(takeSignInCompany(store)).toBeUndefined();
});

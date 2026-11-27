/**
 * The name of the Company a sign-in was started at, handed from the
 * playground tab to the tab the sign-in lands in. That tab's address
 * carries nothing (see `[result]/page.tsx`), so the page can't tell which
 * Company it was; the playground, which opened the sign-in, can. It leaves
 * the name in the storage of the sign-in's own tab, which keeps it while
 * the tab goes to the Company and back. Two sign-ins under way at once are
 * two tabs, so each page names its own Company.
 *
 * Only a display name, as the playground already shows it on the sign-in
 * button: never a token, a code or an account. The page shows it as text.
 */
const KEY = "poppy.signin.company.v1";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A short name on one line, or nothing. */
const displayName = (value: unknown) => {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= 80 && !/\p{Cc}/u.test(name) ? name : undefined;
};

/**
 * Called when a sign-in starts, with the storage of the tab it opens in
 * (`sessionStorage` of the blank tab, which is still this site's). Another
 * sign-in in the same tab replaces the name.
 */
export function rememberSignInCompany(
  name: string | undefined,
  tab: () => Store,
) {
  try {
    const kept = displayName(name);
    if (kept) tab().setItem(KEY, kept);
    else tab().removeItem(KEY);
  } catch {
    // Storage can be blocked; the page then names no Company.
  }
}

/** Read once: the address opened again later names no Company. */
export function takeSignInCompany(
  tab: () => Store = () => window.sessionStorage,
) {
  try {
    const store = tab();
    const name = displayName(store.getItem(KEY));
    store.removeItem(KEY);
    return name;
  } catch {
    return undefined;
  }
}

/** What the page says after a sign-in, with the Company's name if known. */
export const signedInText = (company: string | undefined) =>
  `Signed in to ${company ?? "the Company account"}. Close this tab and return to Poppy Lab.`;

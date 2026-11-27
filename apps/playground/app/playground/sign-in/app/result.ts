import { labSites } from "@poppy-lab/pap-core";

/**
 * What the page an app's sign-in ends on says. The callback sends the
 * app's browser to `/playground/sign-in/app` with `result` (`done` or
 * `failed`) and, for one of the lab's Companies, `company`, the lab's key
 * for it. Only those words are read, and the name shown is the lab's own:
 * no text from the address reaches the page.
 */
export function appSignInResult(search: string) {
  const query = new URLSearchParams(search);
  const result = query.get("result");
  if (result === "failed")
    return {
      title: "Sign-in not completed.",
      text: "Sign-in failed or was declined. Go back to the app and try again.",
    };
  if (result !== "done")
    return {
      title: "Sign-in",
      text: "Go back to the app to see how the sign-in went.",
    };
  const key = query.get("company");
  const company = labSites("https://poppylab.dev").find(
    (site) => "words" in site && site.id === key,
  )?.label;
  return {
    title: "Signed in.",
    text: `Signed in to ${company ?? "the Company account"}. You can go back to the app.`,
  };
}

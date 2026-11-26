import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import SignInResult, { generateStaticParams } from "./page";

const html = async (result: string) =>
  renderToStaticMarkup(
    await SignInResult({ params: Promise.resolve({ result }) }),
  );

it("says how the sign-in went in fixed words, with a control to close the tab", async () => {
  // As the server sends it. The browser then puts the Company's name in
  // this sentence, when it knows it (`../company`): never the address.
  const done = await html("done");
  expect(done).toContain(
    "Signed in to the Company account. Close this tab and return to Poppy Lab.",
  );
  expect(done).toContain("Close this tab</button>");
  expect(await html("failed")).toContain(
    "Sign-in failed or was declined. Close this tab and retry Sign in in the playground.",
  );
});

it("exists for the two outcomes the callback sends and nothing else", async () => {
  expect(generateStaticParams()).toEqual([
    { result: "done" },
    { result: "failed" },
  ]);
  // Never a word from the address: an unknown one is not found.
  for (const result of ["constructor", "Words of the Company's own."])
    await expect(html(result)).rejects.toThrow();
});

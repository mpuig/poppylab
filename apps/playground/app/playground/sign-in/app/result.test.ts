import { expect, it } from "vitest";
import { appSignInResult } from "./result";

it("says how an app's sign-in went, naming one of the lab's Companies by its key", () => {
  expect(appSignInResult("?result=done&company=harborline")).toEqual({
    title: "Signed in.",
    text: "Signed in to Harborline Bank. You can go back to the app.",
  });
  expect(appSignInResult("?result=done").text).toBe(
    "Signed in to the Company account. You can go back to the app.",
  );
  expect(appSignInResult("?result=failed")).toEqual({
    title: "Sign-in not completed.",
    text: "Sign-in failed or was declined. Go back to the app and try again.",
  });
});

it("shows no words from the address", () => {
  for (const company of ["Call 555-0100 now", "home", "playground"])
    expect(
      appSignInResult(`?result=done&company=${encodeURIComponent(company)}`)
        .text,
    ).toBe("Signed in to the Company account. You can go back to the app.");
  expect(appSignInResult("?result=Signed+in+to+anything")).toEqual({
    title: "Sign-in",
    text: "Go back to the app to see how the sign-in went.",
  });
});

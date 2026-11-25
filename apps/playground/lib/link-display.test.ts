import { expect, it } from "vitest";
import { hideLinkSecrets } from "./link-display";

it("replaces a signed or tokened query with an ellipsis", () => {
  expect(
    hideLinkSecrets(
      "Pay at https://shop.example/pay/1?token=abc123&x=1 today.",
    ),
  ).toBe("Pay at https://shop.example/pay/1?… today.");
  expect(hideLinkSecrets("(https://a.example/f?X-Amz-Signature=zz)")).toBe(
    "(https://a.example/f?…)",
  );
});

it("leaves ordinary links and text alone", () => {
  const text = "See https://shop.example/menu?page=2 or https://x.example/a.";
  expect(hideLinkSecrets(text)).toBe(text);
});

it("judges the query and the fragment separately, and knows compound names", () => {
  expect(
    hideLinkSecrets("See https://a.example/cb#access_token=abc&x=1 now"),
  ).toBe("See https://a.example/cb#… now");
  expect(hideLinkSecrets("https://a.example/p?page=2#top")).toBe(
    "https://a.example/p?page=2#top",
  );
  expect(hideLinkSecrets("https://a.example/p?page=2#id_token=zz")).toBe(
    "https://a.example/p?page=2#…",
  );
  expect(hideLinkSecrets("https://a.example/p?token=1#section")).toBe(
    "https://a.example/p?…#section",
  );
  for (const name of [
    "client_secret",
    "refresh_token",
    "session-id",
    "X-Goog-Credential",
    "password",
    "Authorization",
  ])
    expect(hideLinkSecrets(`https://a.example/x?${name}=v`)).toBe(
      "https://a.example/x?…",
    );
  // A name that only contains the letters is not a secret.
  expect(hideLinkSecrets("https://a.example/x?category=1&design=2")).toBe(
    "https://a.example/x?category=1&design=2",
  );
});

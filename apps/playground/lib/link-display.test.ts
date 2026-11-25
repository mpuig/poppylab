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

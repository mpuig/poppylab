import { expect, it } from "vitest";
import nextConfig from "./next.config";

const headers = async () =>
  Object.fromEntries(
    (await nextConfig.headers!())
      .find((rule) => rule.source === "/(.*)")!
      .headers.map((h) => [h.key.toLowerCase(), h.value]),
  );

it("lets every page load code from, and send data to, itself only", async () => {
  const policy = (await headers())["content-security-policy"]!;
  const directives = Object.fromEntries(
    policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]),
  );
  expect(directives["default-src"]).toEqual(["'self'"]);
  expect(directives["connect-src"]).toEqual(["'self'"]);
  expect(directives["object-src"]).toEqual(["'none'"]);
  expect(directives["base-uri"]).toEqual(["'none'"]);
  expect(directives["frame-ancestors"]).toEqual(["'none'"]);
  expect(directives["form-action"]).toEqual(["'self'"]);
  // Outside development, no eval.
  expect(directives["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
});

it("keeps browsers on HTTPS", async () => {
  expect((await headers())["strict-transport-security"]).toBe(
    "max-age=31536000",
  );
});

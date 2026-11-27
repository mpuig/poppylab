import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "./next.config";
import { analyticsToken } from "./lib/analytics";

const headersOf = async (config = nextConfig) =>
  Object.fromEntries(
    (await config.headers!())
      .find((rule) => rule.source === "/(.*)")!
      .headers.map((h) => [h.key.toLowerCase(), h.value]),
  );
const headers = () => headersOf();
const directivesOf = (policy: string) =>
  Object.fromEntries(
    policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]),
  );

/** The config as a build with these environment variables would load it. */
async function configWith({
  analytics = "",
  turnstile = "",
}: { analytics?: string; turnstile?: string } = {}) {
  vi.resetModules();
  vi.stubEnv("CF_WEB_ANALYTICS_TOKEN", analytics);
  vi.stubEnv("TURNSTILE_SITE_KEY", turnstile);
  return (await import("./next.config")).default;
}
afterEach(() => {
  vi.unstubAllEnvs();
});

it("lets every page load code from, and send data to, itself only", async () => {
  const directives = directivesOf(
    (await headers())["content-security-policy"]!,
  );
  expect(directives["default-src"]).toEqual(["'self'"]);
  expect(directives["connect-src"]).toEqual(["'self'"]);
  expect(directives["object-src"]).toEqual(["'none'"]);
  expect(directives["base-uri"]).toEqual(["'none'"]);
  expect(directives["frame-ancestors"]).toEqual(["'none'"]);
  expect(directives["form-action"]).toEqual(["'self'"]);
  // Outside development, no eval, and no Turnstile without a site key.
  expect(directives["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  expect(directives["frame-src"]).toBeUndefined();
});

it("keeps browsers on HTTPS", async () => {
  expect((await headers())["strict-transport-security"]).toBe(
    "max-age=31536000",
  );
});

describe("Cloudflare Web Analytics", () => {
  const token = "0123456789abcdef0123456789abcdef";

  it("adds nothing to the policy without a token", async () => {
    const config = await configWith({ analytics: "" });
    const policy = (await headersOf(config))["content-security-policy"]!;
    expect(policy).not.toContain("cloudflareinsights");
    expect(config.env!.CF_WEB_ANALYTICS_TOKEN).toBe("");
  });

  it("allows only the beacon and its report address with a token", async () => {
    const config = await configWith({ analytics: token });
    const directives = directivesOf(
      (await headersOf(config))["content-security-policy"]!,
    );
    expect(directives["script-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://static.cloudflareinsights.com",
    ]);
    expect(directives["connect-src"]).toEqual([
      "'self'",
      "https://cloudflareinsights.com",
    ]);
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["img-src"]).toEqual(["'self'", "data:"]);
    // The pages get the same token as the policy.
    expect(config.env!.CF_WEB_ANALYTICS_TOKEN).toBe(token);
  });

  it("refuses a value that isn't a token, so nothing odd reaches a page", () => {
    expect(analyticsToken(undefined)).toBeUndefined();
    expect(analyticsToken("")).toBeUndefined();
    expect(analyticsToken(token)).toBe(token);
    expect(() => analyticsToken(`${token}"><script>`)).toThrow(
      /not a Web Analytics token/,
    );
  });
});

describe("Cloudflare Turnstile", () => {
  it("excludes challenges.cloudflare.com without a site key", async () => {
    const config = await configWith({ turnstile: "" });
    const policy = (await headersOf(config))["content-security-policy"]!;
    expect(policy).not.toContain("challenges.cloudflare.com");
    expect(directivesOf(policy)["frame-src"]).toBeUndefined();
  });

  it("allows Turnstile's script and frame when TURNSTILE_SITE_KEY is set", async () => {
    const config = await configWith({ turnstile: "0x4AAAAA-test-site-key" });
    const directives = directivesOf(
      (await headersOf(config))["content-security-policy"]!,
    );
    expect(directives["script-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://challenges.cloudflare.com",
    ]);
    expect(directives["frame-src"]).toEqual([
      "https://challenges.cloudflare.com",
    ]);
  });
});

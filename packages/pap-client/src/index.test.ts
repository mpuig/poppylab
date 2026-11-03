import { describe, expect, it, vi } from "vitest";
import {
  discoverCompany,
  isPrivateAddress,
  metadataUrlForIssuer,
} from "./index";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [
    {
      address: host === "internal.example" ? "127.0.0.1" : "93.184.216.34",
      family: 4,
    },
  ]),
}));

const company = {
  protocol_version: "0.3",
  organization: { name: "Test Company", domain: "company.example" },
  web: {},
};
const fetcher = (...responses: Response[]) =>
  vi.fn<typeof fetch>().mockImplementation(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });

describe("RFC 8414 metadata paths", () => {
  it.each([
    [
      "https://auth.example.com",
      "https://auth.example.com/.well-known/oauth-authorization-server",
    ],
    [
      "https://auth.example.com/shop-a",
      "https://auth.example.com/.well-known/oauth-authorization-server/shop-a",
    ],
    [
      "https://auth.example.com/shop-a/",
      "https://auth.example.com/.well-known/oauth-authorization-server/shop-a/",
    ],
  ])("preserves the issuer path: %s", (issuer, expected) =>
    expect(metadataUrlForIssuer(issuer).toString()).toBe(expected),
  );
});

describe("IP egress policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("blocks %s", (address) => expect(isPrivateAddress(address)).toBe(true));
  it("accepts public addresses", () =>
    expect(isPrivateAddress("8.8.8.8")).toBe(false));
});

describe("Company discovery", () => {
  it("discovers a website-only Company", async () => {
    const result = await discoverCompany("company.example", {
      fetchImpl: fetcher(
        Response.json(company),
        new Response(null, { status: 404 }),
      ),
    });
    expect(result.document.organization.name).toBe("Test Company");
    expect(result.profile.signIn).toEqual({ direct: false, device: false });
  });
  it("rejects unsupported drafts", async () => {
    await expect(
      discoverCompany("company.example", {
        fetchImpl: fetcher(
          Response.json({ ...company, protocol_version: "9.9" }),
        ),
      }),
    ).rejects.toThrow("Unsupported PAP version 9.9");
  });
  it("rejects a copied document", async () => {
    await expect(
      discoverCompany("other.example", {
        fetchImpl: fetcher(Response.json(company)),
      }),
    ).rejects.toThrow("does not match");
  });
  it("rejects input credentials before fetching", async () => {
    const mock = fetcher();
    await expect(
      discoverCompany("https://user:secret@company.example", {
        fetchImpl: mock,
      }),
    ).rejects.toThrow("credentials");
    expect(mock).not.toHaveBeenCalled();
  });
  it("blocks private redirect targets", async () => {
    const mock = fetcher(
      new Response(null, {
        status: 302,
        headers: { location: "https://internal.example/" },
      }),
    );
    await expect(
      discoverCompany("company.example", { fetchImpl: mock }),
    ).rejects.toThrow("destinations are blocked");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("does not turn a development exception into unrestricted private access", async () => {
    await expect(
      discoverCompany("http://internal.example", {
        allowedPrivateOrigins: ["http://juniper.localhost:4100"],
      }),
    ).rejects.toThrow("requires HTTPS");
  });
  it("bounds response bytes", async () => {
    await expect(
      discoverCompany("company.example", {
        fetchImpl: fetcher(new Response("x".repeat(512001))),
      }),
    ).rejects.toThrow("too large");
  });
  it("rejects HTTP redirect downgrades", async () => {
    await expect(
      discoverCompany("company.example", {
        fetchImpl: fetcher(
          new Response(null, {
            status: 302,
            headers: { location: "http://company.example/" },
          }),
        ),
      }),
    ).rejects.toThrow("HTTPS");
  });
  it("validates the issuer-domain link through protected_resources", async () => {
    const document = { ...company, auth: { issuer: "https://auth.example" } };
    const metadata = {
      issuer: "https://auth.example",
      token_endpoint: "https://auth.example/token",
      revocation_endpoint: "https://auth.example/revoke",
      grant_types_supported: ["refresh_token"],
      protected_resources: ["https://unrelated.example"],
    };
    await expect(
      discoverCompany("company.example", {
        fetchImpl: fetcher(
          Response.json(document),
          Response.json({
            resource: "https://company.example",
            authorization_servers: ["https://auth.example"],
          }),
          Response.json(metadata),
        ),
      }),
    ).rejects.toThrow("protected_resources");
  });
});

import { describe, expect, it } from "vitest";
import { espiUri, keepTokenFields, tokenResponse } from "./token-response";

const RE = "https://energy-demo.poppylab.dev/espi/1_1/resource";
const entry = { version: "1" as const, resource_endpoint: RE };
const SUB = `${RE}/Batch/Subscription/grant_7Hk2`;
const AUTH = `${RE}/Authorization/grant_7Hk2`;
const issued = (fields: Record<string, unknown>) =>
  tokenResponse(
    { access_token: "a", token_type: "DPoP", refresh_token: "r", ...fields },
    "espi:usage",
    true,
    false,
  );

describe("ESPI's resourceURI and authorizationURI from the token response", () => {
  it("keeps a URI that is exactly the subscription or authorization under the entry", () => {
    expect(espiUri(entry, SUB, "Batch/Subscription")).toBe(SUB);
    expect(espiUri(entry, AUTH, "Authorization")).toBe(AUTH);
    // base64url ids, as one in 32 grant IDs starts.
    expect(espiUri(entry, `${RE}/Authorization/-Hk2_a`, "Authorization")).toBe(
      `${RE}/Authorization/-Hk2_a`,
    );
    // An endpoint written with a trailing slash names the same paths.
    expect(
      espiUri({ ...entry, resource_endpoint: `${RE}/` }, AUTH, "Authorization"),
    ).toBe(AUTH);
  });

  it.each([
    [
      "another origin",
      "https://evil.example/espi/1_1/resource/Authorization/g",
    ],
    [
      "another port",
      `https://energy-demo.poppylab.dev:8443/espi/1_1/resource/Authorization/g`,
    ],
    ["plain HTTP", AUTH.replace("https:", "http:")],
    ["credentials", AUTH.replace("https://", "https://u:p@")],
    ["a query", `${AUTH}?x=1`],
    ["an empty query", `${AUTH}?`],
    ["a fragment", `${AUTH}#x`],
    ["the other kind", SUB],
    ["no id", `${RE}/Authorization/`],
    ["two segments", `${RE}/Authorization/g/x`],
    ["a dot segment", `${RE}/Authorization/..`],
    ["percent-encoding", `${RE}/Authorization/g%2Fx`],
    [
      "another endpoint",
      "https://energy-demo.poppylab.dev/espi/2_0/resource/Authorization/g",
    ],
    ["a case change", AUTH.replace("energy-demo", "ENERGY-DEMO")],
    ["no URL", "Authorization/g"],
    ["a trailing slash", `${AUTH}/`],
  ])("refuses %s", (_, value) => {
    expect(espiUri(entry, value, "Authorization")).toBeUndefined();
  });

  it("refuses any URI without an ESPI entry", () => {
    expect(espiUri(undefined, AUTH, "Authorization")).toBeUndefined();
    expect(espiUri(entry, undefined, "Authorization")).toBeUndefined();
  });

  it("reads them as short strings only", () => {
    expect(issued({ resourceURI: SUB, authorizationURI: AUTH })).toMatchObject({
      resourceUri: SUB,
      authorizationUri: AUTH,
    });
    expect(
      issued({
        resourceURI: 7,
        authorizationURI: `${AUTH}${"x".repeat(2048)}`,
      }),
    ).toMatchObject({ resourceUri: undefined, authorizationUri: undefined });
  });

  it("are replaced at sign-in, kept at a refresh that doesn't repeat them, and never kept unchecked", () => {
    const run: Parameters<typeof keepTokenFields>[0] = {
      company: { profile: { extensions: { "poppylab.dev/espi": entry } } },
    };
    keepTokenFields(
      run,
      issued({ resourceURI: SUB, authorizationURI: AUTH }),
      true,
    );
    expect(run).toMatchObject({
      espiResourceUri: SUB,
      espiAuthorizationUri: AUTH,
    });
    // A refresh without them, or with ones that don't fit: kept as they were.
    keepTokenFields(run, issued({}), false);
    keepTokenFields(
      run,
      issued({
        resourceURI: "https://evil.example/Batch/Subscription/x",
        authorizationURI: `${AUTH}?again`,
      }),
      false,
    );
    expect(run).toMatchObject({
      espiResourceUri: SUB,
      espiAuthorizationUri: AUTH,
    });
    // A refresh with new ones takes them.
    const next = AUTH.replace("grant_7Hk2", "grant_8");
    keepTokenFields(run, issued({ authorizationURI: next }), false);
    expect(run.espiAuthorizationUri).toBe(next);
    // A sign-in without them (or with ones that don't fit) drops them.
    keepTokenFields(run, issued({ resourceURI: `${SUB}/x` }), true);
    expect(run.espiResourceUri).toBeUndefined();
    expect(run.espiAuthorizationUri).toBeUndefined();
    // A Company without the entry: nothing is kept.
    const other: Parameters<typeof keepTokenFields>[0] = {
      company: { profile: {} },
    };
    keepTokenFields(
      other,
      issued({ resourceURI: SUB, authorizationURI: AUTH }),
      true,
    );
    expect(other.espiResourceUri).toBeUndefined();
    expect(other.espiAuthorizationUri).toBeUndefined();
  });

  it("leave the FDX consent id as it was handled before", () => {
    const run: Parameters<typeof keepTokenFields>[0] = {};
    keepTokenFields(run, issued({ consent_id: "grant_1" }), true);
    expect(run.fdxConsent).toBe("grant_1");
    keepTokenFields(run, issued({}), false);
    expect(run.fdxConsent).toBe("grant_1");
    keepTokenFields(run, issued({}), true);
    expect(run.fdxConsent).toBeUndefined();
  });
});

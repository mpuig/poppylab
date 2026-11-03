import { describe, expect, it } from "vitest";
import { modelError } from "./errors";

describe("safe provider errors", () => {
  it.each([
    [401, "provider_auth"],
    [403, "provider_access"],
    [404, "provider_model"],
    [429, "provider_quota"],
    [400, "provider_request"],
    [503, "provider_unavailable"],
  ])(
    "classifies HTTP %s without exposing provider content",
    (statusCode, code) => {
      const result = modelError({
        statusCode,
        message: "sensitive-provider-message",
        responseBody: "private-provider-body",
        requestHeaders: { authorization: "private-header-value" },
      });
      expect(result.code).toBe(code);
      expect(result.message).not.toMatch(
        /sensitive-provider|private-provider|private-header/,
      );
    },
  );
  it("identifies nested TLS failures", () => {
    expect(
      modelError({ cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } }).code,
    ).toBe("provider_tls");
  });
  it("identifies timeouts", () => {
    expect(modelError({ name: "TimeoutError" }).code).toBe("provider_timeout");
  });
  it("does not echo unknown errors", () => {
    const result = modelError(new Error("private-error-details"));
    expect(result.code).toBe("provider_network");
    expect(result.message).not.toContain("private-error-details");
  });
});

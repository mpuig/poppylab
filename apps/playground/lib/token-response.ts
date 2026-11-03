import { grantedSubset } from "./account-permissions";

/** Validates an OAuth token response (RFC 6749 §5.1, 0.3 §4.7). */
export function tokenResponse(
  result: Record<string, unknown>,
  requested: string,
  dpop: boolean,
  requireRefresh: boolean,
) {
  const scope =
    result.scope === undefined ? requested : (result.scope as unknown);
  if (
    typeof result.access_token !== "string" ||
    !result.access_token ||
    result.access_token.length > 4096 ||
    result.token_type !== (dpop ? "DPoP" : "Bearer") ||
    (result.expires_in !== undefined &&
      (typeof result.expires_in !== "number" ||
        !Number.isFinite(result.expires_in) ||
        result.expires_in <= 0)) ||
    (result.refresh_token !== undefined &&
      (typeof result.refresh_token !== "string" || !result.refresh_token)) ||
    (requireRefresh && result.refresh_token === undefined) ||
    !grantedSubset(scope, requested)
  )
    throw new Error("Invalid token response");
  return {
    accessToken: result.access_token,
    tokenType: (dpop ? "DPoP" : "Bearer") as "DPoP" | "Bearer",
    refreshToken: result.refresh_token as string | undefined,
    scope: scope as string,
    expires:
      Date.now() + Math.min(Number(result.expires_in ?? 3600), 3600) * 1000,
  };
}

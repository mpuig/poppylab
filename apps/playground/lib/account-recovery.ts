import { ProtocolError } from "@poppy-lab/pap-client";
export const accountUnavailableNotice = {
  code: "account_unavailable",
  status: 401,
  next: "signin",
  error:
    "The Company no longer accepts this access. It may have expired or been revoked. Sign in again to reconnect; no action has been retried.",
};
export function accountRecovery(error: unknown) {
  if (!(error instanceof ProtocolError) || error.status >= 500) return;
  if (error.code === "insufficient_scope")
    return {
      code: "insufficient_scope",
      status: 403,
      next: "permissions",
      error:
        "This access does not include the required permission. Choose Request change permission and review the new Company consent. Each change still needs separate approval.",
    };
  // 0.3 §7: a 401 challenge without an error code asks for sign-in.
  if (
    ["invalid_grant", "sign_in_required", "invalid_token"].includes(
      error.code ?? "",
    ) ||
    (error.status === 401 && !error.code)
  )
    return accountUnavailableNotice;
  if (error.code === "terms_changed")
    return {
      code: "terms_changed",
      status: 409,
      next: "status",
      error:
        "The terms changed. Use Check status, review the new revision and approve it separately.",
    };
  if (error.code === "operation_not_found")
    return {
      code: "operation_not_found",
      status: 404,
      next: "status",
      error:
        "This operation is not available to this account. Check the selected account before requesting another proposal.",
    };
}

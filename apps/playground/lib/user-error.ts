/**
 * An error whose message was written for the visitor and may be shown as-is.
 * Every other error reaches the browser as a generic message, so no Company
 * text, provider text or internal detail leaks by accident.
 */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}

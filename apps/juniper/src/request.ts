import type { Context } from "hono";

/**
 * A request's body as its content type says: JSON from the API and the
 * account page, or the sign-in form. Anything else, or a body that can't be
 * read, is none; each handler checks what it gets.
 */
export async function body(c: Context): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  try {
    if (type.startsWith("application/json")) return await c.req.json();
    if (
      type.startsWith("application/x-www-form-urlencoded") ||
      type.startsWith("multipart/form-data")
    )
      return await c.req.parseBody();
  } catch {
    // Unreadable is the same as absent.
  }
  return undefined;
}

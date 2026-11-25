/**
 * A query or fragment parameter whose name says it is a secret: the name
 * is, or contains as a whole word, one of these (token, access_token,
 * client_secret, X-Amz-Signature, session-id...).
 */
const secretParam =
  /(^|[&;])([^=&;]*[-_.])?(token|secret|passw(or)?d|pwd|sig|signature|credential|credentials|auth|authorization|bearer|session|sid|key|apikey|code|jwt|otp|x-amz-[a-z-]+|x-goog-[a-z-]+)([-_.][^=&;]*)?=/i;

/**
 * Shows a link without a signature or token: anyone holding one could use
 * it, so the page shows "…" in its place. A query and a fragment are
 * judged separately; links without such parameters are left as written,
 * and only the displayed text changes. A secret in the path itself cannot
 * be recognised and is not hidden.
 */
export function hideLinkSecrets(text: string) {
  return text.replace(
    /(https?:\/\/[^\s<>"')\]?#]*)(?:\?([^\s<>"')\]#]*))?(?:#([^\s<>"')\]]*))?/gi,
    (whole, address: string, query?: string, fragment?: string) => {
      const hideQuery = query !== undefined && secretParam.test(query);
      const hideFragment = fragment !== undefined && secretParam.test(fragment);
      if (!hideQuery && !hideFragment) return whole;
      return (
        address +
        (query === undefined ? "" : hideQuery ? "?…" : `?${query}`) +
        (fragment === undefined ? "" : hideFragment ? "#…" : `#${fragment}`)
      );
    },
  );
}

/**
 * Cloudflare Web Analytics, which sets no cookies: a beacon script that
 * reports page views to Cloudflare. It is on only when the site's public
 * token is set (`CF_WEB_ANALYTICS_TOKEN` in wrangler.toml's vars, which
 * `build:worker` passes to the build), and only then does the
 * Content-Security-Policy let the page load the beacon and send to it.
 * The token is read at build time: the policy and the prerendered pages
 * are fixed then.
 */
export const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
export const BEACON_ORIGIN = "https://static.cloudflareinsights.com";
export const REPORT_ORIGIN = "https://cloudflareinsights.com";

/** The token, if one is set; anything that isn't one stops the build. */
export function analyticsToken(
  value = process.env.CF_WEB_ANALYTICS_TOKEN,
): string | undefined {
  if (!value) return undefined;
  if (!/^[0-9a-f]{32}$/.test(value))
    throw new Error(
      "CF_WEB_ANALYTICS_TOKEN is not a Web Analytics token (32 hexadecimal characters).",
    );
  return value;
}

/**
 * The site's Content-Security-Policy. Visitors' model keys and standing
 * instructions live in the browser's storage, so the page may load code
 * only from itself and send data only to itself: the model providers are
 * called from the server. The one exception is the analytics beacon, when
 * a token is set. Next writes its page data as inline scripts and the
 * home, /developers and /learn are prerendered, so a per-request nonce
 * isn't possible and inline scripts stay allowed. Development adds eval,
 * which React's dev build uses.
 *
 * Cloudflare Turnstile, which guards the free model, loads its script and
 * its frame from `TURNSTILE_ORIGIN`. Only the playground shows the widget,
 * but the policy is the whole site's: a page reached by a link inside the
 * site keeps the policy of the page the visitor opened first, so a
 * playground opened from the home page would block the widget otherwise.
 */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export function contentSecurityPolicy({
  development = false,
  analytics = false,
}: { development?: boolean; analytics?: boolean } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""} ${TURNSTILE_ORIGIN}${analytics ? ` ${BEACON_ORIGIN}` : ""}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    // The stylesheets' icons are data: URLs.
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${analytics ? ` ${REPORT_ORIGIN}` : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Whether this runs in a Cloudflare Worker, which names itself in
 * `navigator.userAgent`. Node has a `navigator` too, with another name.
 */
export const onWorkers = () =>
  typeof navigator !== "undefined" &&
  navigator.userAgent === "Cloudflare-Workers";

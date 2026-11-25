const secretParam =
  /(^|[&;])(token|access_token|id_token|sig|signature|key|api_?key|secret|code|jwt|x-amz-[a-z-]+|x-goog-[a-z-]+)=/i;

/**
 * Shows a link without a signature or token: anyone holding one could use
 * it, so the page shows "…" after the address. Only the displayed text
 * changes; links without such parameters are left as written.
 */
export function hideLinkSecrets(text: string) {
  return text.replace(
    /(https?:\/\/[^\s<>"')\]]*?)\?([^\s<>"')\]#]*)(#[^\s<>"')\]]*)?/gi,
    (whole, address: string, query: string) =>
      secretParam.test(query) ? `${address}?…` : whole,
  );
}

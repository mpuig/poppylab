export class ModelRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ModelRequestError";
  }
}

/** Never expose provider messages, request headers, URLs, or response bodies. */
export function modelError(error: unknown): ModelRequestError {
  const chain: Array<Record<string, unknown>> = [];
  let current = error;
  for (
    let depth = 0;
    depth < 6 && current && typeof current === "object";
    depth++
  ) {
    chain.push(current as Record<string, unknown>);
    current = (current as { cause?: unknown }).cause;
  }
  const status = chain
    .map((item) => item.statusCode)
    .find((value) => typeof value === "number");
  const codes = chain.map((item) => item.code);
  if (
    codes.some((code) =>
      [
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "CERT_HAS_EXPIRED",
      ].includes(String(code)),
    )
  ) {
    return new ModelRequestError(
      "provider_tls",
      "The LLM connection failed certificate verification. Configure Node to trust your network's CA using NODE_EXTRA_CA_CERTS, then restart pnpm dev. Do not disable TLS verification.",
    );
  }
  if (status === 401)
    return new ModelRequestError(
      "provider_auth",
      "The LLM provider rejected the API key (HTTP 401). Check the selected provider's key in apps/playground/.env.local and restart pnpm dev.",
    );
  if (status === 403)
    return new ModelRequestError(
      "provider_access",
      "The LLM provider denied access (HTTP 403). Check account permissions and model availability.",
    );
  if (status === 429)
    return new ModelRequestError(
      "provider_quota",
      "The LLM provider returned HTTP 429. Check billing, available credits, and rate limits in your provider account, then retry.",
    );
  if (status === 404)
    return new ModelRequestError(
      "provider_model",
      "The LLM model or endpoint was not found (HTTP 404). Check the model name, base URL, and model access for your account.",
    );
  if (status === 400 || status === 422)
    return new ModelRequestError(
      "provider_request",
      "The LLM provider rejected the request. Check that the configured model supports chat, tools, and the requested output-token limit.",
    );
  if (typeof status === "number" && status >= 500)
    return new ModelRequestError(
      "provider_unavailable",
      "The LLM provider is temporarily unavailable. Retry later or select another provider.",
    );
  if (
    chain.some(
      (item) => item.name === "AbortError" || item.name === "TimeoutError",
    )
  )
    return new ModelRequestError(
      "provider_timeout",
      "The LLM request timed out. Retry, or select a faster model.",
    );
  return new ModelRequestError(
    "provider_network",
    "Could not complete the LLM request. Check internet access and the configured endpoint. For Ollama, confirm it is running and the model is installed.",
  );
}

import type { ZodType } from "zod";

/** The one error shape for malformed public API input. */
export type InvalidRequest = {
  status: 400;
  code: "invalid_request";
  error: string;
};

export type ParsedInput<T> =
  { ok: true; value: T } | { ok: false; error: InvalidRequest };

/**
 * Messages keyed by a schema path such as `model.provider`. Only text written
 * here may reach a client; Zod's messages and submitted values never do.
 */
export type ValidationMessages = Readonly<Record<string, string>>;

/** Places a reusable schema's messages below the field that contains it. */
export const prefixValidationMessages = (
  prefix: string,
  messages: ValidationMessages,
): ValidationMessages =>
  Object.fromEntries(
    Object.entries(messages).map(([path, message]) => [
      path ? `${prefix}.${path}` : prefix,
      message,
    ]),
  );

const FALLBACK = "The request is invalid.";

export const invalidRequest = (error = FALLBACK): InvalidRequest => ({
  status: 400,
  code: "invalid_request",
  error,
});

const messageFor = (
  path: readonly PropertyKey[],
  messages: ValidationMessages,
  fallback: string,
) => {
  if (!path.every((part) => typeof part === "string")) return fallback;
  for (let length = path.length; length > 0; length--) {
    const message = messages[path.slice(0, length).join(".")];
    if (message) return message;
  }
  return fallback;
};

/**
 * Parses untrusted public API input. A failure contains only project-written
 * text: it never returns or logs Zod's issue, path or received value.
 */
export function parsePublicInput<T>(
  schema: ZodType<T>,
  input: unknown,
  options: {
    messages?: ValidationMessages;
    fallback?: string;
  } = {},
): ParsedInput<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const first = parsed.error.issues[0];
  return {
    ok: false,
    error: invalidRequest(
      first
        ? messageFor(
            first.path,
            options.messages ?? {},
            options.fallback ?? FALLBACK,
          )
        : (options.fallback ?? FALLBACK),
    ),
  };
}

import type { ZodType } from "zod";
import {
  invalidRequest,
  parsePublicInput,
  type ParsedInput,
  type ValidationMessages,
} from "./api-contract/index.ts";
import { UserFacingError } from "./user-error";
import { readJson } from "./web";

const BODY_FAILURES: Record<string, string> = {
  "Use JSON": "Use JSON.",
  "Missing request": "Send a JSON object.",
  "Request timed out": "The request timed out.",
  "Request too large": "The request is too large.",
};

/** Reads and validates one public JSON body without exposing submitted data. */
export async function readPublicInput<T>(
  request: Request,
  limit: number,
  schema: ZodType<T>,
  messages: ValidationMessages = {},
): Promise<ParsedInput<T>> {
  let read: unknown;
  try {
    read = await readJson(request, limit);
  } catch (failure) {
    const message =
      failure instanceof UserFacingError
        ? (BODY_FAILURES[failure.message] ?? "The request couldn't be read.")
        : "Send a JSON object.";
    return { ok: false, error: invalidRequest(message) };
  }
  return parsePublicInput(schema, read, {
    messages,
    fallback: "Send a JSON object with the documented fields.",
  });
}

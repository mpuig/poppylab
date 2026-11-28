import type { ZodType } from "zod";
import type { ValidationMessages } from "./errors.ts";

export type ApiMethod = "GET" | "POST" | "DELETE";

/**
 * One public HTTP operation. Later route migrations use the same schemas for
 * request parsing and OpenAPI generation.
 */
export type ApiOperation = {
  method: ApiMethod;
  path: string;
  operationId: string;
  parameters?: ZodType;
  body?: ZodType;
  messages?: ValidationMessages;
};

/** Keeps an operation's literal method, path and ID while checking its shape. */
export const defineOperation = <const T extends ApiOperation>(operation: T) =>
  operation;

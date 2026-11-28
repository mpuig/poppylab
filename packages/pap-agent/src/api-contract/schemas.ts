import { z } from "zod";
import type { ValidationMessages } from "./errors.ts";

// A playground page may import contract types beside its examples. Its CSP
// allows no eval, so schemas use the same interpreter mode as pap-core.
z.config({ jitless: true });

/** One URL-safe path segment before an operation applies its own ID format. */
export const pathSegmentSchema = z
  .string()
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/);

/** A conversation ID as accepted by the conversation store. */
export const conversationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** A one-use app sign-in ticket: also 32 random bytes in base64url. */
export const signInTicketSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** An Operations v3 operation or revision ID. */
export const operationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

/** A Company address as accepted before discovery checks the URL itself. */
export const companyInputSchema = z
  .string()
  .max(2048)
  .refine((value) => value.trim().length > 0);

/** The model selection sent with a message or quick-reply answer. */
export const modelChoiceSchema = z.object({
  provider: z.enum(["demo", "free", "openai-compatible", "anthropic"]),
  apiKey: z.string().max(2048).optional(),
  model: z.string().max(256).optional(),
  turnstile: z.string().max(2048).optional(),
});

export type ModelChoiceInput = z.infer<typeof modelChoiceSchema>;

/** Client-safe messages for `modelChoiceSchema`; none includes input data. */
export const modelChoiceMessages = {
  provider:
    "model.provider must be demo, free, openai-compatible or anthropic.",
  apiKey: "model.apiKey must be a string of at most 2,048 characters.",
  model: "model.model must be a string of at most 256 characters.",
  turnstile: "model.turnstile must be a string of at most 2,048 characters.",
} as const satisfies ValidationMessages;

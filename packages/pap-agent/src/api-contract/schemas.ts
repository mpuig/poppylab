import { z } from "zod";
import type { ValidationMessages } from "./errors.ts";

// A playground page may import contract types beside its examples. Its CSP
// allows no eval, so schemas use the same interpreter mode as pap-core.
z.config({ jitless: true });

/** A name carried in an `/api/v1` path. */
export const pathIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** A Company address as accepted before discovery checks the URL itself. */
export const companyInputSchema = z
  .string()
  .max(2048)
  .refine((value) => value.trim().length > 0);

/** The model selection sent with a message or quick-reply answer. */
export const modelChoiceSchema = z.object({
  provider: z.enum(["demo", "free", "openai-compatible", "anthropic"]),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  turnstile: z.string().optional(),
});

export type ModelChoiceInput = z.infer<typeof modelChoiceSchema>;

/** Client-safe messages for `modelChoiceSchema`; none includes input data. */
export const modelChoiceMessages = {
  provider:
    "model.provider must be demo, free, openai-compatible or anthropic.",
  apiKey: "model.apiKey must be a string.",
  model: "model.model must be a string.",
  turnstile: "model.turnstile must be a string.",
} as const satisfies ValidationMessages;

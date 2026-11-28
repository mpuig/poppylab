import { z } from "zod";
import { defineOperation } from "./operation.ts";
import {
  companyInputSchema,
  conversationIdSchema,
  modelChoiceMessages,
  modelChoiceSchema,
  operationIdSchema,
  signInTicketSchema,
} from "./schemas.ts";
import { prefixValidationMessages, type ValidationMessages } from "./errors.ts";
const answerMessageSchema = z
  .string()
  .max(2000)
  .refine((value) => value.trim().length > 0);
const companiesSchema = z.array(companyInputSchema).min(1).max(3);

export const proposalRefInputSchema = z.strictObject({
  company: companyInputSchema,
  proposal: operationIdSchema,
  revision: operationIdSchema,
});

/**
 * A quick reply is deliberately exact: it carries one command only. Unlike
 * its surrounding request body, unknown members here have never been valid.
 */
export const answerInputSchema = z.union([
  z.strictObject({ company: companyInputSchema }),
  z.strictObject({ connect: companyInputSchema }),
  z.strictObject({ remove: companiesSchema }),
  z.strictObject({ keep: companiesSchema }),
  z.strictObject({ message: answerMessageSchema }),
  z.strictObject({ approve: proposalRefInputSchema }),
  z.strictObject({ decline: proposalRefInputSchema }),
  z.strictObject({
    signin: z.strictObject({
      company: companyInputSchema,
      access: z.enum(["read", "write"]),
    }),
  }),
  z.strictObject({ signout: companyInputSchema }),
  z.strictObject({ resume: companyInputSchema }),
  z.strictObject({
    invitation: z.strictObject({
      company: companyInputSchema,
      accept: z.boolean(),
    }),
  }),
]);

export type AnswerInput = z.infer<typeof answerInputSchema>;

export const startConversationInputSchema = z.object({
  company: companyInputSchema.optional(),
});

export const sendMessageInputSchema = z.object({
  text: z.string(),
  company: companyInputSchema.optional(),
  model: modelChoiceSchema.optional(),
});

export const answerChoiceInputSchema = z.object({
  answer: answerInputSchema,
  model: modelChoiceSchema.optional(),
});

export const decideProposalInputSchema = z.object({
  company: companyInputSchema,
  revision: operationIdSchema,
  decision: z.enum(["approve", "decline"]),
});

export const startSignInInputSchema = z.object({
  company: companyInputSchema,
  access: z.enum(["read", "write"]).optional(),
});

export const conversationPathSchema = z.object({ id: conversationIdSchema });
export const proposalPathSchema = z.object({
  id: conversationIdSchema,
  proposal: operationIdSchema,
});
export const signInTicketPathSchema = z.object({ ticket: signInTicketSchema });

const messages = {
  startConversation: {
    company: "company must be a non-empty string of at most 2,048 characters.",
  },
  sendMessage: {
    text: "text must be a string.",
    company: "company must be a non-empty string of at most 2,048 characters.",
    model: "model must be an object.",
    ...prefixValidationMessages("model", modelChoiceMessages),
  },
  answerChoice: {
    answer: "answer must be one valid quick-reply object.",
    model: "model must be an object.",
    ...prefixValidationMessages("model", modelChoiceMessages),
  },
  decideProposal: {
    company: "company must be a non-empty string of at most 2,048 characters.",
    revision:
      "revision must be a URL-safe operation ID of at most 128 characters.",
    decision: "decision must be approve or decline.",
  },
  startSignIn: {
    company: "company must be a non-empty string of at most 2,048 characters.",
    access: "access must be read or write.",
  },
} as const satisfies Record<string, ValidationMessages>;

export const conversationOperations = {
  startConversation: defineOperation({
    method: "POST",
    path: "/conversations",
    operationId: "startConversation",
    body: startConversationInputSchema,
    messages: messages.startConversation,
  }),
  getConversation: defineOperation({
    method: "GET",
    path: "/conversations/{id}",
    operationId: "getConversation",
    parameters: conversationPathSchema,
  }),
  listPending: defineOperation({
    method: "GET",
    path: "/pending",
    operationId: "listPending",
  }),
  sendMessage: defineOperation({
    method: "POST",
    path: "/conversations/{id}/messages",
    operationId: "sendMessage",
    parameters: conversationPathSchema,
    body: sendMessageInputSchema,
    messages: messages.sendMessage,
  }),
  answerChoice: defineOperation({
    method: "POST",
    path: "/conversations/{id}/answers",
    operationId: "answerChoice",
    parameters: conversationPathSchema,
    body: answerChoiceInputSchema,
    messages: messages.answerChoice,
  }),
  decideProposal: defineOperation({
    method: "POST",
    path: "/conversations/{id}/proposals/{proposal}/decision",
    operationId: "decideProposal",
    parameters: proposalPathSchema,
    body: decideProposalInputSchema,
    messages: messages.decideProposal,
  }),
  startSignIn: defineOperation({
    method: "POST",
    path: "/conversations/{id}/sign-ins",
    operationId: "startSignIn",
    parameters: conversationPathSchema,
    body: startSignInInputSchema,
    messages: messages.startSignIn,
  }),
  conversationEvents: defineOperation({
    method: "GET",
    path: "/conversations/{id}/events",
    operationId: "conversationEvents",
    parameters: conversationPathSchema,
  }),
  openSignInLink: defineOperation({
    method: "GET",
    path: "/sign-ins/{ticket}",
    operationId: "openSignInLink",
    parameters: signInTicketPathSchema,
  }),
} as const;

export type ConversationOperation = keyof typeof conversationOperations;

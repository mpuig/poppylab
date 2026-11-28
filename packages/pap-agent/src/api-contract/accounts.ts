import { z } from "zod";
import type { ValidationMessages } from "./errors.ts";
import { defineOperation } from "./operation.ts";
import { opaqueIdSchema, refreshTokenSchema } from "./schemas.ts";

const boundedString = z.string().max(16000);
const credentialBase = {
  id: z.string().max(2048),
  rawId: z.string().max(2048),
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z
    .enum(["cross-platform", "platform"])
    .nullable()
    .optional(),
};

/** The browser JSON returned after creating a WebAuthn credential. */
export const registrationCredentialSchema = z.object({
  ...credentialBase,
  response: z.object({
    clientDataJSON: boundedString,
    attestationObject: boundedString,
    transports: z.array(z.string().max(32)).max(16).optional(),
    publicKey: boundedString.optional(),
    publicKeyAlgorithm: z.number().int().optional(),
  }),
});

/** The browser JSON returned after proving a WebAuthn credential. */
export const authenticationCredentialSchema = z.object({
  ...credentialBase,
  response: z.object({
    clientDataJSON: boundedString,
    authenticatorData: boundedString,
    signature: boundedString,
    userHandle: z.string().max(2048).nullable().optional(),
  }),
});

export const emptyInputSchema = z.object({});
export const accountOptionsInputSchema = z.object({
  label: z.string().optional(),
});
export const createAccountInputSchema = z.object({
  ceremony: opaqueIdSchema,
  credential: registrationCredentialSchema,
  device: z.string().optional(),
});
export const signInInputSchema = z.object({
  ceremony: opaqueIdSchema,
  credential: authenticationCredentialSchema,
  device: z.string().optional(),
});
export const addPasskeyInputSchema = createAccountInputSchema;
export const refreshSessionInputSchema = z.object({
  refreshToken: refreshTokenSchema,
});
export const redeemLinkCodeInputSchema = z.object({
  channel: z.string().max(32),
  user: z.string().min(1).max(256),
  code: z.string().max(32),
});

export const passkeyPathSchema = z.object({ passkey: opaqueIdSchema });
export const sessionPathSchema = z.object({ session: opaqueIdSchema });

const passkeyAnswerMessages = {
  ceremony:
    "ceremony must be the ID returned by the corresponding options request.",
  credential: "credential must be a valid WebAuthn response object.",
  device: "device must be a string.",
} as const satisfies ValidationMessages;

const messages = {
  accountOptions: {
    label: "label must be a string.",
  },
  passkeyAnswer: passkeyAnswerMessages,
  refreshSession: {
    refreshToken: "refreshToken must be a valid refresh token string.",
  },
  redeemLinkCode: {
    channel: "channel must be a string of at most 32 characters.",
    user: "user must be a non-empty string of at most 256 characters.",
    code: "code must be a string of at most 32 characters.",
  },
} as const satisfies Record<string, ValidationMessages>;

export const accountOperations = {
  accountOptions: defineOperation({
    method: "POST",
    path: "/accounts/options",
    operationId: "accountOptions",
    body: accountOptionsInputSchema,
    messages: messages.accountOptions,
  }),
  createAccount: defineOperation({
    method: "POST",
    path: "/accounts",
    operationId: "createAccount",
    body: createAccountInputSchema,
    messages: messages.passkeyAnswer,
  }),
  signInOptions: defineOperation({
    method: "POST",
    path: "/sessions/options",
    operationId: "signInOptions",
    body: emptyInputSchema,
  }),
  signIn: defineOperation({
    method: "POST",
    path: "/sessions",
    operationId: "signIn",
    body: signInInputSchema,
    messages: messages.passkeyAnswer,
  }),
  refreshSession: defineOperation({
    method: "POST",
    path: "/sessions/refresh",
    operationId: "refreshSession",
    body: refreshSessionInputSchema,
    messages: messages.refreshSession,
  }),
  getAccount: defineOperation({
    method: "GET",
    path: "/account",
    operationId: "getAccount",
  }),
  passkeyOptions: defineOperation({
    method: "POST",
    path: "/account/passkeys/options",
    operationId: "passkeyOptions",
    body: emptyInputSchema,
  }),
  addPasskey: defineOperation({
    method: "POST",
    path: "/account/passkeys",
    operationId: "addPasskey",
    body: addPasskeyInputSchema,
    messages: messages.passkeyAnswer,
  }),
  removePasskey: defineOperation({
    method: "DELETE",
    path: "/account/passkeys/{passkey}",
    operationId: "removePasskey",
    parameters: passkeyPathSchema,
  }),
  listSessions: defineOperation({
    method: "GET",
    path: "/account/sessions",
    operationId: "listSessions",
  }),
  revokeSession: defineOperation({
    method: "DELETE",
    path: "/account/sessions/{session}",
    operationId: "revokeSession",
    parameters: sessionPathSchema,
  }),
  revokeAllSessions: defineOperation({
    method: "DELETE",
    path: "/account/sessions",
    operationId: "revokeAllSessions",
  }),
  signOut: defineOperation({
    method: "POST",
    path: "/account/sign-out",
    operationId: "signOut",
    body: emptyInputSchema,
  }),
  claimConversations: defineOperation({
    method: "POST",
    path: "/account/claim",
    operationId: "claimConversations",
    body: emptyInputSchema,
  }),
  createLinkCode: defineOperation({
    method: "POST",
    path: "/account/link-codes",
    operationId: "createLinkCode",
    body: emptyInputSchema,
  }),
  redeemLinkCode: defineOperation({
    method: "POST",
    path: "/link-codes/redeem",
    operationId: "redeemLinkCode",
    body: redeemLinkCodeInputSchema,
    messages: messages.redeemLinkCode,
  }),
} as const;

export type AccountOperationContract = keyof typeof accountOperations;

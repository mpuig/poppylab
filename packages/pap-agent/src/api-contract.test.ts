import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  conversationIdSchema,
  conversationOperations,
  defineOperation,
  modelChoiceMessages,
  modelChoiceSchema,
  operationIdSchema,
  parsePublicInput,
  sendMessageInputSchema,
  signInTicketSchema,
} from "./api-contract/index.ts";

afterEach(() => vi.restoreAllMocks());

describe("public API input", () => {
  it("parses a model choice and drops unknown fields", () => {
    const parsed = parsePublicInput(
      modelChoiceSchema,
      {
        provider: "openai-compatible",
        apiKey: "test-key",
        model: "test-model",
        ignored: "not part of the contract",
      },
      { messages: modelChoiceMessages },
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        provider: "openai-compatible",
        apiKey: "test-key",
        model: "test-model",
      },
    });
  });

  it("uses project-written validation messages", () => {
    expect(
      parsePublicInput(
        modelChoiceSchema,
        { provider: "other" },
        {
          messages: modelChoiceMessages,
        },
      ),
    ).toEqual({
      ok: false,
      error: {
        status: 400,
        code: "invalid_request",
        error:
          "model.provider must be demo, free, openai-compatible or anthropic.",
      },
    });
  });

  it("finds reusable messages when their schema is nested", () => {
    expect(
      parsePublicInput(
        sendMessageInputSchema,
        { text: "Hello", model: { provider: "other" } },
        {
          messages: conversationOperations.sendMessage.messages,
        },
      ),
    ).toEqual({
      ok: false,
      error: {
        status: 400,
        code: "invalid_request",
        error:
          "model.provider must be demo, free, openai-compatible or anthropic.",
      },
    });
  });

  it("bounds model credentials and names", () => {
    for (const choice of [
      { provider: "anthropic", apiKey: "k".repeat(2049) },
      { provider: "openai-compatible", model: "m".repeat(257) },
      { provider: "free", turnstile: "t".repeat(2049) },
    ])
      expect(modelChoiceSchema.safeParse(choice).success).toBe(false);
  });

  it("uses the actual formats of public path IDs", () => {
    expect(conversationIdSchema.safeParse("a".repeat(16)).success).toBe(true);
    expect(conversationIdSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(conversationIdSchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(operationIdSchema.safeParse("_revision").success).toBe(true);
    expect(operationIdSchema.safeParse("-".repeat(256)).success).toBe(true);
    expect(operationIdSchema.safeParse("a".repeat(257)).success).toBe(false);
    expect(signInTicketSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(signInTicketSchema.safeParse("run_1").success).toBe(false);
  });

  it("limits user messages to 2,000 characters", () => {
    expect(
      sendMessageInputSchema.safeParse({ text: "m".repeat(2000) }).success,
    ).toBe(true);
    expect(
      sendMessageInputSchema.safeParse({ text: "m".repeat(2001) }).success,
    ).toBe(false);
  });

  it("never returns or logs submitted secrets", () => {
    const sentinels = {
      apiKey: "sentinel-api-key-91f730",
      credential: "sentinel-passkey-credential-24bcee",
      token: "sentinel-refresh-token-e7630d",
      code: "sentinel-link-code-2a68f4",
    };
    const schema = z.object({
      apiKey: z.string(),
      credential: z.object({ id: z.string() }),
      token: z.string(),
      code: z.string(),
    });
    const messages = {
      apiKey: "apiKey must be a string.",
      credential: "credential must be an object.",
      token: "token must be a string.",
      code: "code must be a string.",
    };
    const spies = [
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
    ];

    for (const [field, secret] of Object.entries(sentinels)) {
      const input = {
        apiKey: "valid",
        credential: { id: "valid" },
        token: "valid",
        code: "valid",
        [field]: { submitted: secret },
      };
      const parsed = parsePublicInput(schema, input, { messages });
      expect(parsed.ok).toBe(false);
      expect(JSON.stringify(parsed)).not.toContain(secret);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("API operation contracts", () => {
  it("keeps literal operation details", () => {
    const operation = defineOperation({
      method: "POST",
      path: "/conversations/{id}/messages",
      operationId: "sendMessage",
      body: z.object({ text: z.string() }),
    });
    expect(operation.method).toBe("POST");
    expect(operation.operationId).toBe("sendMessage");
  });
});

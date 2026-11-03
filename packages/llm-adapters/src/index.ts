export type ModelProviderId =
  "demo" | "openai-compatible" | "anthropic" | "google" | "ollama";

export interface ModelProviderDefinition {
  id: ModelProviderId;
  label: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  modelPlaceholder: string;
}

export const modelProviders: readonly ModelProviderDefinition[] = [
  {
    id: "demo",
    label: "Protocol demo · no LLM",
    requiresApiKey: false,
    modelPlaceholder: "Deterministic",
  },
  {
    id: "openai-compatible",
    label: "OpenAI compatible",
    requiresApiKey: true,
    modelPlaceholder: "gpt-4.1-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    requiresApiKey: true,
    modelPlaceholder: "claude-sonnet-4-6",
  },
  {
    id: "google",
    label: "Google Gemini",
    requiresApiKey: true,
    modelPlaceholder: "gemini-2.5-flash",
  },
  {
    id: "ollama",
    label: "Ollama / local",
    requiresApiKey: false,
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    modelPlaceholder: "qwen3:8b",
  },
] as const;

export interface SanitizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelTurn {
  text?: string;
  toolCalls?: SanitizedToolCall[];
}

export interface ModelAdapter {
  complete(input: {
    model: string;
    system: string;
    messages: Array<{ role: "user" | "assistant" | "tool"; content: string }>;
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>;
  }): Promise<ModelTurn>;
}

export class SecretBoundaryError extends Error {
  constructor() {
    super(
      "Model adapters accept sanitized tools and results only; protocol secrets are not valid model input.",
    );
    this.name = "SecretBoundaryError";
  }
}

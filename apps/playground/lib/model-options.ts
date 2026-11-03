export const chatModels = [
  {
    id: "openai-compatible",
    label: "OpenAI compatible",
    model: "gpt-6-luna",
    detail: "Low reasoning",
  },
  { id: "anthropic", label: "Anthropic", model: "sonnet-5", detail: "" },
  // No model and no key: keyword rules call the Company's tools directly.
  { id: "demo", label: "Protocol demo", model: "none", detail: "" },
] as const;
export const needsKey = (provider: string) => provider !== "demo";
export type ModelConfig = {
  provider: (typeof chatModels)[number]["id"];
  apiKey: string;
  model: string;
};
export const initialModel: ModelConfig = {
  provider: "openai-compatible",
  apiKey: "",
  model: "gpt-6-luna",
};
export function restoreModel(value: unknown): ModelConfig | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  const option = chatModels.find((p) => p.id === saved.provider);
  if (!option || typeof saved.apiKey !== "string" || saved.apiKey.length > 2048)
    return null;
  return { provider: option.id, apiKey: saved.apiKey, model: option.model };
}

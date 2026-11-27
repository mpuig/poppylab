export const chatModels = [
  // The deployment's own small model on Workers AI: no key, limited turns.
  { id: "free", label: "Free model (limited)", model: "gemma-4", detail: "" },
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
export const needsKey = (provider: string) =>
  provider !== "demo" && provider !== "free";
export type ModelConfig = {
  provider: (typeof chatModels)[number]["id"];
  apiKey: string;
  model: string;
};
/**
 * A first visit starts in demo mode, so the chat works with no key. The
 * free model takes its place where the deployment offers it, and so does
 * a saved choice, or a key configured on the server.
 */
export const initialModel: ModelConfig = {
  provider: "demo",
  apiKey: "",
  model: "none",
};
export const freeModel: ModelConfig = {
  provider: "free",
  apiKey: "",
  model: "gemma-4",
};
export function restoreModel(value: unknown): ModelConfig | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  const option = chatModels.find((p) => p.id === saved.provider);
  if (!option || typeof saved.apiKey !== "string" || saved.apiKey.length > 2048)
    return null;
  return { provider: option.id, apiKey: saved.apiKey, model: option.model };
}

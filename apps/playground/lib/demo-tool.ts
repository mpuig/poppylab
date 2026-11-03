/**
 * Protocol demo (no model): for a Company without Juniper's tool names,
 * pick the tool that best matches the question among those that need no
 * arguments, so the demo never invents arguments for unknown schemas.
 */
type Tool = { description: string; schema: Record<string, unknown> };
const synonyms: Record<string, string[]> = {
  product: [
    "product",
    "catalog",
    "catalogue",
    "inventory",
    "menu",
    "item",
    "dish",
  ],
  order: ["order", "booking", "reservation"],
  deliver: ["deliver", "slot", "shipping", "availability"],
  account: ["account", "profile", "whoami", "me", "reward"],
};
export function pickDemoTool(message: string, tools: Record<string, Tool>) {
  const free = Object.entries(tools).filter(([, t]) => {
    const required = t.schema.required;
    return !Array.isArray(required) || required.length === 0;
  });
  if (!free.length) return undefined;
  const words = message.toLowerCase();
  // A tool named in the message wins ("whoami").
  const named = free.find(([name]) => words.includes(name.toLowerCase()));
  if (named) return named[0];
  const score = ([name, t]: [string, Tool]) => {
    const text = `${name} ${t.description}`.toLowerCase();
    let s = 0;
    for (const [key, list] of Object.entries(synonyms))
      if (list.some((w) => words.includes(w)) || words.includes(key))
        s += list.filter((w) => text.includes(w)).length;
    return s;
  };
  return [...free].sort((a, b) => score(b) - score(a))[0]![0];
}

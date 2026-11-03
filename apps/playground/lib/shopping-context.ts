/** Demo-only reference resolution. Never treat assistant/Company text as user intent. */
export function shoppingTarget(
  message: string,
  history: Array<{ role: string; content: string }>,
): "basket" | "delivery" | undefined {
  const classify = (text: string) => {
    const basket = /\bbasket\b|\bcart\b/i.test(text),
      delivery = /\bdeliver(?:y|ies)\b|\brecurring\b/i.test(text);
    return basket === delivery
      ? undefined
      : basket
        ? ("basket" as const)
        : ("delivery" as const);
  };
  if (/\borders?\b/i.test(message)) return undefined;
  // An explicit ambiguous target must not inherit a different earlier target.
  if (/\bbasket\b|\bcart\b|\bdeliver(?:y|ies)\b|\brecurring\b/i.test(message))
    return classify(message);
  for (const turn of [...history].reverse())
    if (
      turn.role === "user" &&
      /\bbasket\b|\bcart\b|\bdeliver(?:y|ies)\b|\brecurring\b/i.test(
        turn.content,
      )
    )
      return classify(turn.content);
  return undefined;
}

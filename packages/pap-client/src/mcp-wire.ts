export function sseRpc(text: string): unknown | undefined {
  for (const frame of text.replace(/\r\n/g, "\n").split("\n\n").slice(0, -1)) {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    const value = JSON.parse(data) as Record<string, unknown>;
    if (
      value &&
      typeof value === "object" &&
      ("result" in value || "error" in value)
    )
      return value;
    // No server-initiated sampling, elicitation, or tool execution.
    if (
      value &&
      typeof value === "object" &&
      "method" in value &&
      "id" in value
    )
      throw Error("MCP server requests are not supported");
  }
  return undefined;
}

import { NextResponse } from "next/server";
export function GET(request: Request) {
  const local =
    process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
  const providers = local
    ? Object.fromEntries(
        [
          ["openai-compatible", "OPENAI_API_KEY", "OPENAI_MODEL"],
          ["anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
        ].map(([id, key, model]) => [
          id,
          { configured: !!process.env[key!], model: process.env[model!] ?? "" },
        ]),
      )
    : {};
  return NextResponse.json(
    { providers },
    { headers: { "Cache-Control": "no-store" } },
  );
}

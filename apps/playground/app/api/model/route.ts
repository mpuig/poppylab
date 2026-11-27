import "@/lib/agent";
import { NextResponse } from "next/server";
import { freeModelStatus } from "@poppy-lab/pap-agent/free-model";

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
  // Whether the free model runs here, with the public Turnstile site key
  // its widget needs, or why not.
  return NextResponse.json(
    { providers, free: freeModelStatus() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

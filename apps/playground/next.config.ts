import type { NextConfig } from "next";
import { AGENT_NAME } from "./lib/agent-name";

const nextConfig: NextConfig = {
  // The agent core's sentences that the page renders name the agent too
  // (`agentName` in @poppy-lab/pap-agent/agent).
  env: { AGENT_NAME },
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/*": [
      ".poppy/**/*",
      ".env*",
      "../../.poppy/**/*",
      "../juniper/.poppy/**/*",
      "../juniper/.env*",
      "../northwind/.poppy/**/*",
      "../northwind/.env*",
    ],
  },
  // OAuth callback query strings contain one-time credentials. Browser logs
  // aren't forwarded: in development Next writes them under .next/dev/logs,
  // which its watcher picks up, reloading the page in a loop.
  logging: { incomingRequests: false, browserToTerminal: false },
  // Learn no longer has a page of pitfalls; its old address leads to the
  // overview instead of a dead end.
  async redirects() {
    return [
      { source: "/learn/pitfalls", destination: "/learn", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  transpilePackages: [
    "@poppy-lab/pap-agent",
    "@poppy-lab/pap-core",
    "@poppy-lab/pap-client",
    "@poppy-lab/llm-adapters",
  ],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;

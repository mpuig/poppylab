import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/*": [
      ".poppy/**/*",
      ".env*",
      "../../.poppy/**/*",
      "../example-company/.poppy/**/*",
      "../example-company/.env*",
      "../northwind/.poppy/**/*",
      "../northwind/.env*",
    ],
  },
  // OAuth callback query strings contain one-time credentials. Browser logs
  // aren't forwarded: in development Next writes them under .next/dev/logs,
  // which its watcher picks up, reloading the page in a loop.
  logging: { incomingRequests: false, browserToTerminal: false },
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
    "@poppy-lab/pap-core",
    "@poppy-lab/pap-client",
    "@poppy-lab/llm-adapters",
  ],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;

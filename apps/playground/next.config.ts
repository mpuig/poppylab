import type { NextConfig } from "next";
import { AGENT_NAME } from "./lib/agent-name";

// Visitors' model keys and standing instructions live in the browser's
// storage, so the page may load code only from itself and send data only
// to itself: the model providers are called from the server. Next writes
// its page data as inline scripts and the home, /developers and /learn are
// prerendered, so a per-request nonce isn't possible and inline scripts
// stay allowed. Development adds eval, which React's dev build uses.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // The stylesheets' icons are data: URLs.
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // The agent core's sentences that the page renders name the agent too
  // (`agentName` in @poppy-lab/pap-agent/agent).
  env: { AGENT_NAME },
  poweredByHeader: false,
  // Local state and secrets anywhere in the workspace, whichever app or
  // package they belong to; build-worker refuses a bundle that has any.
  outputFileTracingExcludes: {
    "/*": [
      ".poppy/**/*",
      ".env*",
      ".dev.vars*",
      "../../**/.poppy/**/*",
      "../../**/.env*",
      "../../**/.dev.vars*",
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
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          // The zone doesn't send it; browsers ignore it over plain HTTP.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
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

import type { NextConfig } from "next";
import { AGENT_NAME } from "./lib/agent-name";
import { analyticsToken, contentSecurityPolicy } from "./lib/analytics";
import { postFiles } from "./lib/post-files";

// Read once, at build time: see lib/analytics.ts.
const analytics = analyticsToken();
const csp = contentSecurityPolicy({
  development: process.env.NODE_ENV === "development",
  analytics: analytics !== undefined,
});

const nextConfig: NextConfig = {
  // The agent core's sentences that the page renders name the agent too
  // (`agentName` in @poppy-lab/pap-agent/agent). The analytics token is
  // inlined, so every page, prerendered or not, has the build's value. So is
  // the number of posts, which the site's header and footer read, the
  // error page's in the browser too (`app/site-chrome.tsx`); `next dev`
  // counts them when it starts.
  env: {
    AGENT_NAME,
    CF_WEB_ANALYTICS_TOKEN: analytics ?? "",
    POPPY_POSTS: String(postFiles().length),
  },
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
          { key: "Content-Security-Policy", value: csp },
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

import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Routes are dynamic and per visitor. The few prerendered pages (the home,
// /developers and /learn, built from docs/learn) are read-only and never
// revalidated, so they're served from Workers static assets; build-worker
// copies them there after the secret check.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});

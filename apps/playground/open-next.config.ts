import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every route is dynamic and per visitor: no incremental cache.
export default defineCloudflareConfig({});

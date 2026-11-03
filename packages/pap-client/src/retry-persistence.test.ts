import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vault } from "./vault.js";
import type { RetryState } from "./protocol-error.js";
it("restores Retry-After from the encrypted vault after a fresh module load", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "poppy-retry-"));
  const initial = (): RetryState => ({ until: 0, entries: [] });
  try {
    const first = await vi.importActual<typeof import("./protocol-error.js")>(
      "./protocol-error.js",
    );
    const now = Date.now();
    first.configureRetryStore(vault("retry-after", initial, directory));
    first.recordCooldown("https://company.example", "60", now);
    vi.resetModules();
    const restarted = await vi.importActual<
      typeof import("./protocol-error.js")
    >("./protocol-error.js");
    expect(restarted.ProtocolError).not.toBe(first.ProtocolError);
    restarted.configureRetryStore(vault("retry-after", initial, directory));
    expect(() =>
      restarted.checkCooldown("https://company.example", now + 59999),
    ).toThrow(restarted.ProtocolError);
    expect(() =>
      restarted.checkCooldown("https://company.example", now + 60000),
    ).not.toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

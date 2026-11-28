import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeScript = {
  src: string;
  async: boolean;
  onload?: () => void;
  onerror?: () => void;
};

describe("Turnstile loading and token waiting", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let scripts: FakeScript[] = [];
  let fakeWindow: Record<string, unknown>;
  let mountTurnstile: typeof import("./turnstile").mountTurnstile;
  let turnstileToken: typeof import("./turnstile").turnstileToken;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    scripts = [];
    fakeWindow = {};
    Object.defineProperty(globalThis, "window", {
      value: fakeWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({ src: "", async: false }),
        head: {
          appendChild: (script: FakeScript) => {
            scripts.push(script);
          },
        },
      },
      configurable: true,
      writable: true,
    });
    ({ mountTurnstile, turnstileToken } = await import("./turnstile"));
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  });

  it("returns undefined immediately when no Turnstile widget is mounted", async () => {
    await expect(turnstileToken()).resolves.toBeUndefined();
  });

  it("waits for widget load and resolves with the token once Turnstile finishes", async () => {
    let callback: ((value: string) => void) | undefined;
    const reset = vi.fn();
    const remove = vi.fn();
    const render = vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => {
      callback = opts.callback as (value: string) => void;
      return "widget-1";
    });

    const cleanup = mountTurnstile({} as HTMLElement, "site-key");
    // Request a token while the script is still loading.
    const pendingToken = turnstileToken();

    expect(scripts).toHaveLength(1);
    fakeWindow.turnstile = { render, reset, remove };
    scripts[0]!.onload?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(1);
    callback?.("fresh-token");
    await expect(pendingToken).resolves.toBe("fresh-token");
    expect(reset).toHaveBeenCalledWith("widget-1");

    cleanup();
    expect(remove).toHaveBeenCalledWith("widget-1");
  });

  it("resets the cached loading promise when onload fires without window.turnstile", async () => {
    const cleanup1 = mountTurnstile({} as HTMLElement, "site-key");
    const waiting1 = turnstileToken();

    expect(scripts).toHaveLength(1);
    // Script loaded, but window.turnstile was not defined.
    scripts[0]!.onload?.();
    await expect(waiting1).resolves.toBeUndefined();
    cleanup1();

    // A subsequent mount retries loading a fresh script instead of reusing a rejected promise.
    const render = vi.fn(() => "widget-2");
    const reset = vi.fn();
    const remove = vi.fn();
    const cleanup2 = mountTurnstile({} as HTMLElement, "site-key");
    expect(scripts).toHaveLength(2);

    fakeWindow.turnstile = { render, reset, remove };
    scripts[1]!.onload?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(1);
    cleanup2();
  });

  it("times out after 8 seconds if widget loading never completes", async () => {
    const cleanup = mountTurnstile({} as HTMLElement, "site-key");
    const pendingToken = turnstileToken();

    await vi.advanceTimersByTimeAsync(8000);
    await expect(pendingToken).resolves.toBeUndefined();

    cleanup();
    // Reject the stalled script so the next test starts clean.
    scripts[0]!.onerror?.();
  });
});

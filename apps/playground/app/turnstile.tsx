"use client";
/**
 * Cloudflare Turnstile for the free model. The widget runs in Managed
 * mode and shows itself only when Cloudflare wants the visitor to
 * interact; each turn asked of the free model takes its current token,
 * which the server verifies once, and the widget then makes the next.
 * The page loads Cloudflare's script only while the free model is chosen.
 */
import { useEffect, useRef } from "react";

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** The action the server checks every token for (`TURNSTILE_ACTION`). */
const ACTION = "chat";

type TurnstileApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widget: string): void;
  remove(widget: string): void;
};
const api = () =>
  (window as typeof window & { turnstile?: TurnstileApi }).turnstile;

let loading: Promise<TurnstileApi> | undefined;
function load() {
  const existing = api();
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    const fail = () => {
      loading = undefined;
      reject(new Error("Turnstile did not load"));
    };
    script.onload = () => {
      const loaded = api();
      if (loaded) resolve(loaded);
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

let widget: string | undefined;
let pending = 0;
let token: string | undefined;
let waiting: Array<(token: string | undefined) => void> = [];
function settle(value: string | undefined) {
  if (value === undefined) {
    const all = waiting;
    waiting = [];
    for (const resolve of all) resolve(undefined);
    return;
  }
  const next = waiting.shift();
  if (next) {
    next(value);
    if (widget) api()?.reset(widget);
  } else {
    token = value;
  }
}

/**
 * The widget's token for one turn, waiting a few seconds when the script
 * or check hasn't finished; none without the widget. The widget is then
 * reset, so the next turn has a token of its own.
 */
export async function turnstileToken(): Promise<string | undefined> {
  if (!widget && !pending) return undefined;
  if (token) {
    const taken = token;
    token = undefined;
    if (widget) api()?.reset(widget);
    return taken;
  }
  return new Promise<string | undefined>((resolve) => {
    const finish = (value: string | undefined) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      const i = waiting.indexOf(finish);
      if (i !== -1) waiting.splice(i, 1);
      resolve(undefined);
    }, 8000);
    waiting.push(finish);
  });
}

/** Mounts one Turnstile widget into `element` and returns its cleanup. */
export function mountTurnstile(element: HTMLElement, siteKey: string) {
  let mine: string | undefined;
  let gone = false;
  let finished = false;
  pending++;
  const done = () => {
    if (finished) return;
    finished = true;
    pending--;
  };
  void load()
    .then((turnstile) => {
      if (gone) return;
      mine = widget = turnstile.render(element, {
        sitekey: siteKey,
        action: ACTION,
        appearance: "interaction-only",
        size: "flexible",
        callback: (value: string) => {
          settle(value);
        },
        "expired-callback": () => {
          token = undefined;
        },
        "error-callback": () => {
          token = undefined;
        },
      });
    })
    // Without the script a turn goes without a token, and the server
    // answers it in demo mode, saying so.
    .catch(() => {})
    .finally(() => {
      done();
      if (!widget && !pending) settle(undefined);
    });
  return () => {
    gone = true;
    done();
    if (mine) {
      api()?.remove(mine);
      if (widget === mine) {
        widget = undefined;
        token = undefined;
      }
    }
    if (!widget && !pending) settle(undefined);
  };
}

export function TurnstileCheck({ siteKey }: { siteKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    return mountTurnstile(box.current, siteKey);
  }, [siteKey]);
  return <div ref={box} className="turnstile-check" />;
}

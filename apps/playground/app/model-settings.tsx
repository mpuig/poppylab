"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  chatModels,
  freeModel,
  needsKey,
  initialModel,
  restoreModel,
  type ModelConfig,
} from "@/lib/model-options";
import { TurnstileCheck } from "./turnstile";
const storageKey = "poppy.model.v1";
/**
 * "Try the protocol demo" lasts for this tab. It is kept apart from the saved
 * settings so it never replaces a saved key, and it survives a change of view,
 * which mounts this component again.
 */
const demoKey = "poppy.model.demo.v1";
function demoChosen() {
  try {
    return sessionStorage.getItem(demoKey) === "1";
  } catch {
    return false;
  }
}
function rememberDemo(chosen: boolean) {
  try {
    if (chosen) sessionStorage.setItem(demoKey, "1");
    else sessionStorage.removeItem(demoKey);
  } catch {
    // Without session storage the choice lasts until the view changes.
  }
}
/** Whether the deployment offers the free model (`/api/model`), or why not. */
type FreeStatus = { available: boolean; siteKey?: string; reason?: string };
const FREE_LINE =
  "A small free model with a daily limit: what you type is sent to Cloudflare Workers AI, and nothing here is real.";
export function ModelSettings({
  onChange,
  disabled,
}: {
  onChange: (config: ModelConfig) => void;
  disabled: boolean;
}) {
  const [config, setConfig] = useState(initialModel),
    // The choice the chat uses, which the form changes only when saved.
    [applied, setApplied] = useState(initialModel),
    [open, setOpen] = useState(needsKey(initialModel.provider)),
    [notice, setNotice] = useState(""),
    [free, setFree] = useState<FreeStatus>({ available: false });
  const [defaults, setDefaults] = useState<
    Record<string, { configured: boolean }>
  >({});
  useEffect(() => {
    let cancelled = false;
    const choose = (next: ModelConfig) => {
      setConfig(next);
      setApplied(next);
      onChange(next);
    };
    void fetch("/api/model")
      .then((r) => r.json())
      .catch(() => ({ providers: {} }))
      .then((data) => {
        if (cancelled) return;
        setDefaults(data.providers ?? {});
        setFree(data.free ?? { available: false });
        if (demoChosen()) {
          choose(initialModel);
          setOpen(false);
          return;
        }
        try {
          const saved = restoreModel(
            JSON.parse(localStorage.getItem(storageKey) ?? "null"),
          );
          if (saved) {
            choose(saved);
            setOpen(
              needsKey(saved.provider) &&
                !saved.apiKey &&
                !data.providers?.[saved.provider]?.configured,
            );
            return;
          }
        } catch {
          setNotice(
            "Browser storage is unavailable. Settings will last for this tab only.",
          );
        }
        const entry = chatModels.find(
          (p) => data.providers?.[p.id]?.configured,
        );
        // A visitor with no key starts with the free model, where it runs.
        if (entry || data.free?.available) {
          choose(
            entry
              ? { provider: entry.id, apiKey: "", model: entry.model }
              : freeModel,
          );
          setOpen(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onChange]);
  const choose = (next: ModelConfig) => {
    setConfig(next);
    setApplied(next);
    onChange(next);
  };
  const definition = chatModels.find((p) => p.id === config.provider)!;
  const server = defaults[config.provider]?.configured;
  const freeNote = (
    <p className="settings-note free-note">
      {FREE_LINE}
      {!free.available && free.reason ? ` ${free.reason}` : ""}
    </p>
  );
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      localStorage.setItem(storageKey, JSON.stringify(config));
      setNotice("");
    } catch {
      setNotice(
        "Not saved: browser storage is unavailable. Settings work for this tab.",
      );
    }
    rememberDemo(false);
    choose(config);
    setOpen(false);
  }
  return (
    <section className="model-settings" aria-label="Model settings">
      <button
        className="model-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={disabled}
      >
        <span>
          {definition.id === "demo"
            ? "Demo mode · guided examples, no key needed"
            : definition.id === "free"
              ? "Free model (limited) · no key needed"
              : `${definition.label} · ${definition.model}${definition.detail ? " · low" : ""}`}
        </span>
        <span>
          {open
            ? "Close"
            : !needsKey(definition.id)
              ? "Use your own model"
              : "Model settings"}
        </span>
      </button>
      {!open && applied.provider === "free" && freeNote}
      {applied.provider === "free" && free.available && free.siteKey && (
        <TurnstileCheck siteKey={free.siteKey} />
      )}
      {open && (
        <form onSubmit={save} className="model-config">
          <div>
            <label htmlFor="provider">Provider</label>
            <select
              id="provider"
              value={config.provider}
              disabled={disabled}
              onChange={(e) => {
                const option = chatModels.find((p) => p.id === e.target.value)!;
                setConfig({
                  provider: option.id,
                  apiKey: "",
                  model: option.model,
                });
              }}
            >
              {chatModels.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.id === "demo"
                    ? "Protocol demo · no model, no key"
                    : p.id === "free"
                      ? "Free model (limited) · no key"
                      : `${p.label} · ${p.model}${p.detail ? " / low" : ""}`}
                </option>
              ))}
            </select>
          </div>
          {needsKey(config.provider) ? (
            <div>
              <label htmlFor="api-key">API key</label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                required={!server}
                value={config.apiKey}
                placeholder={
                  server
                    ? "Using local environment key · enter to override"
                    : "Paste your API key"
                }
                onChange={(e) =>
                  setConfig({ ...config, apiKey: e.target.value })
                }
              />
            </div>
          ) : config.provider === "free" ? (
            freeNote
          ) : (
            <p className="settings-note demo-note">
              No model and no key. Simple keyword rules call the Company&apos;s
              tools and show its raw answers, so you can watch the protocol.
              Proposals still wait for your approval.
            </p>
          )}
          {needsKey(config.provider) && (
            <p className="settings-note">
              Your key is saved in this browser, not encrypted. Use only on a
              trusted device. It passes through this server to your provider,
              never to the Company or model context. Local environment keys stay
              on the server.
            </p>
          )}
          <div className="settings-actions">
            <button
              className="connect-button"
              type="submit"
              disabled={disabled}
            >
              Save model
            </button>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => {
                try {
                  localStorage.removeItem(storageKey);
                } catch {
                  setNotice(
                    "Could not remove saved settings. Clear this site’s browser storage to forget the saved key.",
                  );
                  return;
                }
                rememberDemo(false);
                choose(free.available ? freeModel : initialModel);
                setOpen(false);
                setNotice(
                  free.available
                    ? "Saved settings removed. Back to the free model."
                    : "Saved settings removed. Back to demo mode.",
                );
              }}
            >
              Forget saved settings
            </button>
            {needsKey(config.provider) && (
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => {
                  rememberDemo(true);
                  choose(initialModel);
                  setOpen(false);
                }}
              >
                No key? Try the protocol demo
              </button>
            )}
          </div>
        </form>
      )}
      {notice && (
        <p role="status" className="settings-note">
          {notice}
        </p>
      )}
    </section>
  );
}

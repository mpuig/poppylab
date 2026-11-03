"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  chatModels,
  needsKey,
  initialModel,
  restoreModel,
  type ModelConfig,
} from "@/lib/model-options";
const storageKey = "poppy.model.v1";
export function ModelSettings({
  onChange,
  disabled,
}: {
  onChange: (config: ModelConfig) => void;
  disabled: boolean;
}) {
  const [config, setConfig] = useState(initialModel),
    [open, setOpen] = useState(true),
    [notice, setNotice] = useState("");
  const [defaults, setDefaults] = useState<
    Record<string, { configured: boolean }>
  >({});
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/model")
      .then((r) => r.json())
      .catch(() => ({ providers: {} }))
      .then((data) => {
        if (cancelled) return;
        setDefaults(data.providers ?? {});
        try {
          const saved = restoreModel(
            JSON.parse(localStorage.getItem(storageKey) ?? "null"),
          );
          if (saved) {
            setConfig(saved);
            onChange(saved);
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
        if (entry) {
          const next = { provider: entry.id, apiKey: "", model: entry.model };
          setConfig(next);
          onChange(next);
          setOpen(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onChange]);
  const definition = chatModels.find((p) => p.id === config.provider)!;
  const server = defaults[config.provider]?.configured;
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
    onChange(config);
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
            ? "Protocol demo · no model, no key"
            : `${definition.label} · ${definition.model}${definition.detail ? " · low" : ""}`}
        </span>
        <span>{open ? "Close" : "Model settings"}</span>
      </button>
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
                setConfig(initialModel);
                onChange(initialModel);
                setOpen(true);
                setNotice(
                  "Saved key removed. Add a key or use the local environment configuration.",
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
                  const demo = chatModels.find((p) => p.id === "demo")!;
                  const next = {
                    provider: demo.id,
                    apiKey: "",
                    model: demo.model,
                  };
                  setConfig(next);
                  onChange(next);
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

"use client";
import { useCallback, useEffect, useState } from "react";

type Summary = {
  id: string;
  company: string;
  title?: string;
  created: number;
  active: boolean;
  until: number;
};
const when = (time: number) =>
  new Date(time).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The visitor's conversations, each a link to its own address, and the one
 * action that starts the demo over. A new conversation keeps what earlier
 * ones changed at the Companies; only a reset gives fresh data.
 */
export function ConversationList({
  current,
  onReset,
}: {
  current: string | undefined;
  onReset: () => void;
}) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    void fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => setList(data.conversations ?? []))
      .catch(() => setError("Couldn’t load your conversations. Try again."));
  }, []);
  useEffect(load, [load]);

  async function reset() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-demo" }),
      });
      if (!response.ok) throw new Error();
      setDone(true);
      setConfirming(false);
      onReset();
      load();
    } catch {
      setError("The reset didn’t go through. Nothing changed; try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="conversation-list">
      <div className="list-actions">
        <a className="connect-button" href="/playground">
          New conversation
        </a>
        <span className="quiet">
          Up to 20 are kept, each for seven days from its start.
        </span>
      </div>
      {list === null && !error && <p className="quiet">Loading…</p>}
      {list?.length === 0 && (
        <p className="inspector-empty">
          No conversations yet. Connect a company to start one.
        </p>
      )}
      {!!list?.length && (
        <ul className="conversations">
          {list.map((item) => (
            <li key={item.id}>
              <a
                href={`/playground/${item.id}`}
                aria-current={item.id === current ? "page" : undefined}
              >
                <strong>{item.company}</strong>
                <span>{item.title ?? "No messages yet"}</span>
              </a>
              <span className="conversation-meta">
                {when(item.created)}
                <span className={item.active ? "open" : undefined}>
                  {item.active ? "Open" : "Read-only"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <section className="reset-demo" aria-labelledby="reset-title">
        <h2 id="reset-title">Start the demo over</h2>
        <p>
          A new conversation keeps what earlier ones changed at the companies: a
          moved delivery stays moved. Starting over gives you a fresh copy of
          every company&apos;s test customers the next time you connect, and
          ends the conversations that are open. They stay readable here.
        </p>
        {confirming ? (
          <div className="reset-actions">
            <button
              type="button"
              className="connect-button"
              disabled={working}
              onClick={() => void reset()}
            >
              {working ? "Resetting…" : "Yes, start over"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={working}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="reset-button"
            onClick={() => {
              setDone(false);
              setConfirming(true);
            }}
          >
            Reset demo data
          </button>
        )}
        <p role="status" className="reset-status">
          {done ? "Done. Connect a company to begin with fresh data." : ""}
        </p>
      </section>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { PendingItem } from "@poppy-lab/pap-agent/pending";
import { CompanyMark } from "./company-mark";
import { whenOf } from "../operation-review";

/** One line of the inbox: what waits, and where the page shows it. */
export type InboxItem = PendingItem & {
  /** In the conversation this page shows: the element to bring into view. */
  target?: string | undefined;
};

/** "1 waiting", "3 waiting". */
export const waitingCount = (n: number) => `${n} waiting`;

/**
 * What waits in the visitor's other running conversations, read from
 * `/api/v1/pending` when the page opens, when it shows another
 * conversation, when something here changed (`changed`) and when the
 * window is looked at again. Nothing when the request fails: the inbox
 * then lists this conversation's own.
 */
export function usePendingElsewhere(
  conversation: string | undefined,
  changed: string,
) {
  const [items, setItems] = useState<PendingItem[]>([]);
  useEffect(() => {
    let stale = false;
    const read = () =>
      void fetch("/api/v1/pending", { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((data: { items?: PendingItem[] }) => {
          if (!stale) setItems(Array.isArray(data.items) ? data.items : []);
        })
        .catch(() => {});
    read();
    const look = () => {
      if (document.visibilityState === "visible") read();
    };
    window.addEventListener("focus", look);
    return () => {
      stale = true;
      window.removeEventListener("focus", look);
    };
  }, [conversation, changed]);
  return items.filter((item) => item.conversation !== conversation);
}

/**
 * The inbox's items in order: this conversation's first, as the page
 * holds them, then the others' proposals, each run out ones left out.
 * Iris's questions in another conversation, and a sign-in to do there,
 * are answered only in that conversation and lapse with it: a person who
 * left it for a new one isn't waited for, so they aren't counted here.
 */
export function inboxItems(
  here: readonly InboxItem[],
  elsewhere: readonly PendingItem[],
  now = Date.now(),
): InboxItem[] {
  const live = (item: PendingItem) =>
    !item.expiresAt || Date.parse(item.expiresAt) > now;
  return [
    ...here,
    ...elsewhere.filter((item) => item.kind === "proposal"),
  ].filter(live);
}

/**
 * The count of what waits for the person, in the conversation's heading,
 * shown only when something waits; it opens a compact list of each, with
 * its Company, what it is and when it runs out. Choosing one takes the
 * person to it. A popover under the count on a wide screen, a sheet at
 * the window's foot on a phone (playground.css); Escape, a click outside
 * or leaving it with Tab closes it, and the focus goes back to the count.
 */
export function PendingInbox({
  items,
  onChoose,
  now = Date.now(),
}: {
  items: readonly InboxItem[];
  onChoose: (item: InboxItem) => void;
  now?: number;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  // Under the count, at its right edge, wherever the page has scrolled.
  const [place, setPlace] = useState<{ top: number; right: number }>();
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = toggle.current?.getBoundingClientRect();
      if (rect)
        setPlace({
          top: rect.bottom + 6,
          right: Math.max(16, window.innerWidth - rect.right),
        });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (focusBack = true) => {
    setOpen(false);
    if (focusBack) toggle.current?.focus();
  };
  // Opened, the first item has the focus.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("li button")?.focus();
  }, [open]);
  // A click outside closes it, and leaves the focus where it went.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !toggle.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  // Nothing waits any more: nothing to show, nothing open.
  useEffect(() => {
    if (!items.length) setOpen(false);
  }, [items.length]);
  if (!items.length) return null;
  return (
    <div className="pending">
      <button
        ref={toggle}
        type="button"
        className="pending-toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${waitingCount(items.length)} for you`}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="pending-dot" aria-hidden="true" />
        {waitingCount(items.length)}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className="pending-inbox"
          style={place}
          role="dialog"
          aria-modal="false"
          aria-label="Waiting for you"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (
              next &&
              !panel.current?.contains(next) &&
              !toggle.current?.contains(next)
            )
              setOpen(false);
          }}
        >
          <div className="pending-head">
            <h3>Waiting for you</h3>
            <button
              type="button"
              className="text-button"
              onClick={() => close()}
            >
              Close
            </button>
          </div>
          <ul>
            {items.map((item, index) => (
              <li
                key={`${item.conversation} ${item.kind} ${item.company?.origin ?? ""} ${item.proposal?.id ?? index}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    close(false);
                    onChoose(item);
                  }}
                >
                  <span className="pending-company">
                    {item.company && (
                      <CompanyMark origin={item.company.origin} />
                    )}
                    {item.company?.name ?? "Iris"}
                  </span>
                  <span className="pending-text">{item.text}</span>
                  <small>
                    {[
                      item.expiresAt
                        ? `Expires ${whenOf(Date.parse(item.expiresAt), now)}`
                        : "",
                      item.target ? "" : "In another conversation",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Until you answer"}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

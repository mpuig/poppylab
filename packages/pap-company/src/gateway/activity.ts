/**
 * What a customer's agents asked for, as a Company's website shows it: the
 * proposals that wait for an approval, from the gate's operation records,
 * and the requests the gate finished (applied, declined by the Company, or
 * refused because the account had changed), with who approved each and
 * when.
 *
 * The gate forgets an operation once its approved revision expires, about
 * ten minutes on (Operations §7). The change it made stays, so the record
 * of who approved it is kept here, apart from the operation records: what
 * was asked and what came of it in the Company's words, and neither the
 * terms nor the first response.
 * The gate never reads an entry, so one can't count toward its caps, answer
 * a retry or make an old approval work again.
 */
import type { Finished, OperationRecord } from "../approvals.ts";
import { when } from "./feedback.ts";

/** A finished request, as kept with its tenant. */
export type ActivityEntry = Finished;
/** One row of a website's agent activity. */
export type ActivityItem = {
  id: string;
  /** `proposed` waits for an approval; `expired` ran out without one. */
  state: "proposed" | "expired" | Finished["outcome"];
  summary: string;
  /** What the action answered, or why the Company declined. */
  result?: string;
  approver?: "user" | "agent";
  /** When it finished or, for a proposal, when it ends (RFC 3339). */
  at: string;
  /** `at` as "Nov 25, 09:14 UTC", the same for every viewer. */
  when: string;
};

/**
 * Bounds: the newest 20 finished requests of each account, for 90 days, and
 * 200 in a tenant whatever its accounts. At most 5 of an account's 20 are
 * requests that changed nothing, so a run of refusals can't push out the
 * record of who approved a change. Waiting proposals are the gate's to
 * bound; a website lists the newest 10.
 */
const PER_ACCOUNT = 20,
  UNCHANGED = 5,
  PER_TENANT = 200,
  KEEP_MS = 90 * 86400000,
  PROPOSALS = 10;
/** A summary or result is kept as the Company wrote it, up to this length. */
const TEXT = 1000;
const text = (value: string) =>
  value.length > TEXT ? `${value.slice(0, TEXT - 1)}…` : value;

const fresh = (entry: ActivityEntry, now: number) =>
  now - Date.parse(entry.at) <= KEEP_MS;

/** Adds a finished request to a tenant's kept activity, within the bounds. */
export function keepActivity(
  kept: ActivityEntry[],
  entry: ActivityEntry,
  now = Date.now(),
) {
  for (let i = kept.length - 1; i >= 0; i--) {
    const old = kept[i]!;
    // An operation that was not applied is told once: its last answer.
    const retold =
      entry.outcome !== "succeeded" &&
      old.outcome !== "succeeded" &&
      old.id === entry.id;
    if (!fresh(old, now) || retold) kept.splice(i, 1);
  }
  kept.push({
    ...entry,
    summary: text(entry.summary),
    ...(entry.result ? { result: text(entry.result) } : {}),
  });
  /** Drops the oldest of `among` beyond `max`. */
  const bound = (max: number, among: (e: ActivityEntry) => boolean) => {
    const held = kept.filter(among);
    for (const old of held.slice(0, Math.max(0, held.length - max)))
      kept.splice(kept.indexOf(old), 1);
  };
  const mine = (e: ActivityEntry) => e.account === entry.account;
  bound(UNCHANGED, (e) => mine(e) && e.outcome !== "succeeded");
  bound(PER_ACCOUNT, mine);
  bound(PER_TENANT, () => true);
}

/**
 * For a tenant stored before activity was kept: what the gate still
 * remembers having performed, oldest first.
 */
export function activityOf(
  operations: Readonly<Record<string, OperationRecord>>,
): ActivityEntry[] {
  const kept: ActivityEntry[] = [];
  const performed = Object.entries(operations)
    .flatMap(([id, r]) => (r.performed ? [{ id, r, done: r.performed }] : []))
    .sort((a, b) => Date.parse(a.done.at) - Date.parse(b.done.at));
  for (const { id, r, done } of performed)
    keepActivity(kept, {
      id,
      account: r.account,
      outcome: "succeeded",
      summary:
        r.revisions.find((v) => v.revision === done.revision)?.summary ??
        done.body.summary,
      result: done.body.summary,
      approver: done.approver,
      at: done.at,
    });
  return kept;
}

/** An account's agent activity for a website, newest first. */
export function agentActivity(
  account: string,
  operations: Readonly<Record<string, OperationRecord>>,
  kept: readonly ActivityEntry[],
  now = Date.now(),
): ActivityItem[] {
  const proposals = Object.entries(operations)
    .filter(
      ([, r]) => r.account === account && !r.performed && r.revisions.length,
    )
    .slice(-PROPOSALS)
    .reverse()
    .map(([id, r]): ActivityItem => {
      const latest = r.revisions.at(-1)!;
      return {
        id,
        state: Date.parse(latest.expires_at) < now ? "expired" : "proposed",
        summary: latest.summary,
        at: latest.expires_at,
        when: when(latest.expires_at),
      };
    });
  const finished = kept
    .filter((e) => e.account === account && fresh(e, now))
    .reverse()
    .map((entry): ActivityItem => ({
      id: entry.id,
      state: entry.outcome,
      summary: entry.summary,
      ...(entry.result ? { result: entry.result } : {}),
      approver: entry.approver,
      at: entry.at,
      when: when(entry.at),
    }));
  return [...proposals, ...finished];
}

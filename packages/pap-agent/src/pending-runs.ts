/**
 * What waits for the User in their stored conversations (`pending.ts`),
 * for `GET /api/v1/pending`: the running ones only, the newest first.
 */
import { RESUME_MS } from "./chat-answers";
import { companyRef, originOf } from "./connections";
import { pendingItems, type OpenAsk, type PendingItem } from "./pending";
import { storedConversations } from "./runs";
import type { Run } from "./runtime";

/** The question a run keeps open, as `pendingItems` reads it. */
export function openAsk(run: Run, now = Date.now()): OpenAsk | undefined {
  const asking = run.asking;
  if (asking && "signin" in asking) return { signin: asking.signin };
  if (asking && "resume" in asking) {
    const at = run.connections.find((c) => originOf(c) === asking.resume)
      ?.resume?.at;
    // Without the request that waited, there is nothing to go on with.
    if (at === undefined || at + RESUME_MS <= now) return undefined;
    return { resume: asking.resume, until: at + RESUME_MS };
  }
  if (asking && "invitation" in asking)
    return { invitation: asking.invitation };
  if (asking && "signout" in asking) return { signout: asking.signout };
  if (run.removing) return { removing: run.removing.remove };
  if (run.waiting) return { which: true };
  return undefined;
}

/** What waits for the User in one stored conversation: none once it ended. */
export function pendingOf(
  id: string,
  run: Run,
  now = Date.now(),
): PendingItem[] {
  if (run.archived || run.expires <= now) return [];
  return pendingItems(
    id,
    run.connections.map((c) => ({
      company: companyRef(run, originOf(c)),
      operations: Object.values(c.operations ?? {}),
      ...(c.auth ? { signingIn: c.auth.expires } : {}),
      ...(c.accountToken && c.accountUnavailable ? { accessLost: true } : {}),
    })),
    openAsk(run, now),
    now,
  );
}

/** Everything that waits for this user, in each running conversation. */
export async function pendingFor(user: string, now = Date.now()) {
  const stored = await storedConversations(user);
  return stored
    .sort((a, b) => (b.run.created ?? 0) - (a.run.created ?? 0))
    .flatMap(({ id, run }) => pendingOf(id, run, now));
}

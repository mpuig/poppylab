/**
 * One Durable Object per visitor (named by the visitor cookie's hash), plus
 * `global` and `ip:<hash>` objects for budgets. Each method runs atomically:
 * Durable Object storage calls don't let other requests interleave.
 *
 * Agent accounts (`PoppyAccount`) are the same object with a longer idle
 * time: a passkey on someone's phone outlives a week away.
 *
 * Each object is deleted by its alarm, set for the last moment anything
 * in it is still worth keeping: an idle time after a value was written,
 * a value's own `expires` when it says when it is worth nothing (a
 * passkey ceremony, a link code), and a counter's window. An object left
 * with nothing in it has no alarm, so it goes at once.
 */
import { DurableObject } from "cloudflare:workers";

type Versioned = { value: unknown; version: number };
/** Idle visitors vanish a little after their 7-day cookie. */
const IDLE_MS = 8 * 86400000;

export class PoppyVisitor extends DurableObject {
  protected idleMs = IDLE_MS;
  /** Keeps the object at least until `time`; never brings its end closer. */
  private async keepUntil(time: number) {
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm < time) await this.ctx.storage.setAlarm(time);
  }
  async getEntry(key: string) {
    return this.ctx.storage.get<Versioned>(`e:${key}`);
  }
  async putEntry(
    key: string,
    value: unknown,
    expected: number | null,
    expires?: number,
  ) {
    const current = await this.ctx.storage.get<Versioned>(`e:${key}`);
    if ((current?.version ?? null) !== expected) return false;
    await this.ctx.storage.put(`e:${key}`, {
      value,
      version: (current?.version ?? 0) + 1,
    });
    await this.keepUntil(expires ?? Date.now() + this.idleMs);
    return true;
  }
  async removeEntry(key: string) {
    await this.ctx.storage.delete(`e:${key}`);
    if (!(await this.ctx.storage.list({ limit: 1 })).size)
      await this.ctx.storage.deleteAlarm();
  }
  async listEntries(prefix: string) {
    return [
      ...(await this.ctx.storage.list<Versioned>({ prefix: `e:${prefix}` })),
    ].map(([k, v]) => [k.slice(2), v] as [string, Versioned]);
  }
  async count(key: string, windowMs: number) {
    const now = Date.now();
    const c = await this.ctx.storage.get<{ n: number; until: number }>(
      `c:${key}`,
    );
    const next =
      !c || c.until <= now
        ? { n: 1, until: now + windowMs }
        : { ...c, n: c.n + 1 };
    await this.ctx.storage.put(`c:${key}`, next);
    // A count is worth nothing once its window has passed.
    await this.keepUntil(next.until);
    return next.n;
  }
  override async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

/** An account no device has used for a year goes, passkeys and sessions. */
const ACCOUNT_IDLE_MS = 365 * 86400000;

/**
 * One Durable Object per agent account (`account:<id>`), and one for each
 * passkey ceremony, link code and app sign-in link under way, which are
 * taken once and go when they are taken or run out, minutes on.
 */
export class PoppyAccount extends PoppyVisitor {
  protected override idleMs = ACCOUNT_IDLE_MS;
}

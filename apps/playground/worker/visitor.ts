/**
 * One Durable Object per visitor (named by the visitor cookie's hash), plus
 * `global` and `ip:<hash>` objects for budgets. Each method runs atomically:
 * Durable Object storage calls don't let other requests interleave.
 *
 * Agent accounts (`PoppyAccount`) are the same object with a longer idle
 * time: a passkey on someone's phone outlives a week away.
 */
import { DurableObject } from "cloudflare:workers";

type Versioned = { value: unknown; version: number };
/** Idle visitors vanish a little after their 7-day cookie. */
const IDLE_MS = 8 * 86400000;

export class PoppyVisitor extends DurableObject {
  protected idleMs = IDLE_MS;
  private async touch() {
    await this.ctx.storage.setAlarm(Date.now() + this.idleMs);
  }
  async getEntry(key: string) {
    return this.ctx.storage.get<Versioned>(`e:${key}`);
  }
  async putEntry(key: string, value: unknown, expected: number | null) {
    const current = await this.ctx.storage.get<Versioned>(`e:${key}`);
    if ((current?.version ?? null) !== expected) return false;
    await this.ctx.storage.put(`e:${key}`, {
      value,
      version: (current?.version ?? 0) + 1,
    });
    await this.touch();
    return true;
  }
  async removeEntry(key: string) {
    await this.ctx.storage.delete(`e:${key}`);
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
    await this.touch();
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
 * passkey ceremony and link code under way, which are taken once.
 */
export class PoppyAccount extends PoppyVisitor {
  protected override idleMs = ACCOUNT_IDLE_MS;
}

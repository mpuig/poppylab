import { describe, expect, it, vi } from "vitest";
import { removePasskeyAndRefresh } from "./account-panel";
import type { AccountView } from "./agent-account";

const account: AccountView = {
  id: "acct_1",
  label: "Home",
  created: 1_700_000_000_000,
  passkeys: [
    {
      id: "pk_other",
      name: "Safari on iPhone",
      created: 1_700_000_000_000,
      synced: true,
    },
  ],
  channels: [],
  session: "sess_1",
};

describe("removePasskeyAndRefresh", () => {
  it("reports signed-out state immediately when removing the current device's passkey", async () => {
    const onChange = vi.fn();
    const refreshSessions = vi.fn();
    const remove = vi.fn().mockResolvedValue(account);
    const read = vi.fn().mockResolvedValue(null);

    await removePasskeyAndRefresh("pk_current", onChange, refreshSessions, {
      remove,
      read,
    });

    expect(remove).toHaveBeenCalledWith("pk_current");
    expect(read).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(refreshSessions).not.toHaveBeenCalled();
  });

  it("updates the account and refreshes sessions when another passkey is removed", async () => {
    const onChange = vi.fn();
    const refreshSessions = vi.fn();
    const fresh: AccountView = { ...account, unclaimed: 1 };
    const remove = vi.fn().mockResolvedValue(account);
    const read = vi.fn().mockResolvedValue(fresh);

    await removePasskeyAndRefresh("pk_old", onChange, refreshSessions, {
      remove,
      read,
    });

    expect(remove).toHaveBeenCalledWith("pk_old");
    expect(read).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(fresh);
    expect(refreshSessions).toHaveBeenCalledTimes(1);
  });

  it("falls back to the remove response when rereading the account fails transiently", async () => {
    const onChange = vi.fn();
    const refreshSessions = vi.fn();
    const remove = vi.fn().mockResolvedValue(account);
    const read = vi.fn().mockRejectedValue(new Error("offline"));

    await removePasskeyAndRefresh("pk_old", onChange, refreshSessions, {
      remove,
      read,
    });

    expect(onChange).toHaveBeenCalledWith(account);
    expect(refreshSessions).toHaveBeenCalledTimes(1);
  });

  it("propagates removal failures without mutating account or sessions", async () => {
    const onChange = vi.fn();
    const refreshSessions = vi.fn();
    const remove = vi.fn().mockRejectedValue(new Error("last_passkey"));
    const read = vi.fn();

    await expect(
      removePasskeyAndRefresh("pk_only", onChange, refreshSessions, {
        remove,
        read,
      }),
    ).rejects.toThrow("last_passkey");

    expect(read).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(refreshSessions).not.toHaveBeenCalled();
  });
});

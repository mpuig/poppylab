import { beforeEach, expect, it } from "vitest";
import { channelCaller, channelUser } from "./identity";
import { configureBackend, memoryBackend } from "./runs";

beforeEach(() => configureBackend(memoryBackend()));

it("maps a channel's user to one agent user, and never two channels' users to one", async () => {
  const first = await channelUser("telegram", "chat-42");
  expect(await channelUser("telegram", "chat-42")).toBe(first);
  expect(await channelUser("telegram", "chat-43")).not.toBe(first);
  expect(await channelUser("whatsapp", "chat-42")).not.toBe(first);
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

it("makes a Caller the channel vouches for", async () => {
  const user = await channelUser("telegram", "chat-42");
  const bound = new Set<string>();
  const caller = channelCaller({
    user,
    origin: "https://agent.example",
    signIns: {
      bind: (state) => void bound.add(state),
      holds: (state) => bound.has(state),
      release: (state) => void bound.delete(state),
    },
  });
  expect(caller.user(true)).toBe(user);
  expect(caller).toMatchObject({ authentic: true, localDev: false, ip: null });
});

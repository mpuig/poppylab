/**
 * The agent's question once a sign-in completes: "You're signed in at …
 * Shall I go on with …?". It is about that sign-in, so it goes when the
 * sign-in does: signed out there, nothing waits to go on, and the
 * question no longer shows.
 */
import { describe, expect, it } from "vitest";
import { signedOutLocally } from "./account-sign-in";
import { askToResume } from "./chat-answers";
import { connected } from "./company-fixture";
import { shownTranscript } from "./transcript";
import type { Run } from "./runtime";

const shop = "https://shop.example";

function signedIn(language?: Run["language"]): Run {
  const connection = {
    ...connected(shop, "Juniper Market", "poppy:read"),
    resume: { asked: "my deliveries", access: "read" as const, at: Date.now() },
  };
  return {
    expires: Date.now() + 60000,
    busy: false,
    calls: 0,
    connections: [connection],
    history: [],
    transcript: [{ role: "user", content: "my deliveries", signedOut: true }],
    ...(language ? { language } : {}),
  };
}

describe("the question to go on after a sign-in", () => {
  it("asks once the sign-in completes, in the conversation's language", () => {
    const run = signedIn();
    const asked = askToResume(run, run.connections[0]!)!;
    expect(asked.text).toBe(
      "You're signed in at Juniper Market. Shall I go on with “my deliveries”?",
    );
    expect(asked.choices).toEqual([
      { label: "Yes, go on", answer: { resume: shop } },
    ]);
    expect(run.asking).toEqual({ resume: shop });
    expect(shownTranscript(run).at(-1)).toMatchObject({
      content: asked.text,
      choices: asked.choices,
    });
    const spanish = signedIn("es");
    expect(askToResume(spanish, spanish.connections[0]!)!).toMatchObject({
      text: "Ya has iniciado sesión en Juniper Market. ¿Sigo con «my deliveries»?",
      choices: [{ label: "Sí, sigue", answer: { resume: shop } }],
    });
  });

  it("quotes a Spanish question whole, its closing mark too", () => {
    const run = signedIn("es");
    run.connections[0]!.resume!.asked = "Hola, ¿cuándo llega mi pedido?";
    expect(askToResume(run, run.connections[0]!)!.text).toBe(
      "Ya has iniciado sesión en Juniper Market. ¿Sigo con «Hola, ¿cuándo llega mi pedido?»?",
    );
  });

  it("goes once the User signs out there: nothing waits, and it no longer shows", () => {
    const run = signedIn();
    const asked = askToResume(run, run.connections[0]!)!;
    signedOutLocally(run, run.connections[0]!);
    expect(run.asking).toBeUndefined();
    expect(run.connections[0]!.resume).toBeUndefined();
    const shown = shownTranscript(run).map((entry) => entry.content);
    expect(shown).not.toContain(asked.text);
    expect(JSON.stringify(shownTranscript(run))).not.toContain("resume");
  });
});

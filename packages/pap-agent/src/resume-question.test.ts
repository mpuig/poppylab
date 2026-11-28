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
import { recordAsked, shownTranscript } from "./transcript";
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

  it("asks once per request: a newer question about it takes the older one's place", () => {
    const run = signedIn();
    const connection = run.connections[0]!;
    const first = askToResume(run, connection)!;
    // A change permission given before the User answered: the same
    // request is asked about again, after the consent.
    recordAsked(run, connection, [shop], { text: "Change permission given." });
    const again = askToResume(run, connection)!;
    expect(again.text).toBe(first.text);
    const shown = shownTranscript(run);
    expect(shown.filter((entry) => entry.content === first.text)).toHaveLength(
      1,
    );
    expect(shown.at(-1)).toMatchObject({
      content: again.text,
      choices: again.choices,
    });
    expect(shown.some((entry) => entry.noLongerAsked)).toBe(false);
  });

  it("folds an older question about another request to a line saying it is no longer asked", () => {
    const run = signedIn();
    const connection = run.connections[0]!;
    const first = askToResume(run, connection)!;
    connection.resume = {
      asked: "Show my orders",
      access: "read",
      at: Date.now(),
    };
    const next = askToResume(run, connection)!;
    const shown = shownTranscript(run);
    expect(shown.map((entry) => entry.content)).not.toContain(first.text);
    const folded = shown.find((entry) => entry.noLongerAsked)!;
    expect(folded).toMatchObject({
      role: "assistant",
      content: "I'm no longer asking whether to go on with “my deliveries”.",
    });
    expect(folded.choices).toBeUndefined();
    expect(shown.at(-1)).toMatchObject({
      content: next.text,
      choices: next.choices,
    });
    // In the conversation's language.
    const spanish = signedIn("es");
    askToResume(spanish, spanish.connections[0]!);
    spanish.connections[0]!.resume = {
      asked: "otra cosa",
      access: "read",
      at: Date.now(),
    };
    askToResume(spanish, spanish.connections[0]!);
    expect(
      shownTranscript(spanish).find((entry) => entry.noLongerAsked)?.content,
    ).toBe("Ya no pregunto si sigo con «my deliveries».");
  });

  it("loses its button once answered, and stays as it was asked", () => {
    const run = signedIn();
    const connection = run.connections[0]!;
    const asked = askToResume(run, connection)!;
    // "Yes, go on": the request goes, and its answer follows.
    delete connection.resume;
    recordAsked(run, connection, [shop], {
      said: "Yes, go on",
      text: "Your delivery is on Thursday.",
    });
    const entry = shownTranscript(run).find((e) => e.content === asked.text)!;
    expect(entry.choices).toBeUndefined();
    expect(entry.noLongerAsked).toBeUndefined();
    // Asked again later about the same request: the answered one stays.
    connection.resume = {
      asked: "my deliveries",
      access: "read",
      at: Date.now(),
    };
    askToResume(run, connection);
    const shown = shownTranscript(run);
    expect(shown.filter((e) => e.content === asked.text)).toHaveLength(2);
    expect(shown.some((e) => e.noLongerAsked)).toBe(false);
  });

  it("folds once the request no longer waits: it ran out, or went", () => {
    const run = signedIn();
    const connection = run.connections[0]!;
    const asked = askToResume(run, connection)!;
    expect(shownTranscript(run).at(-1)?.choices).toEqual(asked.choices);
    // Half an hour later the request no longer goes on.
    const later = Date.now() + 31 * 60000;
    const expired = shownTranscript(run, later).at(-1)!;
    expect(expired).toMatchObject({
      noLongerAsked: true,
      content: "I'm no longer asking whether to go on with “my deliveries”.",
    });
    expect(expired.choices).toBeUndefined();
    delete connection.resume;
    expect(shownTranscript(run).at(-1)?.noLongerAsked).toBe(true);
  });
});

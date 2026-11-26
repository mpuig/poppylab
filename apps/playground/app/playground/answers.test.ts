import { describe, expect, it } from "vitest";
import { keptLines, linesFor, shownCompanies, turnMessages } from "./answers";

const lantern = { origin: "https://lantern.example", name: "Lantern" };
const harborline = { origin: "https://harbor.example", name: "Harborline" };

describe("what a chat answer adds to the conversation", () => {
  it("shows Iris's own line first, then the Company's content and its answer", () => {
    const messages = turnMessages({
      text: "Protocol demo (no LLM). Dishes.",
      mode: "demo",
      from: lantern,
      before: "Connected to Lantern.",
      trace: ["GET /api/menu · Poppy Session"],
      company: [
        { author: "Lantern · automated agent", text: "Hi", from: lantern },
      ],
    });
    expect(messages.map((m) => [m.role, m.from?.name])).toEqual([
      ["Iris", undefined],
      ["Company", "Lantern"],
      ["Demo", "Lantern"],
    ]);
    expect(messages[2]!.steps).toHaveLength(1);
  });

  it("keeps Iris's own answer apart from any Company, with its buttons", () => {
    const choices = [
      { label: "Lantern", answer: { company: lantern.origin } },
      { label: "Harborline", answer: { company: harborline.origin } },
    ];
    const [message] = turnMessages({
      text: "Which company is this for?",
      mode: "iris",
      choices,
      trace: ["Discovery"],
    });
    expect(message).toEqual({
      role: "Iris",
      text: "Which company is this for?",
      choices,
    });
  });

  it("says nothing of its own in a Direct Conversation, unless something changed", () => {
    expect(
      turnMessages({
        text: "",
        mode: "direct",
        from: lantern,
        company: [{ author: "Lantern · Ana", text: "Hello", direct: true }],
      }),
    ).toEqual([
      {
        role: "Company",
        author: "Lantern · Ana",
        text: "Hello",
        direct: true,
        from: lantern,
      },
    ]);
  });
});

describe("the Inspector's lines", () => {
  it("names the Company each line was written for", () => {
    const [line] = linesFor(["GET /api/menu?x=1 · Poppy Session"], lantern, 5);
    expect(line).toMatchObject({ at: 5, url: "/api/menu", from: lantern });
    expect(
      keptLines([
        { at: 1, text: "Connected", from: harborline },
        { at: 2, text: "Old line" },
      ]).map((l) => l.from?.name),
    ).toEqual(["Harborline", undefined]);
    expect(keptLines(undefined)).toEqual([]);
  });

  it("counts a Company once, connected or removed", () => {
    expect(shownCompanies([lantern], [lantern])).toBe(1);
    expect(shownCompanies([lantern], [harborline])).toBe(2);
  });
});

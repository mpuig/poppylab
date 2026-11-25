import { describe, expect, it } from "vitest";
import { directState, directView } from "./direct-state";

const conversation = { endpoint: "https://c.example/agent", seen: [] };

describe("Direct Conversation state for the page (§8.10)", () => {
  it("says nothing is open before there is a conversation", () => {
    expect(directState({})).toEqual({
      direct: false,
      conversation: false,
      invitation: null,
    });
  });

  it("reports an open Direct Conversation, and not a closed one", () => {
    const open = { ...conversation, id: "c1", direct: { id: "d1", seen: [] } };
    expect(directState({ conversation: open })).toMatchObject({
      direct: true,
      conversation: true,
    });
    expect(
      directState({
        conversation: { ...open, direct: { ...open.direct, closed: true } },
      }).direct,
    ).toBe(false);
  });

  it("reports an invitation with its reason, or an empty one", () => {
    const invited = (reason?: string) =>
      directState({
        conversation: {
          ...conversation,
          id: "c1",
          invitation: { event: "e1", ...(reason ? { reason } : {}) },
        },
      }).invitation;
    expect(invited("About your refund")).toBe("About your refund");
    expect(invited()).toBe("");
  });

  it("gives the page the same state after a reload as after a chat answer", () => {
    const state = directState({
      conversation: {
        ...conversation,
        id: "c1",
        direct: { id: "d1", seen: [] },
      },
    });
    // The words the User types next go to the Company, not to Iris.
    expect(directView(state)).toEqual({
      direct: true,
      invitation: null,
      canTalkDirectly: true,
    });
    // A chat answer has the fields beside its others.
    expect(directView({ text: "", ...state })).toEqual(directView(state));
  });

  it("clears everything when there is nothing to read", () => {
    const closed = { direct: false, invitation: null, canTalkDirectly: false };
    expect(directView()).toEqual(closed);
    expect(directView(null)).toEqual(closed);
    expect(directView({ invitation: 3 })).toEqual(closed);
  });
});

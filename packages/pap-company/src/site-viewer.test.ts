import { expect, it } from "vitest";
import {
  agentBrowserNotice,
  agentBrowserState,
  siteViewer,
  viewerSees,
} from "./site-viewer.ts";

const parts = [
  { name: "Orders", scope: "orders:read" },
  { name: "Cards", scope: "cards:read" },
];

it("serves the join's account before the browser's own login, with the token's scopes", () => {
  const viewer = siteViewer(
    { account: "elena", scopes: ["orders:read"], resources: ["r1"] },
    { account: "tomas" },
  )!;
  expect(viewer).toEqual({
    account: "elena",
    readOnly: true,
    agent: { scopes: ["orders:read"], resources: ["r1"] },
  });
  expect(viewerSees(viewer, "orders:read")).toBe(true);
  expect(viewerSees(viewer, "cards:read")).toBe(false);
  expect(agentBrowserState(viewer, parts)).toEqual({
    browser: { read_only: true, not_shown: ["cards:read"] },
  });
  // §6: the page names what it doesn't show, with the scope to ask for.
  expect(agentBrowserNotice(viewer, parts)).toEqual([
    "This browser belongs to an agent's session. It is signed in through the agent and shows what you allowed the agent to read. Nothing can be changed here: changes are made through the agent and wait for your approval there.",
    "Not shown, because the agent's permission doesn't cover it: Cards (cards:read).",
    "Connected agents and their activity are shown only in your own browser.",
  ]);
});

it("serves a browser's own login in full, read only while it is a Session's", () => {
  // No join: the customer's own browser.
  const own = siteViewer(undefined, { account: "tomas" })!;
  expect(own).toEqual({ account: "tomas", readOnly: false });
  expect(viewerSees(own, "cards:read")).toBe(true);
  expect(agentBrowserState(own, parts)).toEqual({});
  // Joined and signed out, or its sign-in ended: its own login, if any.
  const joined = siteViewer({ scopes: [] }, { account: "tomas" })!;
  expect(joined).toEqual({ account: "tomas", readOnly: true });
  expect(viewerSees(joined, "cards:read")).toBe(true);
  expect(agentBrowserNotice(joined, parts)).toEqual([
    "This browser belongs to an agent's session. Nothing can be changed here: changes are made through the agent and wait for your approval there.",
  ]);
  expect(siteViewer({ scopes: [] }, undefined)).toBeUndefined();
  expect(siteViewer(undefined, undefined)).toBeUndefined();
});

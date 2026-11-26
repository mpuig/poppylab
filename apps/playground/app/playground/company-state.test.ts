import { describe, expect, it } from "vitest";
import { harborlineUrl, lanternUrl, northwindUrl } from "./companies";
import {
  afterTurn,
  companiesFrom,
  companyFromView,
  inFocus,
  notConnected,
  patchCompany,
  removalLoss,
  signedOut,
  stateWords,
  type ConnectionView,
  type Operation,
} from "./company-state";

const lantern = new URL(lanternUrl).origin;
const harborline = new URL(harborlineUrl).origin;
const view = (origin: string, more: Partial<ConnectionView> = {}) => ({
  origin,
  name: origin === lantern ? "Lantern Noodle Bar" : "Harborline Bank",
  ...more,
});
const proposal = (id: string, minutes = 5): Operation => ({
  operation_id: id,
  revision: "1",
  state: "proposed",
  expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
});

describe("the conversation's Companies as the page holds them", () => {
  it("keeps each Company's own state, in the order the server lists them", () => {
    const companies = companiesFrom([
      view(lantern, { signedIn: true, scopes: "orders:read" }),
      view(harborline, { operations: [proposal("op_1")] }),
    ]);
    expect(companies.map((c) => [c.name, c.signedIn, c.scopes])).toEqual([
      ["Lantern Noodle Bar", true, "orders:read"],
      ["Harborline Bank", false, ""],
    ]);
    expect(companies[1]!.operations).toHaveLength(1);
    expect(companies[0]!.operations).toEqual([]);
  });

  it("keeps a consent tab open at one Company until a sign-in completes there", () => {
    const before = [
      {
        ...companyFromView(view(lantern)),
        signingIn: { baseline: 1, since: 0 },
      },
      {
        ...companyFromView(view(harborline)),
        signingIn: { baseline: 0, since: 0 },
      },
    ];
    // Harborline's sign-in completed; Lantern's is still under way.
    const after = companiesFrom(
      [
        view(lantern, { authPending: true, consentVersion: 1 }),
        view(harborline, { signedIn: true, consentVersion: 1 }),
      ],
      before,
    );
    expect(after[0]!.signingIn).toEqual({ baseline: 1, since: 0 });
    expect(after[1]!.signingIn).toBeUndefined();
    expect(stateWords(after[0]!)).toBe("Sign-in under way");
  });

  it("keeps a grant's record only while the grant is the same one", () => {
    const before = [
      {
        ...companyFromView(
          view(harborline, { signedIn: true, fdxConsent: "c1" }),
        ),
        grantRecord: { id: "c1", status: "ACTIVE" },
      },
    ];
    expect(
      companiesFrom(
        [view(harborline, { signedIn: true, fdxConsent: "c1" })],
        before,
      )[0]!.grantRecord,
    ).toEqual({ id: "c1", status: "ACTIVE" });
    expect(
      companiesFrom(
        [view(harborline, { signedIn: true, fdxConsent: "c2" })],
        before,
      )[0]!.grantRecord,
    ).toBeUndefined();
  });

  it("changes only the Company a turn was with", () => {
    const companies = companiesFrom([view(lantern), view(harborline)]);
    const next = patchCompany(companies, harborline, (c) =>
      afterTurn(c, {
        signedIn: true,
        scopes: "accounts:read",
        operations: [proposal("op_2")],
      }),
    );
    expect(next[0]).toBe(companies[0]);
    expect(next[1]!.signedIn).toBe(true);
    expect(next[1]!.operations.map((op) => op.operation_id)).toEqual(["op_2"]);
  });

  it("forgets a Company's sign-in, proposals and grant at sign-out there", () => {
    const company = {
      ...companyFromView(
        view(harborline, {
          signedIn: true,
          scopes: "accounts:read",
          fdxConsent: "c1",
          operations: [proposal("op_1")],
        }),
      ),
      grantRecord: { id: "c1" },
    };
    const out = signedOut(company);
    expect(out.signedIn).toBe(false);
    expect(out.operations).toEqual([]);
    expect(out.grantId).toBeUndefined();
    expect(out.grantRecord).toBeUndefined();
    expect(stateWords(out)).toBe("Public access");
  });

  it("says in plain words how Iris may use each Company", () => {
    expect(stateWords(companyFromView(view(lantern)))).toBe("Public access");
    expect(
      stateWords(
        companyFromView(
          view(lantern, { recovery: { error: "The Company took it back." } }),
        ),
      ),
    ).toBe("Access lost");
  });

  it("asks before a removal only when it takes something with it", () => {
    expect(removalLoss(companyFromView(view(lantern)))).toEqual([]);
    expect(
      removalLoss(
        companyFromView(
          view(lantern, { signedIn: true, operations: [proposal("op_1")] }),
        ),
      ),
    ).toEqual([
      "That revokes the access you gave Iris at Lantern Noodle Bar, and what Iris read with your account there no longer shows.",
      "The proposal that waits for your approval goes too; nothing in it was approved.",
    ]);
    // A proposal that ran out takes nothing with it.
    expect(
      removalLoss(
        companyFromView(view(lantern, { operations: [proposal("op_1", -1)] })),
      ),
    ).toEqual([]);
  });

  it("offers the lab's Companies the conversation isn't connected to", () => {
    const offered = notConnected(
      companiesFrom([view(lantern), view(harborline)]),
    ).map((c) => c.name);
    expect(offered).toEqual([
      "Juniper Market",
      "Northwind Air",
      "Fernwick Power & Light",
    ]);
    expect(offered).not.toContain(new URL(northwindUrl).host);
  });

  it("speaks of what waits for the User first, then of the last turn's Company", () => {
    const companies = companiesFrom([view(lantern), view(harborline)]);
    expect(inFocus(companies, undefined)?.origin).toBe(lantern);
    expect(inFocus(companies, harborline)?.origin).toBe(harborline);
    expect(inFocus(companies, harborline, lantern)?.origin).toBe(lantern);
    expect(inFocus([], harborline)).toBeUndefined();
  });
});

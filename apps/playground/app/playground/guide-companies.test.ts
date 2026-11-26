import { describe, expect, it } from "vitest";
import { companyFromView, type Operation } from "./company-state";
import { guideCompany } from "./guide";

const waiting = (id: string, changed: number): Operation => ({
  operation_id: id,
  revision: "1",
  state: "proposed",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  changed,
});
const lantern = "https://lantern.example";
const harborline = "https://harbor.example";
const northwind = "https://northwind.example";

describe("the Company the guide speaks about, with several", () => {
  it("is the one whose proposal waits for the User, the newest first", () => {
    const companies = [
      companyFromView({
        origin: lantern,
        name: "Lantern",
        operations: [waiting("op_1", 10)],
      }),
      companyFromView({
        origin: harborline,
        name: "Harborline",
        operations: [waiting("op_1", 20)],
      }),
      companyFromView({ origin: northwind, name: "Northwind" }),
    ];
    // The last turn was with Northwind, but a change waits at Harborline.
    expect(guideCompany(companies, northwind)?.name).toBe("Harborline");
  });

  it("is otherwise the one the last turn was with, or the first", () => {
    const companies = [
      companyFromView({ origin: lantern, name: "Lantern" }),
      companyFromView({ origin: harborline, name: "Harborline" }),
    ];
    expect(guideCompany(companies, harborline)?.name).toBe("Harborline");
    expect(guideCompany(companies, undefined)?.name).toBe("Lantern");
    expect(guideCompany([], undefined)).toBeUndefined();
  });
});

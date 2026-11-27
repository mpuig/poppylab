/**
 * The lab's own Companies, as Iris offers them and as a person may name
 * them. The list and the names are the lab's (`labSites` in pap-core),
 * which says where each is for the place this playground runs: the local
 * addresses in development, poppylab.dev's when deployed.
 */
import { labSites, type LabSite } from "@poppy-lab/pap-core";
import type { Nameable } from "@poppy-lab/pap-agent/company-names";
import { companyName, originOf } from "./connections";
import type { Connection } from "./runtime";

/**
 * One of the lab's Companies, as it can be named, with the lab's key for
 * it ("lantern"), which is how a scripted example of demo mode names its
 * Company (`demo-examples.ts`).
 */
export type LabCompany = Nameable & { id: LabSite };

/** `origin` is this playground's own, from the request. */
export const labCompanies = (origin: string): LabCompany[] =>
  labSites(origin).flatMap((site) =>
    // The lab's own pages have no words: only its Companies are named.
    "words" in site
      ? [{ id: site.id, url: site.url, name: site.label, words: site.words }]
      : [],
  );

/**
 * A connected Company as the User may name it: by its own name, and when
 * it is one of the lab's, by the lab's name for it too, with the lab's
 * plain words for the kind of company it is ("the bank").
 */
export function nameable(
  connection: Pick<Connection, "url" | "company">,
  lab: readonly Nameable[],
): Nameable {
  const listed = lab.find((c) => originOf(c) === originOf(connection));
  return {
    url: connection.url,
    name: companyName(connection),
    ...(listed
      ? { alias: listed.name, ...(listed.words ? { words: listed.words } : {}) }
      : {}),
  };
}

/**
 * The lab's own Companies, as Iris offers them and as a person may name
 * them. The list and the names are the lab's (`labSites` in pap-core),
 * which says where each is for the place this playground runs: the local
 * addresses in development, poppylab.dev's when deployed.
 */
import { labSites } from "@poppy-lab/pap-core";
import type { Nameable } from "./company-names";

/** `origin` is this playground's own, from the request. */
export const labCompanies = (origin: string): Nameable[] =>
  labSites(origin).flatMap((site) =>
    // The lab's own pages have no words: only its Companies are named.
    "words" in site
      ? [{ url: site.url, name: site.label, words: site.words }]
      : [],
  );

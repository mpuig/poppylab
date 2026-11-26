/**
 * The Companies a person names in their own words: "Lantern", "the bank",
 * "Harborline Bank". A Company is matched by its name, by the words its
 * name begins with, and by a few plain words listed for it. A name is only
 * ever matched against the Companies given: nothing here turns words into
 * an address.
 *
 * English only, plain data and no I/O.
 */

/** A Company that can be named: where it is, its name, and words for it. */
export type Nameable = {
  url: string;
  name: string;
  /** Plain words a person may use for it: "bank", "the airline". */
  words?: readonly string[];
};

/** Words in lower case, without accents or punctuation, singly spaced. */
export const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A leading article says nothing about which Company is meant. */
const bare = (words: string) => words.replace(/^(?:the|a|an|my|our) /, "");

/**
 * The ways to say a Company: its whole name, the words its name begins
 * with ("Lantern", "Lantern Noodle"), and each plain word listed for it.
 */
function ways(company: Nameable): string[] {
  const name = bare(plain(company.name)).split(" ").filter(Boolean);
  return [
    ...name.map((_, i) => name.slice(0, i + 1).join(" ")),
    ...(company.words ?? []).map((word) => bare(plain(word))),
  ].filter(Boolean);
}

/**
 * The Companies these words are a name for, and nothing more than a name:
 * "the bank" names Harborline Bank, "the bank's opening hours" none.
 */
export function namedBy<T extends Nameable>(
  text: string,
  companies: readonly T[],
): T[] {
  const said = bare(plain(text));
  return said ? companies.filter((c) => ways(c).includes(said)) : [];
}

/**
 * The Companies named somewhere in these words, as whole words: "Lantern
 * or the bank" names two. A Company's name wins over a plain word for
 * another: "Harborline Bank" names one bank, not every one.
 */
export function namedIn<T extends Nameable>(
  text: string,
  companies: readonly T[],
): T[] {
  const said = ` ${plain(text)} `;
  const within = (way: string) => said.includes(` ${way} `);
  const byName = companies.filter((c) =>
    ways({ url: c.url, name: c.name }).some(within),
  );
  return byName.length ? byName : companies.filter((c) => ways(c).some(within));
}

/**
 * The Company a person names in answer to "Which company is this for?":
 * its name alone, or said as an answer ("for Lantern", "it's the bank,
 * please"). Only when exactly one of the Companies is meant.
 */
export function answeredWith<T extends Nameable>(
  text: string,
  companies: readonly T[],
): T | undefined {
  const said = plain(text)
    .replace(/^(?:it is|its|it s|that is|thats|this is|this one is)? ?/, "")
    .replace(/^(?:for|at|to|with|use|ask) /, "")
    .replace(/ (?:please|thanks|thank you)$/, "");
  const [one, ...more] = namedBy(said, companies);
  return one && !more.length ? one : undefined;
}

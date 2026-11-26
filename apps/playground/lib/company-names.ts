/**
 * The Companies a person names in their own words: "Lantern", "Harborline
 * Bank", and after "connect with", "the bank". A Company is matched by its
 * name and by the words its name begins with. A few plain words listed for
 * it ("bank", "restaurant") say what kind of company it is: they name it
 * only where the caller says the words can mean nothing else, since
 * "remove the noodles" and "leave the restaurant" are also said to a
 * Company about an order. A name is only ever matched against the
 * Companies given: nothing here turns words into an address.
 *
 * English only, plain data and no I/O.
 */

/** A Company that can be named: where it is, its name, and words for it. */
export type Nameable = {
  url: string;
  name: string;
  /** Another name it goes by: the lab's, for one of the lab's Companies. */
  alias?: string;
  /** Plain words for the kind of company it is: "bank", "airline". */
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

/** A Company's names: its own, and the lab's for it. */
const names = (company: Nameable) =>
  [company.name, company.alias ?? ""].filter((name) => bare(plain(name)));

/** The same, as they are said in full. */
const wholeNames = (company: Nameable) =>
  names(company).map((name) => bare(plain(name)));

/**
 * The ways to say a Company's name: in full, or by the words it begins
 * with ("Lantern", "Lantern Noodle"). A Company that hasn't been read yet
 * goes by its host, and a host is only said in full: the first label of
 * "noodles.localhost" is no name for it.
 */
const nameWays = (company: Nameable) =>
  names(company).flatMap((name) => {
    const whole = bare(plain(name));
    if (/^\S+\.\S+$/.test(name.trim())) return [whole];
    const words = whole.split(" ");
    return words.map((_, i) => words.slice(0, i + 1).join(" "));
  });

/** The plain words listed for the kind of company it is. */
const kindWays = (company: Nameable) =>
  (company.words ?? []).map((word) => bare(plain(word))).filter(Boolean);

/**
 * The Companies these words are the name of, and nothing more than the
 * name: "Lantern" names Lantern Noodle Bar, "Lantern's opening hours"
 * none, and "the restaurant" none either, since that is no name. A name
 * said in full is that Company alone, though another's name begins with
 * the same words.
 */
export function namedBy<T extends Nameable>(
  text: string,
  companies: readonly T[],
): T[] {
  const said = bare(plain(text));
  if (!said) return [];
  const whole = companies.filter((c) => wholeNames(c).includes(said));
  return whole.length
    ? whole
    : companies.filter((c) => nameWays(c).includes(said));
}

/**
 * The same, and for words that are no name, the Companies of the kind the
 * words say: "the bank" names Harborline Bank. Only for words that can
 * mean nothing but a Company, such as those after "connect with".
 */
export function namedPlainly<T extends Nameable>(
  text: string,
  companies: readonly T[],
): T[] {
  const byName = namedBy(text, companies);
  if (byName.length) return byName;
  const said = bare(plain(text));
  return said ? companies.filter((c) => kindWays(c).includes(said)) : [];
}

/**
 * The Companies named somewhere in these words, as whole words: "Lantern
 * or the bank" names two. A Company's name wins over a plain word for
 * another: "Harborline Bank" names one bank, not every one. Like
 * `namedPlainly`, only for words that can mean nothing but a Company.
 */
export function namedIn<T extends Nameable>(
  text: string,
  companies: readonly T[],
): T[] {
  const said = ` ${plain(text)} `;
  const within = (way: string) => said.includes(` ${way} `);
  const byName = companies.filter((c) => nameWays(c).some(within));
  return byName.length
    ? byName
    : companies.filter((c) => kindWays(c).some(within));
}

/**
 * The Companies a person names in answer to "Which company is this for?":
 * a name alone, or said as an answer ("for Lantern", "it's Harborline,
 * please"). Only a name counts (`namedBy`). One Company is the answer;
 * several mean the name fits more than one, and the caller asks again;
 * none means the message is no answer.
 */
export function answeredWith<T extends Nameable>(
  text: string,
  companies: readonly T[],
): T[] {
  const said = plain(text)
    .replace(/^(?:it is|its|that is|thats|this is|this one is) /, "")
    .replace(/^(?:for|at|to|with|use|ask) /, "")
    .replace(/ (?:please|thanks|thank you)$/, "");
  return namedBy(said, companies);
}

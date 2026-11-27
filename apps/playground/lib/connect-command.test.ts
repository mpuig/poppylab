import { describe, expect, it } from "vitest";
import { labCompanies as cards } from "../app/playground/companies";
import type { Nameable } from "./company-names";
import { connectCommand } from "./connect-command";
import { labCompanies, nameable } from "./lab-companies";

const lab: Nameable[] = labCompanies("http://localhost:3000");
const url = (name: string) => lab.find((c) => c.name.startsWith(name))!.url;
/** Connected to Juniper, under the name its own discovery gives. */
const connected = [{ url: url("Juniper"), name: "Juniper" }];
const read = (message: string, known = { connected, lab }) => {
  const command = connectCommand(message, known);
  if (!command) return undefined;
  if ("companies" in command)
    return [
      command.verb,
      command.companies.map((c) => c.name).join(" + "),
      command.rest,
    ];
  if ("which" in command)
    return [command.verb, "which", command.which.map((c) => c.name)];
  return [command.verb, "unknown", command.unknown];
};
/** Whether the words are only ever meant for this. */
const sure = (message: string, known = { connected, lab }) =>
  connectCommand(message, known)?.sure;

describe("the lab's Companies, as a person may name them", () => {
  it("are the lab's five, with a few plain words each and none shared", () => {
    expect(lab.map((c) => c.name)).toEqual([
      "Juniper Market",
      "Lantern Noodle Bar",
      "Harborline Bank",
      "Northwind Air",
      "Fernwick Power & Light",
    ]);
    const words = lab.flatMap((c) => c.words ?? []);
    expect(words.length).toBeGreaterThanOrEqual(lab.length);
    expect(new Set(words).size).toBe(words.length);
    // Where each is depends on where the playground runs.
    expect(labCompanies("https://poppylab.dev").map((c) => c.url)).toEqual([
      "https://grocery-demo.poppylab.dev",
      "https://food-demo.poppylab.dev",
      "https://bank-demo.poppylab.dev",
      "https://airline-demo.poppylab.dev",
      "https://energy-demo.poppylab.dev",
    ]);
  });

  it("lists kinds of company for them, and nothing a Company sells", () => {
    expect(lab.flatMap((c) => c.words ?? [])).toEqual([
      "grocery store",
      "supermarket",
      "restaurant",
      "noodle bar",
      "bank",
      "airline",
      "utility",
      "power company",
      "energy company",
    ]);
  });
});

describe("a request to connect a Company, in words only ever meant for that", () => {
  it.each([
    ["connect with Lantern", "Lantern Noodle Bar"],
    ["Connect with Lantern Noodle Bar.", "Lantern Noodle Bar"],
    ["connect to the bank", "Harborline Bank"],
    ["connect to Harborline Bank please", "Harborline Bank"],
    ["Please connect with the airline", "Northwind Air"],
    ["Can you connect with Fernwick Power & Light?", "Fernwick Power & Light"],
    ["hey Iris could you connect with Northwind", "Northwind Air"],
    ["I'd like to connect to the utility", "Fernwick Power & Light"],
    ["also connect with Lantern", "Lantern Noodle Bar"],
    // The plain words name a kind of company, after these words only.
    ["connect to the restaurant", "Lantern Noodle Bar"],
    ["connect with the noodle bar", "Lantern Noodle Bar"],
    ["connect to the grocery store", "Juniper"],
    ["connect with the supermarket", "Juniper"],
    ["connect to the power company", "Fernwick Power & Light"],
    ["connect with my energy company", "Fernwick Power & Light"],
    // A name inside a few words.
    ["connect with the Lantern restaurant", "Lantern Noodle Bar"],
    ["connect to my Harborline account", "Harborline Bank"],
  ])("takes “%s” for %s", (message, name) => {
    expect(read(message)).toEqual(["connect", name, ""]);
    expect(sure(message)).toBe(true);
  });

  it("takes several Companies at once, each once", () => {
    expect(read("connect with Lantern and Harborline")).toEqual([
      "connect",
      "Lantern Noodle Bar + Harborline Bank",
      "",
    ]);
    expect(read("connect with Lantern, the bank and Northwind")).toEqual([
      "connect",
      "Lantern Noodle Bar + Harborline Bank + Northwind Air",
      "",
    ]);
    expect(read("connect with Lantern and Lantern Noodle Bar")).toEqual([
      "connect",
      "Lantern Noodle Bar",
      "",
    ]);
  });

  it.each([
    ["connect with Lantern and show me the menu", "show me the menu"],
    ["Connect with Lantern. What's on the menu?", "What's on the menu?"],
    ["connect to Lantern, then show me the menu", "show me the menu"],
    [
      "also connect to Lantern and then what's on the menu",
      "what's on the menu",
    ],
    ["connect with Lantern; which slots are there?", "which slots are there?"],
  ])("keeps what else “%s” asks, in the User's words", (message, rest) => {
    expect(read(message)).toEqual(["connect", "Lantern Noodle Bar", rest]);
  });

  it("finds a connected Company by its own name first, and a lab one by either", () => {
    // Connected under the name "Juniper": the same place as the lab's.
    expect(read("connect with Juniper Market")).toEqual([
      "connect",
      "Juniper",
      "",
    ]);
    const other = [{ url: "https://acme.example", name: "Acme Travel" }];
    expect(read("connect with Acme", { connected: other, lab })).toEqual([
      "connect",
      "Acme Travel",
      "",
    ]);
  });

  it("asks which when the words fit two", () => {
    expect(read("connect with Lantern or Harborline")).toEqual([
      "connect",
      "which",
      ["Lantern Noodle Bar", "Harborline Bank"],
    ]);
    const twin = [
      ...lab,
      { url: "https://trust.example", name: "Harborline Trust" },
    ];
    expect(read("add Harborline", { connected: [], lab: twin })).toEqual([
      "connect",
      "which",
      ["Harborline Bank", "Harborline Trust"],
    ]);
    // A whole name is that Company, though another's begins with it.
    const short = [...lab, { url: "https://h.example", name: "Harborline" }];
    expect(
      read("connect with Harborline", { connected: [], lab: short }),
    ).toEqual(["connect", "Harborline", ""]);
  });

  it.each([
    ["connect with Acme", "Acme"],
    ["connect to wifi please", "wifi"],
    ["connect with food-demo.poppylab.dev", "food-demo.poppylab.dev"],
    ["connect to https://evil.example/", "https://evil.example/"],
    ["connect with Lantern show me the menu now", "Lantern show me the menu"],
    // What a Company sells is no name for it.
    ["connect with noodles", "noodles"],
    ["connect to flights", "flights"],
    ["connect with groceries", "groceries"],
    ["connect to electricity", "electricity"],
    ["connect with the takeaway", "the takeaway"],
    ["connect", ""],
    ["Connect.", ""],
    ["connect with a company", ""],
    ["connect to another one", ""],
  ])("says “%s” names no Company it knows", (message, unknown) => {
    expect(read(message)).toEqual(["connect", "unknown", unknown]);
  });
});

describe("a request to connect a Company, in words a person also says to a Company", () => {
  it.each([
    ["connect Lantern", "Lantern Noodle Bar"],
    ["Iris, connect me to Lantern", "Lantern Noodle Bar"],
    ["add Northwind", "Northwind Air"],
    ["add Harborline too", "Harborline Bank"],
    ["let's add Juniper", "Juniper"],
    ["add Juniper Market", "Juniper"],
    ["also Harborline Bank", "Harborline Bank"],
    ["also add Lantern", "Lantern Noodle Bar"],
    ["plus Northwind", "Northwind Air"],
    ["Harborline too", "Harborline Bank"],
    ["Harborline Bank as well", "Harborline Bank"],
    ["include Fernwick", "Fernwick Power & Light"],
    ["bring in Northwind Air", "Northwind Air"],
    ["link with Lantern", "Lantern Noodle Bar"],
    ["add Lantern please", "Lantern Noodle Bar"],
  ])(
    "takes “%s” for %s: a Company's name and nothing else",
    (message, name) => {
      expect(read(message)).toEqual(["connect", name, ""]);
      expect(sure(message)).toBe(false);
    },
  );

  it("takes several names, and nothing but names", () => {
    expect(read("add Lantern, Harborline and Northwind")).toEqual([
      "connect",
      "Lantern Noodle Bar + Harborline Bank + Northwind Air",
      "",
    ]);
    expect(read("add Lantern, the bank and Northwind")).toBeUndefined();
    expect(read("add Lantern and then what's on the menu")).toBeUndefined();
    expect(read("add Lantern and an iced tea")).toBeUndefined();
  });

  it.each([
    // A kind of company is no name after these words.
    "Iris, connect me to the restaurant",
    "add the bank too",
    "let's add the grocery store",
    "plus the airline",
    "the bank as well",
    "include the utility",
    // Nor is what a Company sells.
    "add noodles",
    "add noodles please",
    "add groceries",
    "add flights",
    "also noodles",
    "plus noodles",
    "noodles too",
    "include noodles",
    "add electricity",
  ])("leaves “%s” as it is", (message) => {
    expect(read(message)).toBeUndefined();
  });
});

describe("a request to remove a Company, in the User's words", () => {
  const both = {
    connected: [
      ...connected,
      { url: url("Harborline"), name: "Harborline Bank" },
    ],
    lab,
  };

  it.each([
    ["disconnect from Juniper", "Juniper"],
    ["Disconnect from the bank, please", "Harborline Bank"],
    ["disconnect from the grocery store", "Juniper"],
    ["please disconnect from Juniper Market", "Juniper"],
    // Not connected: the caller says so.
    ["disconnect from Lantern", "Lantern Noodle Bar"],
    ["disconnect from the restaurant", "Lantern Noodle Bar"],
  ])(
    "takes “%s” for %s, in words only ever meant for that",
    (message, name) => {
      expect(read(message, both)).toEqual(["remove", name, ""]);
      expect(sure(message, both)).toBe(true);
    },
  );

  it.each([
    ["remove Harborline", "Harborline Bank"],
    ["Remove Harborline Bank.", "Harborline Bank"],
    ["drop Juniper", "Juniper"],
    ["disconnect Harborline Bank", "Harborline Bank"],
    ["stop using Harborline", "Harborline Bank"],
    ["leave Juniper", "Juniper"],
    ["please remove Juniper Market", "Juniper"],
    ["remove Lantern", "Lantern Noodle Bar"],
  ])(
    "takes “%s” for %s: a Company's name and nothing else",
    (message, name) => {
      expect(read(message, both)).toEqual(["remove", name, ""]);
      // The caller asks before it removes anything on words like these.
      expect(sure(message, both)).toBe(false);
    },
  );

  it("keeps what else the message asks, and takes several at once", () => {
    expect(read("disconnect from Juniper and show my balances", both)).toEqual([
      "remove",
      "Juniper",
      "show my balances",
    ]);
    expect(read("disconnect from Juniper and the bank", both)).toEqual([
      "remove",
      "Juniper + Harborline Bank",
      "",
    ]);
    expect(read("remove Juniper and Harborline", both)).toEqual([
      "remove",
      "Juniper + Harborline Bank",
      "",
    ]);
    // Something else after a name: the message is for a Company.
    expect(read("remove Juniper and show my balances", both)).toBeUndefined();
  });

  it("says a name fits no Company only for words that are only ever meant for this", () => {
    expect(read("disconnect from Acme", both)).toEqual([
      "remove",
      "unknown",
      "Acme",
    ]);
    expect(read("disconnect from the noodles", both)).toEqual([
      "remove",
      "unknown",
      "the noodles",
    ]);
    expect(read("remove Acme", both)).toBeUndefined();
  });

  // Lantern and Juniper connected, each under the lab's name and words.
  const eating = {
    connected: [
      nameable({ url: url("Lantern") }, lab),
      nameable({ url: url("Juniper") }, lab),
    ],
    lab,
  };
  it.each([
    "remove the noodles",
    "remove noodles",
    "drop the noodles",
    "remove the takeaway",
    "remove groceries",
    "leave the restaurant",
    "remove the noodles and add an iced tea",
    "remove the grocery store",
    "stop using the bank",
    "stop using electricity",
    "Remove the bank",
    "drop the restaurant",
  ])(
    "leaves “%s” as it is: an order is edited in the same words",
    (message) => {
      expect(read(message, eating)).toBeUndefined();
    },
  );
});

describe("a message that is for a Company, and no request about the Companies", () => {
  it.each([
    "Add a matcha ice cream and move it to Sunday lunchtime.",
    "add 2 apples to my basket",
    "remove oranges from my basket",
    "remove it",
    "drop the last item",
    "leave a note for the driver",
    "also show me dessert",
    "also, what are your hours?",
    "connect me to a person",
    "connect me with support",
    "disconnect my service",
    "stop using my old card",
    "How do I connect with Lantern?",
    "don't connect with Lantern",
    "Is the bank open?",
    "What's on the menu at Lantern?",
    "Lantern",
    "the bank",
    "me too",
    "that works as well",
    "link my card",
    "include a receipt",
  ])("leaves “%s” as it is", (message) => {
    expect(read(message)).toBeUndefined();
  });

  it("leaves every request the page suggests as it is", () => {
    for (const company of cards)
      for (const phrase of [...company.open, ...company.account, company.ask])
        expect(read(phrase), phrase).toBeUndefined();
  });
});

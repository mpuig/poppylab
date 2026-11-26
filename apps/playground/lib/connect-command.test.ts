import { describe, expect, it } from "vitest";
import { labCompanies as cards } from "../app/playground/companies";
import { connectCommand } from "./connect-command";
import { labCompanies } from "./lab-companies";

const lab = labCompanies("http://localhost:3000");
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
});

describe("a request to connect a Company, in the User's words", () => {
  it.each([
    ["connect with Lantern", "Lantern Noodle Bar"],
    ["Connect with Lantern Noodle Bar.", "Lantern Noodle Bar"],
    ["connect to the bank", "Harborline Bank"],
    ["connect to Harborline Bank please", "Harborline Bank"],
    ["Please connect with the airline", "Northwind Air"],
    ["Can you connect with Fernwick Power & Light?", "Fernwick Power & Light"],
    ["Iris, connect me to the restaurant", "Lantern Noodle Bar"],
    ["hey Iris could you connect with Northwind", "Northwind Air"],
    ["I'd like to connect to the utility", "Fernwick Power & Light"],
    ["connect Lantern", "Lantern Noodle Bar"],
    ["add Northwind", "Northwind Air"],
    ["add the bank too", "Harborline Bank"],
    ["let's add the grocery store", "Juniper"],
    ["also Harborline Bank", "Harborline Bank"],
    ["also add Lantern", "Lantern Noodle Bar"],
    ["also connect with Lantern", "Lantern Noodle Bar"],
    ["plus the airline", "Northwind Air"],
    ["Harborline too", "Harborline Bank"],
    ["the bank as well", "Harborline Bank"],
    ["include Fernwick", "Fernwick Power & Light"],
    ["bring in Northwind Air", "Northwind Air"],
    ["link with Lantern", "Lantern Noodle Bar"],
    // A name inside a few words, after words only ever meant for this.
    ["connect with the Lantern restaurant", "Lantern Noodle Bar"],
    ["connect to my Harborline account", "Harborline Bank"],
  ])("takes “%s” for %s", (message, name) => {
    expect(read(message)).toEqual(["connect", name, ""]);
  });

  it("takes several Companies at once, each once", () => {
    expect(read("connect with Lantern and Harborline")).toEqual([
      "connect",
      "Lantern Noodle Bar + Harborline Bank",
      "",
    ]);
    expect(read("add Lantern, the bank and Northwind")).toEqual([
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
    ["add Lantern and then what's on the menu", "what's on the menu"],
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
  });

  it.each([
    ["connect with Acme", "Acme"],
    ["connect to wifi please", "wifi"],
    ["connect with food-demo.poppylab.dev", "food-demo.poppylab.dev"],
    ["connect to https://evil.example/", "https://evil.example/"],
    ["connect with Lantern show me the menu now", "Lantern show me the menu"],
    ["connect", ""],
    ["Connect.", ""],
    ["connect with a company", ""],
    ["connect to another one", ""],
  ])("says “%s” names no Company it knows", (message, unknown) => {
    expect(read(message)).toEqual(["connect", "unknown", unknown]);
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
    ["remove Harborline", "Harborline Bank"],
    ["remove the grocery store", "Juniper"],
    ["drop Juniper", "Juniper"],
    ["disconnect Harborline Bank", "Harborline Bank"],
    ["stop using the bank", "Harborline Bank"],
    ["please remove Juniper Market", "Juniper"],
    // Not connected: the caller says so.
    ["remove Lantern", "Lantern Noodle Bar"],
  ])("takes “%s” for %s", (message, name) => {
    expect(read(message, both)).toEqual(["remove", name, ""]);
  });

  it("keeps what else the message asks, and takes several at once", () => {
    expect(read("remove Juniper and show my balances", both)).toEqual([
      "remove",
      "Juniper",
      "show my balances",
    ]);
    expect(read("disconnect from Juniper and the bank", both)).toEqual([
      "remove",
      "Juniper + Harborline Bank",
      "",
    ]);
  });

  it("says a name fits no Company only for words that are only ever meant for this", () => {
    expect(read("disconnect from Acme", both)).toEqual([
      "remove",
      "unknown",
      "Acme",
    ]);
    expect(read("remove Acme", both)).toBeUndefined();
  });
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

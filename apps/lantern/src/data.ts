/** Lantern's fictional menu, delivery slots and test customers. */
export const menu = [
  { id: "shoyu-ramen", name: "Shoyu ramen", price_cents: 1450 },
  { id: "miso-ramen", name: "Miso vegetable ramen", price_cents: 1350 },
  { id: "pork-gyoza", name: "Pork gyoza (6)", price_cents: 800 },
  { id: "veg-gyoza", name: "Vegetable gyoza (6)", price_cents: 750 },
  { id: "edamame", name: "Salted edamame", price_cents: 500 },
  { id: "matcha-ice", name: "Matcha ice cream", price_cents: 600 },
] as const;
export const slots = [
  { id: "fri-1830", label: "Friday 18:30–19:00" },
  { id: "sat-1230", label: "Saturday 12:30–13:00" },
  { id: "sat-1900", label: "Saturday 19:00–19:30" },
  { id: "sun-1300", label: "Sunday 13:00–13:30" },
] as const;
export const DELIVERY_CENTS = 300;
export const customers = [
  {
    id: "sam",
    name: "Sam Rivera",
    order: {
      id: "ord_LNB1001",
      slot: "fri-1830",
      lines: { "shoyu-ramen": 2, edamame: 1 },
    },
  },
  {
    id: "robin",
    name: "Robin Ito",
    order: { id: "ord_LNB2001", slot: "sat-1230", lines: { "miso-ramen": 1 } },
  },
];
export const noodlePersona = (id: unknown) =>
  customers.find((c) => c.id === id);

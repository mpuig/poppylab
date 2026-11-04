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
/** Kitchen hours, for the website and the Company Agent. */
export const hours = [
  { days: "Wednesday to Friday", open: "17:30–21:30" },
  { days: "Saturday and Sunday", open: "12:00–21:30" },
  { days: "Monday and Tuesday", open: "Closed" },
] as const;
/** Fictional: 555-0100 to 555-0199 are reserved for fiction in North America. */
export const PHONE = "+1 555-0142";
export const PHONE_HOURS = "Wednesday to Sunday, during kitchen hours";
export const customers = [
  {
    id: "sam",
    name: "Sam Rivera",
    order: {
      id: "ord_LNB1001",
      slot: "fri-1830",
      lines: { "shoyu-ramen": 2, edamame: 1 },
    },
    /** The last delivered order, for missing-item reports. */
    delivered: {
      id: "ord_LNB0907",
      at: "Friday 31 October, 19:12",
      lines: { "shoyu-ramen": 2, "pork-gyoza": 1 },
    },
  },
  {
    id: "robin",
    name: "Robin Ito",
    order: { id: "ord_LNB2001", slot: "sat-1230", lines: { "miso-ramen": 1 } },
    delivered: {
      id: "ord_LNB1907",
      at: "Saturday 1 November, 13:05",
      lines: { "miso-ramen": 1, "veg-gyoza": 1, "matcha-ice": 1 },
    },
  },
];
export const noodlePersona = (id: unknown) =>
  customers.find((c) => c.id === id);

export const personas = [
  {
    id: "alex",
    name: "Alex Rivers",
    email: "alex@example.invalid",
    address: "Fictional Juniper demo address",
    day: "Thursday",
    items: { oranges: 1, coffee: 1 },
  },
  {
    id: "maya",
    name: "Maya Sol",
    email: "maya@example.invalid",
    address: "8 Elm Street — fictional",
    day: "Tuesday",
    items: { apples: 2, broccoli: 1 },
  },
  {
    id: "leo",
    name: "Leo Mar",
    email: "leo@example.invalid",
    address: "3 Harbour Square — fictional",
    day: "Saturday",
    items: { coffee: 2 },
  },
];
export const persona = (id: unknown) => personas.find((p) => p.id === id);
export const personaSelect = `<label for="account">Fictional account</label><select id="account" name="account">${personas.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>`;

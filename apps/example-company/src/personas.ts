export const personas = [
  {
    id: "elena",
    name: "Elena Maren",
    email: "elena@example.invalid",
    address: "Fictional Juniper demo address",
    day: "Thursday",
    items: { oranges: 1, coffee: 1 },
  },
  {
    id: "robin",
    name: "Robin Ito",
    email: "robin@example.invalid",
    address: "8 Elm Street — fictional",
    day: "Tuesday",
    items: { apples: 2, broccoli: 1 },
  },
];
export const persona = (id: unknown) => personas.find((p) => p.id === id);
export const personaSelect = `<label for="account">Fictional account</label><select id="account" name="account">${personas.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>`;

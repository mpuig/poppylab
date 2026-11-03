export const sandboxCompanies = [
  { name: "Kettle Street Noodles", url: "https://food.papsandbox.com" },
  { name: "Northlight Flowers", url: "https://flowers.papsandbox.com" },
  { name: "Harbour Row Stays", url: "https://stays.papsandbox.com" },
] as const;
export function isSandbox(origin: string) {
  return sandboxCompanies.some((c) => c.url === origin);
}

export class ShoppingConflict extends Error {}
export const validDay = (day: unknown): day is string =>
  typeof day === "string" && ["Tuesday", "Thursday", "Saturday"].includes(day);
export const validQuantity = (
  quantity: unknown,
  stock: number,
): quantity is number =>
  typeof quantity === "number" &&
  Number.isSafeInteger(quantity) &&
  quantity >= 0 &&
  quantity <= stock;
export function shoppingInput(
  data: unknown,
  catalogue: ReadonlyArray<{ id: string; stock: number }>,
  delivery: boolean,
) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("invalid_shopping");
  const b = data as Record<string, unknown>;
  if (
    Object.keys(b).some(
      (k) => !["version", "items", ...(delivery ? ["day"] : [])].includes(k),
    ) ||
    !Number.isSafeInteger(b.version) ||
    Number(b.version) < 1 ||
    !b.items ||
    typeof b.items !== "object" ||
    Array.isArray(b.items) ||
    (delivery && !validDay(b.day))
  )
    throw Error("invalid_shopping");
  const items = b.items as Record<string, unknown>;
  if (
    Object.keys(items).length !== catalogue.length ||
    catalogue.some(
      (p) =>
        !Object.hasOwn(items, p.id) || !validQuantity(items[p.id], p.stock),
    )
  )
    throw Error("invalid_quantities");
  return {
    version: Number(b.version),
    items: Object.fromEntries(
      catalogue.map((p) => [p.id, Number(items[p.id])]),
    ),
    day: b.day as string,
  };
}

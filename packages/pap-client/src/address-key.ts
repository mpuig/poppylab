/**
 * What an address counts as for attempt limits: an IPv4 address itself,
 * and an IPv6 address its /64, which one subscriber usually holds whole, so
 * moving to another address in it starts no new count. An IPv4 address
 * mapped into IPv6 counts as that IPv4 address. Anything else is as given.
 */
export function addressKey(address: string) {
  if (!address.includes(":")) return address;
  let host: string;
  try {
    // The URL parser writes it one way: lowercase, shortest, hex groups.
    host = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return address;
  }
  const [head = "", tail] = host.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(8 - left.length - right.length).fill("0"),
          ...right,
        ];
  if (groups.slice(0, 6).join(":") === "0:0:0:0:0:ffff") {
    const [high, low] = groups.slice(6).map((g) => parseInt(g, 16));
    return [high! >> 8, high! & 255, low! >> 8, low! & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

import { expect, it } from "vitest";
import { addressKey } from "./address-key.ts";

it("keys an address by what it is", () => {
  expect(addressKey("192.0.2.1")).toBe("192.0.2.1");
  expect(addressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  expect(addressKey("2001:0DB8:0000:0000:1:2:3:4")).toBe("2001:db8:0:0::/64");
  expect(addressKey("2001:db8:a:b:c:d:e:f")).toBe("2001:db8:a:b::/64");
  expect(addressKey("::1")).toBe("0:0:0:0::/64");
  expect(addressKey("::ffff:192.0.2.1")).toBe("192.0.2.1");
  expect(addressKey("not:an:address")).toBe("not:an:address");
});

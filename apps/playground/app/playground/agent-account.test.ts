import { expect, it } from "vitest";
import {
  AccountError,
  broughtSentence,
  ceremonyFailure,
  deviceName,
} from "./agent-account";

it("names a device by its browser and system, and nothing finer", () => {
  expect(
    deviceName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ),
  ).toBe("Chrome on macOS");
  expect(
    deviceName(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    ),
  ).toBe("Safari on iPhone");
  expect(
    deviceName(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    ),
  ).toBe("Edge on Windows");
  expect(deviceName("curl/8")).toBe("A browser");
});

it("says what happened when a passkey prompt didn't finish", () => {
  const closed = Object.assign(new Error("x"), { name: "NotAllowedError" });
  expect(ceremonyFailure(closed, "Signing in")).toBe(
    "Signing in didn’t finish, so nothing changed. Try again when you’re ready.",
  );
  expect(
    ceremonyFailure(
      Object.assign(new Error("x"), { name: "InvalidStateError" }),
      "Adding the passkey",
    ),
  ).toBe("This device already has a passkey for this account.");
  expect(
    ceremonyFailure(new AccountError("Too many attempts."), "Signing in"),
  ).toBe("Too many attempts.");
});

it("says how many conversations were brought in, and how many stayed", () => {
  expect(broughtSentence(2, 0)).toBe(
    "2 conversations moved into your account. They open on every device you sign in on.",
  );
  expect(broughtSentence(1, 1)).toBe(
    "1 conversation moved into your account. It opens on every device you sign in on. 1 conversation was busy and stayed in this browser; try again in a moment.",
  );
  expect(broughtSentence(0, 0)).toBe("There was nothing to bring.");
});

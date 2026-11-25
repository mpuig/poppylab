import { expect, it } from "vitest";
import { clock, logEntry, traceFileName } from "./protocol-log";

it("types a trace line with its section, request and outcome", () => {
  const e = logEntry("GET /api/orders?token=secret#x · Poppy Session", 1000);
  expect(e).toMatchObject({
    section: "§7",
    method: "GET",
    url: "/api/orders",
    outcome: "info",
  });
  expect(JSON.stringify(e)).not.toContain("secret");
});

it("reads an outcome from the event's own words", () => {
  expect(logEntry("Approval required · nothing performed").outcome).toBe("waiting");
  expect(logEntry("Operation declined · revision 2").outcome).toBe("refused");
  expect(logEntry("Operation failed · revision 2").outcome).toBe("error");
  expect(logEntry("Direct Sign-In completed · PKCE").outcome).toBe("ok");
});

it("formats a clock with milliseconds and a download name", () => {
  expect(clock(new Date(2026, 10, 3, 14, 5, 9, 7).getTime())).toBe("14:05:09.007");
  expect(traceFileName("https://juniper.example/", new Date("2026-11-03T10:00:00Z"))).toBe(
    "poppy-trace-juniper.example-2026-11-03.txt",
  );
});

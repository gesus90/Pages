import { describe, expect, it } from "vitest";

import { loginDestination } from "@/app/lib/login-destination.server";

describe("login destination", () => {
  it.each(["/koppeln", "/koppeln?code=ABC-123%20"])(
    "accepts the pairing destination %s",
    (destination) => {
      expect(loginDestination(destination)).toBe(destination);
    },
  );

  it.each([
    undefined,
    null,
    1,
    "//evil.test",
    "/dashboard",
    "/koppeln?code=",
    "/koppeln?code=abc&next=/",
    `/koppeln?code=${"a".repeat(41)}`,
  ])("returns the dashboard for an untrusted destination %s", (destination) => {
    expect(loginDestination(destination)).toBe("/dashboard");
  });
});

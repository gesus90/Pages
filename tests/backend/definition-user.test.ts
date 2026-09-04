import { describe, expect, it } from "vitest";

import { isUser } from "@/definition/User";

describe("isUser", () => {
  it("accepts a complete user object", () => {
    expect(
      isUser({ displayName: "Admin", id: "user-1", username: "admin" }),
    ).toBe(true);
  });

  it("accepts a user with additional unknown properties", () => {
    expect(
      isUser({
        displayName: "Admin",
        extra: "ignored",
        id: "user-1",
        username: "admin",
      }),
    ).toBe(true);
  });

  it("accepts unicode display names", () => {
    expect(
      isUser({ displayName: "Müller 🚀", id: "user-2", username: "müller" }),
    ).toBe(true);
  });

  it("rejects null and undefined", () => {
    expect(isUser(null)).toBe(false);
    expect(isUser(undefined)).toBe(false);
  });

  it.each([0, 1, -1, 42, Number.MAX_SAFE_INTEGER, true, false, "user", []])(
    "rejects primitive value %p",
    (value) => {
      expect(isUser(value)).toBe(false);
    },
  );

  it("rejects an empty object", () => {
    expect(isUser({})).toBe(false);
  });

  it("rejects a user without an id", () => {
    expect(isUser({ displayName: "Admin", username: "admin" })).toBe(false);
  });

  it("rejects a user without a username", () => {
    expect(isUser({ displayName: "Admin", id: "user-1" })).toBe(false);
  });

  it("rejects a user without a display name", () => {
    expect(isUser({ id: "user-1", username: "admin" })).toBe(false);
  });

  it.each([
    [{ displayName: "Admin", id: 1, username: "admin" }],
    [{ displayName: "Admin", id: "user-1", username: 7 }],
    [{ displayName: null, id: "user-1", username: "admin" }],
    [{ displayName: "Admin", id: "user-1", username: undefined }],
    [{ displayName: ["Admin"], id: "user-1", username: "admin" }],
    [{ displayName: "Admin", id: "user-1", username: { value: "admin" } }],
  ])("rejects a user with mistyped fields %p", (value) => {
    expect(isUser(value)).toBe(false);
  });

  it("rejects arrays even when they carry user-shaped properties", () => {
    const candidate = ["user-1"] as unknown as Record<string, unknown>;
    candidate.id = "user-1";
    candidate.username = "admin";
    candidate.displayName = "Admin";

    expect(isUser(["user-1", "admin", "Admin"])).toBe(false);
  });
});

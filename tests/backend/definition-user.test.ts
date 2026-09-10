import { describe, expect, it } from "vitest";

import { isUser } from "@/definition/User";
import { ROLE } from "@/definition/Role";

function createUser(): Record<string, unknown> {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
  };
}

describe("isUser", () => {
  it("accepts a complete user object", () => {
    expect(isUser(createUser())).toBe(true);
  });

  it("accepts an inactive user object", () => {
    expect(isUser({ ...createUser(), isActive: false })).toBe(true);
  });

  it("accepts every documented role", () => {
    expect(isUser({ ...createUser(), role: ROLE.MANAGER })).toBe(true);
    expect(isUser({ ...createUser(), role: ROLE.EMPLOYEE })).toBe(true);
  });

  it("accepts a user with additional unknown properties", () => {
    expect(isUser({ ...createUser(), extra: "ignored" })).toBe(true);
  });

  it("accepts unicode display names", () => {
    expect(
      isUser({ ...createUser(), displayName: "Müller 🚀", id: "user-2" }),
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
    expect(
      isUser({
        displayName: "Admin",
        isActive: true,
        role: ROLE.ADMIN,
        username: "admin",
      }),
    ).toBe(false);
  });

  it("rejects a user without a username", () => {
    expect(
      isUser({
        displayName: "Admin",
        id: "user-1",
        isActive: true,
        role: ROLE.ADMIN,
      }),
    ).toBe(false);
  });

  it("rejects a user without a display name", () => {
    expect(
      isUser({
        id: "user-1",
        isActive: true,
        role: ROLE.ADMIN,
        username: "admin",
      }),
    ).toBe(false);
  });

  it("rejects a user without a role", () => {
    expect(
      isUser({
        displayName: "Admin",
        id: "user-1",
        isActive: true,
        username: "admin",
      }),
    ).toBe(false);
  });

  it("rejects a user with an unsupported role", () => {
    expect(isUser({ ...createUser(), role: "owner" })).toBe(false);
    expect(isUser({ ...createUser(), role: "project_manager" })).toBe(false);
  });

  it("rejects a user without an active flag", () => {
    expect(
      isUser({
        displayName: "Admin",
        id: "user-1",
        role: ROLE.ADMIN,
        username: "admin",
      }),
    ).toBe(false);
  });

  it("rejects a user with a non-boolean active flag", () => {
    expect(isUser({ ...createUser(), isActive: "yes" })).toBe(false);
    expect(isUser({ ...createUser(), isActive: 1 })).toBe(false);
  });

  it.each([
    [{ ...createUser(), id: 1 }],
    [{ ...createUser(), username: 7 }],
    [{ ...createUser(), displayName: null }],
    [{ ...createUser(), username: undefined }],
    [{ ...createUser(), displayName: ["Admin"] }],
    [{ ...createUser(), username: { value: "admin" } }],
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

import { expect, it, vi } from "vitest";

it("permits exactly one owner initialization per process", async () => {
  vi.resetModules();
  const mode = await import("@/backend/agents/local/LocalSessionMode");
  expect(mode.isLocalSessionOwner()).toBe(false);
  expect(mode.localSessionOwnerDirectory()).toBeNull();
  mode.enterLocalSessionOwner("/private/owner");
  expect(mode.isLocalSessionOwner()).toBe(true);
  expect(mode.localSessionOwnerDirectory()).toBe("/private/owner");
  expect(() => mode.enterLocalSessionOwner("/other")).toThrow(
    "already initialized",
  );
  expect(mode.localSessionOwnerDirectory()).toBe("/private/owner");
});

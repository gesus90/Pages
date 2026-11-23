import { beforeEach, expect, it, vi } from "vitest";

import type * as LocalOwnerControl from "@/backend/agents/local/LocalOwnerControl";

async function freshControl(): Promise<typeof LocalOwnerControl> {
  vi.resetModules();
  return import("@/backend/agents/local/LocalOwnerControl");
}

beforeEach(() => {
  vi.resetModules();
});

it("reports no managed owner before a settlement is registered", async () => {
  const control = await freshControl();
  expect(await control.settleManagedLocalOwner("instance")).toBeNull();
});

it("delegates settlement to the registered boundary", async () => {
  const control = await freshControl();
  const settle = vi.fn(async () => true);
  control.registerLocalOwnerSettlement(settle);
  expect(await control.settleManagedLocalOwner("instance")).toBe(true);
  expect(settle).toHaveBeenCalledWith("instance");
});

it("reports no managed owner before an inspector is registered", async () => {
  const control = await freshControl();
  expect(control.inspectManagedLocalOwner("instance")).toBeNull();
});

it("delegates inspection to the registered view", async () => {
  const control = await freshControl();
  const inspect = vi.fn(() => "owned" as const);
  control.registerLocalOwnerInspection(inspect);
  expect(control.inspectManagedLocalOwner("instance")).toBe("owned");
  expect(inspect).toHaveBeenCalledWith("instance");
});

import { expect, it, vi } from "vitest";

import { settleOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";

import { nativeSession, owner, resourceWorld } from "./page81-resource-fixture";

vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  settleOwnedNamespace: vi.fn(),
}));

const NAMESPACE = {
  pid: 123,
  uid: 1000,
  start: 101,
  boot: "10000000-0000-4000-8000-000000000001",
};

it("persists the supervisor identity before the adapter can start its turn", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const session = await world.scheduler.open(
    owner("owned", "antigravity"),
    new AbortController().signal,
    async () => {
      await world.scheduler.registerNamespace("owned", NAMESPACE);
      expect(world.records.get("owned")?.namespace).toEqual(NAMESPACE);
      return nativeSession();
    },
  );
  await session.close();
  await world.scheduler.shutdown();
});

it.each([true, false])(
  "recovery releases the reservation only when owned supervisor exit is %s",
  async (ended) => {
    const world = resourceWorld();
    world.records.set("owned", {
      ...owner("owned", "antigravity"),
      state: "running",
      since: "2026-10-29T00:00:00.000Z",
      namespace: NAMESPACE,
    });
    vi.mocked(settleOwnedNamespace).mockResolvedValueOnce(ended);
    await world.scheduler.recover();
    expect(world.cleanup).not.toHaveBeenCalled();
    expect(world.records.has("owned")).toBe(!ended);
    if (!ended)
      expect(world.records.get("owned")?.state).toBe("cleanup_failed");
    await world.scheduler.shutdown();
  },
);

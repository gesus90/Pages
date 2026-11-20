import { expect, it, vi } from "vitest";

import { RemoteSession } from "./RemoteSession";
import { RemoteSessionRegistry } from "./RemoteSessionRegistry";

function createSession(): RemoteSession {
  return new RemoteSession({
    client: { openMaster: vi.fn() },
    target: () => Promise.reject(new Error("unexpected connection")),
    record: vi.fn(),
  });
}

it("creates one session per connection and resets it", async () => {
  const create = vi.fn(createSession);
  const registry = new RemoteSessionRegistry(create);
  expect(registry.view("first").status).toBe("idle");
  const first = registry.session("first");
  expect(registry.session("first")).toBe(first);
  expect(registry.view("first")).toEqual(first.view());
  const close = vi.spyOn(first, "close");
  await registry.reset("first");
  expect(close).toHaveBeenCalledOnce();
  await registry.reset("missing");
  expect(registry.session("first")).not.toBe(first);
  expect(create).toHaveBeenCalledTimes(2);
  await registry.shutdown();
});

it("closes all sessions even if one close fails", async () => {
  const registry = new RemoteSessionRegistry(createSession);
  const first = registry.session("first");
  const second = registry.session("second");
  vi.spyOn(first, "close").mockRejectedValue(new Error("close failed"));
  const closeSecond = vi.spyOn(second, "close");
  await registry.shutdown();
  expect(closeSecond).toHaveBeenCalledOnce();
  expect(registry.session("first")).not.toBe(first);
  await registry.shutdown();
});

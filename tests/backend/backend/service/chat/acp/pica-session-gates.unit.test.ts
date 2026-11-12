import { expect, it, vi } from "vitest";

import { PicaAcpSessionGates } from "@/backend/service/chat/acp/PicaAcpSessionGates";

import { deferred } from "../../agents/page81-resource-fixture";

it("serializes one conversation while another runs independently and retains pending gates", async () => {
  const gates = new PicaAcpSessionGates();
  const first = deferred<string>();
  const order: string[] = [];
  const running = gates.run(
    "one",
    () => first.promise,
    () => false,
  );
  const queued = gates.run(
    "one",
    async () => {
      order.push("second");
      return "second";
    },
    () => false,
  );
  const other = gates.run(
    "two",
    async () => {
      order.push("other");
      return "other";
    },
    () => false,
  );
  gates.release("one");
  expect(await other).toBe("other");
  expect(order).toEqual(["other"]);
  expect(gates.size).toBe(2);
  first.resolve("first");
  expect(await running).toBe("first");
  expect(await queued).toBe("second");
  expect(order).toEqual(["other", "second"]);
  gates.release("one");
  gates.release("missing");
  expect(gates.size).toBe(1);
});

it("sweeps only idle, settled and non-busy conversations at the sweep interval", async () => {
  let now = 60_000;
  const gates = new PicaAcpSessionGates({
    idleMilliseconds: 1_000,
    now: () => now,
  });
  const pending = deferred<void>();
  const busy = vi.fn((id: string) => id === "busy");
  await gates.run("idle", async () => undefined, busy);
  await gates.run("busy", async () => undefined, busy);
  const running = gates.run("pending", () => pending.promise, busy);
  now += 59_999;
  gates.sweep(busy);
  expect(gates.size).toBe(3);
  now += 1;
  gates.sweep(busy);
  expect(gates.size).toBe(2);
  expect(busy).toHaveBeenCalledWith("idle");
  expect(busy).toHaveBeenCalledWith("busy");
  expect(busy).not.toHaveBeenCalledWith("pending");
  pending.resolve();
  await running;
  now += 60_000;
  gates.sweep(() => false);
  expect(gates.size).toBe(0);
});

it("releases a rejected task and continues the queue", async () => {
  const gates = new PicaAcpSessionGates();
  const failed = gates.run(
    "one",
    async () => {
      throw new Error("failure");
    },
    () => false,
  );
  const next = gates.run(
    "one",
    async () => "recovered",
    () => false,
  );
  await expect(failed).rejects.toThrow("failure");
  await expect(next).resolves.toBe("recovered");
  gates.release("one");
  expect(gates.size).toBe(0);
});

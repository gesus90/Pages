import { EventEmitter } from "node:events";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { runStep } from "@/scripts/run-browser-tests.mjs";

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: boundary.spawn,
  spawnSync: vi.fn(),
}));

let child: EventEmitter;
const OPTIONS = {
  cwd: "/work",
  env: { TMPDIR: "/disk/run/step" },
  timeoutMilliseconds: 1000,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  child = Object.assign(new EventEmitter(), { pid: 424242 });
  boundary.spawn.mockReturnValue(child);
  vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
    if (signal === 0) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    return true;
  });
});
afterEach(() => {
  vi.useRealTimers();
});

it.each(["SIGINT", "SIGTERM"] as const)(
  "forwards %s to the entire child group and waits for close",
  async (signal) => {
    const pending = runStep("checks", [], OPTIONS);
    process.emit(signal);
    expect(process.kill).toHaveBeenCalledWith(-424242, signal);
    let hasSettled = false;
    void pending.then(() => {
      hasSettled = true;
    });
    await Promise.resolve();
    expect(hasSettled).toBe(false);
    child.emit("close", null, signal);
    await expect(pending).resolves.toBe(signal === "SIGTERM" ? 143 : 130);
  },
);

it("escalates a child group that ignores termination before removing scratch", async () => {
  const pending = runStep("checks", [], OPTIONS);
  await vi.advanceTimersByTimeAsync(11_000);
  expect(process.kill).toHaveBeenCalledWith(-424242, "SIGTERM");
  expect(process.kill).toHaveBeenCalledWith(-424242, "SIGKILL");
  child.emit("close", null, "SIGKILL");
  await expect(pending).resolves.toBe(124);
});

it("never starts another process after command cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    runStep("checks", [], { ...OPTIONS, signal: controller.signal }),
  ).resolves.toBe(130);
  expect(boundary.spawn).not.toHaveBeenCalled();
});

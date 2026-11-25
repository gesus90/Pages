import { beforeEach, describe, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";

import { PeriodicValue } from "./PeriodicValue";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("PeriodicValue", () => {
  let time = 0;
  let value: PeriodicValue<number>;

  beforeEach(() => {
    vi.mocked(logCaughtError).mockClear();
    time = 0;
    value = new PeriodicValue({
      intervalMs: 100,
      component: "Test",
      now: () => time,
    });
  });

  it("answers null first and the result afterwards", async () => {
    const compute = vi.fn(async () => 5);
    expect(value.current(compute)).toBeNull();
    await flush();
    expect(value.current(compute)).toBe(5);
    expect(compute).toHaveBeenCalledOnce();
  });

  it("recomputes only after the interval and not while running", async () => {
    let finish: (next: number) => void = () => undefined;
    const compute = vi.fn(
      () => new Promise<number>((resolve) => (finish = resolve)),
    );
    value.current(compute);
    time = 500;
    value.current(compute);
    expect(compute).toHaveBeenCalledOnce();
    finish(1);
    await flush();
    time = 550;
    value.current(compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous result for null and failures", async () => {
    value.current(async () => 1);
    await flush();
    time = 100;
    value.current(async () => null);
    await flush();
    time = 200;
    const error = new Error("boom");
    expect(
      value.current(async () => {
        throw error;
      }),
    ).toBe(1);
    await flush();
    expect(logCaughtError).toHaveBeenCalledWith("Test", error);
    expect(value.current(async () => null)).toBe(1);
  });
});

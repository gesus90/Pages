import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SystemLoadSampler } from "./SystemLoadSampler";

import type { LoadReading } from "./SystemLoadSampler";

import type { SystemSources } from "./SystemSources";

type Files = Record<string, string | null>;

function sourcesOf(
  files: () => Files,
  directories: () => Record<string, readonly string[]>,
  clock: () => number,
): SystemSources {
  return {
    readText: async (path) => files()[path] ?? null,
    listDirectory: async (path) => directories()[path] ?? [],
    probeFileSystem: () => ({ finished: Promise.resolve(null), stop: vi.fn() }),
    measureDirectory: async () => null,
    now: clock,
    userId: null,
  };
}

function stat(busy: number, idle: number): string {
  return `cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 1 0 0 1 0 0 0 0 0 0\ncpu1 1 0 0 1 0 0 0 0 0 0\n`;
}

const MEMINFO =
  "MemTotal: 1000 kB\nMemAvailable: 2000 kB\nSwapTotal: 100 kB\nSwapFree: 40 kB\n";

let time = 0;
let files: Files = {};
let directories: Record<string, readonly string[]> = {};

function sampler(): SystemLoadSampler {
  return new SystemLoadSampler(
    sourcesOf(
      () => files,
      () => directories,
      () => time,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  time = 1_000_000;
  directories = {};
  files = {
    "/proc/stat": stat(10, 90),
    "/proc/vmstat": "pswpin 1\npswpout 2\n",
    "/proc/meminfo": MEMINFO,
    "/proc/loadavg": "0.5 0.4 0.3 1/2 3\n",
    "/proc/uptime": "100.4 50\n",
  };
});
afterEach(() => {
  vi.useRealTimers();
});

async function readFirst(instance: SystemLoadSampler): Promise<LoadReading> {
  const pending = instance.read();
  await vi.advanceTimersByTimeAsync(250);
  return pending;
}

describe("SystemLoadSampler counters", () => {
  it("measures all tiles with a short window for the first reading", async () => {
    const instance = sampler();
    const pending = instance.read();
    files["/proc/stat"] = stat(30, 170);
    await vi.advanceTimersByTimeAsync(250);
    const reading = await pending;
    expect(reading.processor).toEqual({
      usage: 0.2,
      load: 0.5,
      cores: 2,
      temperature: null,
    });
    expect(reading.memory).toEqual({ total: 1024000, available: 1024000 });
    expect(reading.swap).toEqual({
      total: 102400,
      used: 61440,
      isSwapping: false,
    });
    expect(reading.serverStartedAt).toBe(900_000);
  });

  it("uses a recent previous reading as the first one", async () => {
    const instance = sampler();
    await readFirst(instance);
    time += 1000;
    files["/proc/stat"] = stat(110, 90);
    files["/proc/vmstat"] = "pswpin 5\npswpout 2\n";
    const reading = await instance.read();
    expect(reading.processor.usage).toBe(1);
    expect(reading.swap?.isSwapping).toBe(true);
  });

  it("takes a new pair when the previous reading is too old", async () => {
    const instance = sampler();
    await readFirst(instance);
    time += 60_000;
    expect((await readFirst(instance)).processor.usage).toBeNull();
  });

  it("handles missing and malformed sources", async () => {
    files = {
      "/proc/stat": "cpu 1 2 3\n",
      "/proc/vmstat": "pswpin 1\n",
      "/proc/meminfo":
        "MemTotal: 0 kB\nMemAvailable: 0 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n",
      "/proc/loadavg": "abc",
      "/proc/uptime": "-5 0",
    };
    const reading = await readFirst(sampler());
    expect(reading).toEqual({
      processor: { usage: null, load: null, cores: 0, temperature: null },
      memory: null,
      swap: null,
      serverStartedAt: null,
    });
  });

  it("counts no cores without per-core lines", async () => {
    files["/proc/stat"] = "cpu 1 0 0 1 0 0 0 0\n";
    expect((await readFirst(sampler())).processor.cores).toBe(0);
  });

  it("handles entirely absent files and incomplete meminfo", async () => {
    files = {};
    const empty = await readFirst(sampler());
    expect(empty.memory).toBeNull();
    expect(empty.swap).toBeNull();
    expect(empty.processor.load).toBeNull();
    files = { "/proc/meminfo": "MemTotal: 5 kB\n", "/proc/stat": "x\n" };
    const partial = await readFirst(sampler());
    expect(partial.memory).toBeNull();
    expect(partial.swap).toBeNull();
    files = {
      "/proc/meminfo": "SwapTotal: 5 kB\nMemTotal: 5 kB\nMemAvailable: 1 kB\n",
    };
    expect((await readFirst(sampler())).swap).toBeNull();
  });

  it("reports unknown swapping without counters and no usage without delta", async () => {
    files["/proc/vmstat"] = null;
    const reading = await readFirst(sampler());
    expect(reading.swap?.isSwapping).toBeNull();
    expect(reading.processor.usage).toBeNull();
    files["/proc/vmstat"] = "pswpout 1\n";
    expect((await readFirst(sampler())).swap?.isSwapping).toBeNull();
  });
});

describe("SystemLoadSampler temperature", () => {
  it("finds the package thermal zone", async () => {
    directories = {
      "/sys/class/thermal": ["cooling0", "thermal_zone10", "thermal_zone2"],
    };
    files["/sys/class/thermal/thermal_zone2/type"] = "acpitz\n";
    files["/sys/class/thermal/thermal_zone10/type"] = "x86_pkg_temp\n";
    files["/sys/class/thermal/thermal_zone10/temp"] = "45678\n";
    const instance = sampler();
    expect((await readFirst(instance)).processor.temperature).toBe(45.7);
    time += 1000;
    expect((await instance.read()).processor.temperature).toBe(45.7);
  });

  it("falls back to hwmon and looks again when the sensor disappears", async () => {
    directories = {
      "/sys/class/thermal": ["thermal_zone0"],
      "/sys/class/hwmon": ["hwmon1", "hwmon0"],
    };
    files["/sys/class/thermal/thermal_zone0/type"] = null;
    files["/sys/class/hwmon/hwmon0/name"] = "nvme\n";
    files["/sys/class/hwmon/hwmon1/name"] = "coretemp\n";
    files["/sys/class/hwmon/hwmon1/temp1_input"] = "50000";
    const instance = sampler();
    expect((await readFirst(instance)).processor.temperature).toBe(50);
    time += 1000;
    files["/sys/class/hwmon/hwmon1/temp1_input"] = "999999";
    expect((await instance.read()).processor.temperature).toBeNull();
    files["/sys/class/hwmon/hwmon1/temp1_input"] = null;
    time += 1000;
    expect((await instance.read()).processor.temperature).toBeNull();
  });

  it("searches a missing temperature source again only after a while", async () => {
    const instance = sampler();
    await readFirst(instance);
    directories = { "/sys/class/hwmon": ["hwmon0"] };
    files["/sys/class/hwmon/hwmon0/name"] = "k10temp";
    files["/sys/class/hwmon/hwmon0/temp1_input"] = "30000";
    time += 1000;
    expect((await instance.read()).processor.temperature).toBeNull();
    time += 300_000;
    expect((await readFirst(instance)).processor.temperature).toBe(30);
  });
});

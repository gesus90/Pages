import { afterEach, expect, it, vi } from "vitest";

import { SystemLoadSampler } from "@/backend/service/system/SystemLoadSampler";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Mock } from "vitest";
import type { LoadReading } from "@/backend/service/system/SystemLoadSampler";
import type { SystemSources } from "@/backend/service/system/SystemSources";

function sampler(
  values: Record<string, string | null>,
  directories: Record<string, string[]> = {},
): {
  sampler: SystemLoadSampler;
  listDirectory: Mock<(path: string) => Promise<string[]>>;
} {
  const readText = vi.fn(async (path: string) => values[path] ?? null);
  const listDirectory = vi.fn(async (path: string) => directories[path] ?? []);
  const sources = partial<SystemSources>({
    readText,
    listDirectory,
    now: () => Date.now(),
  });
  return { sampler: new SystemLoadSampler(sources), listDirectory };
}

async function firstRead(load: SystemLoadSampler): Promise<LoadReading> {
  const result = load.read();
  await vi.advanceTimersByTimeAsync(250);
  return result;
}

afterEach(() => vi.useRealTimers());

it("reads load, memory, swap and the preferred thermal sensor", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const { sampler: load } = sampler(
    {
      "/proc/stat": "cpu 10 0 10 80 0 0 0 0\ncpu0 1\ncpu1 1\n",
      "/proc/vmstat": "pswpin 3\npswpout 4\n",
      "/proc/meminfo":
        "MemTotal: 100 kB\nMemAvailable: 120 kB\nSwapTotal: 50 kB\nSwapFree: 20 kB\n",
      "/proc/loadavg": "1.25 0 0",
      "/proc/uptime": "10 0",
      "/sys/class/thermal/thermal_zone2/type": "x86_pkg_temp\n",
      "/sys/class/thermal/thermal_zone2/temp": "42500",
    },
    { "/sys/class/thermal": ["thermal_zone2"] },
  );
  const reading = await firstRead(load);
  expect(reading.processor).toEqual({
    usage: null,
    load: 1.25,
    cores: 2,
    temperature: 42.5,
  });
  expect(reading.memory).toEqual({ total: 102400, available: 102400 });
  expect(reading.swap).toEqual({
    total: 51200,
    used: 30720,
    isSwapping: false,
  });
  expect(reading.serverStartedAt).toBe(90000);
});

it("reports unavailable sources without inventing values and reuses the last counter sample", async () => {
  vi.useFakeTimers();
  const { sampler: load, listDirectory } = sampler({
    "/proc/stat": "cpu malformed",
    "/proc/loadavg": "-1",
    "/proc/uptime": "bad",
  });
  const reading = await firstRead(load);
  expect(reading).toEqual({
    processor: { usage: null, load: null, cores: 0, temperature: null },
    memory: null,
    swap: null,
    serverStartedAt: null,
  });
  await load.read();
  expect(listDirectory).toHaveBeenCalledTimes(2);
});

it("falls back to a CPU hardware monitor and rediscovers a vanished sensor", async () => {
  vi.useFakeTimers();
  const values: Record<string, string | null> = {
    "/sys/class/hwmon/hwmon0/name": "coretemp",
    "/sys/class/hwmon/hwmon0/temp1_input": "50000",
  };
  const { sampler: load, listDirectory } = sampler(values, {
    "/sys/class/hwmon": ["hwmon0"],
  });
  expect((await firstRead(load)).processor.temperature).toBe(50);
  values["/sys/class/hwmon/hwmon0/temp1_input"] = null;
  expect((await load.read()).processor.temperature).toBeNull();
  values["/sys/class/hwmon/hwmon0/temp1_input"] = "51000";
  expect((await load.read()).processor.temperature).toBe(51);
  expect(listDirectory).toHaveBeenCalledTimes(4);
});

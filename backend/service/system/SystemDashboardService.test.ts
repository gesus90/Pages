import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";
import { PAGES_VERSION } from "@/definition/Version";

import { SystemDashboardService } from "./SystemDashboardService";

import type { SystemDashboardDependencies } from "./SystemDashboardService";
import type { SystemSources } from "./SystemSources";
import type { AgentToolView } from "@/definition/AgentTools";
import type { AccountAccess } from "@/definition/Authorization";
import type { SystemDashboard } from "@/definition/SystemDashboard";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const actor = {} as unknown as AccountAccess;
const ACP_FILE =
  "/sys/fs/cgroup/user.slice/user-7.slice/user@7.service/pages.slice/pages-acp.slice/memory.current";

function toolOf(enabled: boolean, status: string): AgentToolView {
  return { enabled, status } as unknown as AgentToolView;
}

let time = 1_700_000_000_000;
let files: Record<string, string | null> = {};
let userId: number | null = 7;
let readAcpOccupancy: SystemDashboardDependencies["readAcpOccupancy"];

function service(): SystemDashboardService {
  const sources: SystemSources = {
    readText: async (path) => files[path] ?? null,
    listDirectory: async () => [],
    probeFileSystem: () => ({
      finished: Promise.resolve(null),
      stop: vi.fn(),
    }),
    measureDirectory: async () => 2048,
    now: () => time,
    userId,
  };
  return new SystemDashboardService({
    sources,
    dataDirectory: "/data",
    readDatabaseSize: async () => 4096,
    readAcpOccupancy,
    listTools: () => [
      toolOf(true, "ready"),
      toolOf(true, "x"),
      toolOf(false, "ready"),
    ],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(logCaughtError).mockClear();
  time = 1_700_000_000_000;
  userId = 7;
  files = {
    "/proc/stat": "cpu 1 0 0 1 0 0 0 0\ncpu0 1 0 0 1 0 0 0 0\n",
    "/proc/meminfo": "MemTotal: 10 kB\nMemAvailable: 5 kB\n",
    "/proc/uptime": "10 1",
    [ACP_FILE]: "512\n",
  };
  readAcpOccupancy = async () => ({ active: 1, maximum: 2 });
});
afterEach(() => {
  vi.useRealTimers();
});

async function readDashboard(
  instance: SystemDashboardService,
): Promise<SystemDashboard> {
  const pending = instance.read(actor);
  await vi.advanceTimersByTimeAsync(250);
  return pending;
}

describe("SystemDashboardService", () => {
  it("assembles the dashboard and fills slow facts on later readings", async () => {
    const instance = service();
    const first = await readDashboard(instance);
    expect(first.agents).toEqual({ active: 1, maximum: 2, memory: 512 });
    expect(first.facts.version).toBe(PAGES_VERSION);
    expect(first.facts.build).toBeNull();
    expect(first.facts.databaseSize).toBeNull();
    time += 5000;
    const second = await readDashboard(instance);
    expect(second.facts.databaseSize).toBe(4096);
    expect(second.facts.dataDirectorySize).toBe(2048);
    expect(second.facts.tools).toEqual({ ready: 1, total: 2 });
  });

  it("shares a measurement under way and for a second after it", async () => {
    const instance = service();
    const first = instance.read(actor);
    expect(instance.read(actor)).toBe(first);
    await vi.advanceTimersByTimeAsync(250);
    await first;
    expect(instance.read(actor)).toBe(first);
    time += 1000;
    const next = instance.read(actor);
    expect(next).not.toBe(first);
    await vi.advanceTimersByTimeAsync(250);
    await next;
  });

  it("keeps sharing when a measurement fails, then measures again", async () => {
    files["/proc/uptime"] = "10 1";
    const instance = service();
    const failing = instance.read(actor);
    failing.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(250);
    await failing;
    expect(await instance.read(actor)).toBeDefined();
  });
});

describe("SystemDashboardService agents and build", () => {
  it("reports no agents when occupancy fails", async () => {
    const error = new Error("down");
    readAcpOccupancy = async () => {
      throw error;
    };
    const dashboard = await readDashboard(service());
    expect(dashboard.agents).toBeNull();
    expect(logCaughtError).toHaveBeenCalledWith(
      "SystemDashboard.agents",
      error,
    );
  });

  it("reports unknown ACP memory without user id or valid file", async () => {
    userId = null;
    expect((await readDashboard(service())).agents?.memory).toBeNull();
    userId = 7;
    files[ACP_FILE] = "max";
    expect((await readDashboard(service())).agents?.memory).toBeNull();
    files[ACP_FILE] = null;
    expect((await readDashboard(service())).agents?.memory).toBeNull();
  });

  it("includes valid deployment metadata", async () => {
    const manifest = { commit: "abcdef12", builtAt: "2026-01-02T03:04:05Z" };
    const original = files;
    const instance = new SystemDashboardService({
      sources: {
        readText: async (path) =>
          path.endsWith("deployment.json")
            ? JSON.stringify(manifest)
            : (original[path] ?? null),
        listDirectory: async () => [],
        probeFileSystem: () => ({
          finished: Promise.resolve(null),
          stop: vi.fn(),
        }),
        measureDirectory: async () => null,
        now: () => time,
        userId: null,
      },
      dataDirectory: "/data",
      readDatabaseSize: async () => 1,
      readAcpOccupancy,
      listTools: () => [],
    });
    expect((await readDashboard(instance)).facts.build).toEqual(manifest);
  });
});

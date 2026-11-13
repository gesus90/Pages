import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SystemDashboardService } from "@/backend/service/system/SystemDashboardService";
import { PAGES_VERSION } from "@/definition/Version";

import { administratorFixture } from "../../auth/account-fixture";

import type { SystemSources } from "@/backend/service/system/SystemSources";

const BUILD = {
  commit: "281a48950123456789abcdef0123456789abcdef01",
  builtAt: "2026-11-13T10:12:00+01:00",
};

function createDashboard(manifest: string | null): {
  readonly service: SystemDashboardService;
  readonly readText: ReturnType<typeof vi.fn<SystemSources["readText"]>>;
} {
  const readText = vi.fn<SystemSources["readText"]>(async (location) =>
    location.endsWith("/deployment.json") ? manifest : null,
  );
  return {
    readText,
    service: new SystemDashboardService({
      sources: {
        readText,
        listDirectory: async () => [],
        probeFileSystem: () => {
          throw new Error("No file system probes expected");
        },
        measureDirectory: async () => 1024,
        now: () => Date.now(),
        userId: null,
      },
      dataDirectory: "/synthetic/data",
      readDatabaseSize: async () => 512,
      readAcpOccupancy: async () => ({ active: 0, maximum: 4 }),
      listTools: () => [],
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

it("includes validated build metadata with the version in the shared dashboard answer", async () => {
  const { service, readText } = createDashboard(JSON.stringify(BUILD));
  const actor = administratorFixture();
  const pending = service.read(actor);
  expect(service.read(actor)).toBe(pending);
  await vi.runAllTimersAsync();
  const measurement = await pending;

  expect(measurement.facts).toMatchObject({
    version: PAGES_VERSION,
    build: BUILD,
  });
  expect(service.read(actor)).toBe(pending);
  expect(
    readText.mock.calls.filter(([location]) =>
      location.endsWith("/deployment.json"),
    ),
  ).toHaveLength(1);
});

it.each([null, "{broken"])(
  "keeps the system dashboard available without usable deployment metadata: %j",
  async (manifest) => {
    const { service } = createDashboard(manifest);
    const pending = service.read(administratorFixture());
    await vi.runAllTimersAsync();
    const measurement = await pending;

    expect(measurement.facts).toMatchObject({
      version: PAGES_VERSION,
      build: null,
    });
    expect(measurement.agents).toEqual({
      active: 0,
      maximum: 4,
      memory: null,
    });
  },
);

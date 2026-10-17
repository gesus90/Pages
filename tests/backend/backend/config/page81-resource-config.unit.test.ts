import { expect, it, vi } from "vitest";

import {
  DEFAULT_ACP_RESOURCES,
  readAcpResourceLimitSource,
  readAcpResourceOptions,
} from "@/backend/config/AcpResourceConfig";
import {
  readPagesConfig,
  writePagesConfig,
} from "@/backend/config/PagesConfig";
import { readAcpAvailableMemory } from "@/backend/service/agents/resources/AcpMemory";

import type { TomlTable } from "smol-toml";

const memory = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => memory);

it("defaults to two native processes, a 2048 MiB reserve, FIFO and five minute retention", () => {
  expect(readAcpResourceOptions({}, {})).toEqual(DEFAULT_ACP_RESOURCES);
  expect(DEFAULT_ACP_RESOURCES).toEqual({
    maxConcurrentAcpSessions: 2,
    memoryAwareScheduling: true,
    minimumAvailableMemory: 2048,
    acpIdleTimeout: 300000,
    queueDiscipline: "fifo",
  });
});

it("reads operator TOML settings and gives explicit environment overrides precedence", () => {
  const config = readPagesConfig(
    {
      maxConcurrentAcpSessions: 2,
      memoryAwareScheduling: false,
      minimumAvailableMemory: 4096,
      acpIdleTimeout: 10000,
      queueDiscipline: "fifo",
    },
    "synthetic",
  );
  expect(
    readAcpResourceOptions(config, {
      PAGES_MAX_CONCURRENT_ACP_SESSIONS: "3",
      PAGES_ACP_MEMORY_AWARE: "true",
      PAGES_ACP_MIN_AVAILABLE_MEMORY_MB: "2048",
    }),
  ).toEqual({
    maxConcurrentAcpSessions: 3,
    memoryAwareScheduling: true,
    minimumAvailableMemory: 2048,
    acpIdleTimeout: 10000,
    queueDiscipline: "fifo",
  });
  expect(writePagesConfig({}, config)).toMatchObject({
    maxConcurrentAcpSessions: 2,
    acpIdleTimeout: 10000,
  });
});

it.each([
  "-1",
  "1.5",
  "NaN",
  "",
  " ",
  "1000",
  "Infinity",
  "1e2",
  "0x2",
  "2x",
  "9007199254740992",
])("rejects an invalid concurrency override %s", (input) => {
  expect(() =>
    readAcpResourceOptions({}, { PAGES_MAX_CONCURRENT_ACP_SESSIONS: input }),
  ).toThrow();
});

it.each<TomlTable>([
  { maxConcurrentAcpSessions: "2" },
  { maxConcurrentAcpSessions: -1 },
  { maxConcurrentAcpSessions: 1.5 },
  { maxConcurrentAcpSessions: 1000 },
  { maxConcurrentAcpSessions: Number.NaN },
  { minimumAvailableMemory: "2048" },
  { memoryAwareScheduling: "true" },
  { acpIdleTimeout: 0 },
  { queueDiscipline: "priority" },
])("rejects malformed TOML settings %j", (settings) => {
  expect(() => readPagesConfig(settings, "synthetic")).toThrow();
});

it.each([0, 1, 2, 999])(
  "retains explicit TOML limit %s through serialization and restart parsing",
  (limit) => {
    const config = readPagesConfig(
      { maxConcurrentAcpSessions: limit },
      "synthetic",
    );
    const restarted = readPagesConfig(
      writePagesConfig({}, config),
      "synthetic",
    );
    expect(readAcpResourceOptions(restarted, {}).maxConcurrentAcpSessions).toBe(
      limit,
    );
    expect(readAcpResourceLimitSource(restarted, {})).toBe("config");
  },
);

it.each([0, 2, 999])(
  "accepts decimal environment limit %s and exposes only its source",
  (limit) => {
    const environment = { PAGES_MAX_CONCURRENT_ACP_SESSIONS: ` ${limit} ` };
    expect(
      readAcpResourceOptions({ maxConcurrentAcpSessions: 1 }, environment)
        .maxConcurrentAcpSessions,
    ).toBe(limit);
    expect(readAcpResourceLimitSource({}, environment)).toBe("environment");
  },
);

it("keeps omitted concurrency implicit even when another ACP setting is saved", () => {
  const config = readPagesConfig({ memoryAwareScheduling: false }, "synthetic");
  expect(config.maxConcurrentAcpSessions).toBeUndefined();
  expect(writePagesConfig({}, config).maxConcurrentAcpSessions).toBeUndefined();
  expect(readAcpResourceOptions(config, {}).maxConcurrentAcpSessions).toBe(2);
  expect(readAcpResourceLimitSource(config, {})).toBe("default");
});

it("reads MemAvailable rather than MemFree and fails closed on malformed or unreadable metrics", async () => {
  memory.readFile.mockResolvedValueOnce(
    "MemFree: 999999 kB\nMemAvailable: 2097152 kB\n",
  );
  expect(await readAcpAvailableMemory()).toBe(2048);
  memory.readFile.mockResolvedValueOnce("MemFree: 999999 kB\n");
  expect(await readAcpAvailableMemory()).toBeNull();
  memory.readFile.mockRejectedValueOnce(new Error("unreadable"));
  expect(await readAcpAvailableMemory()).toBeNull();
});

import { beforeEach, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ConfigFile } from "@/backend/config/ConfigFile";
import {
  readAcpResourceLimitSource,
  readAcpResourceOptions,
} from "@/backend/config/AcpResourceConfig";
import {
  ServerSettingsDeniedError,
  ServerSettingsService,
} from "@/backend/service/ServerSettingsService";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";

import { administratorFixture, accountFixture } from "../auth/account-fixture";
import { memoryConfigFiles } from "../config/memory-config-files";
import {
  deferred,
  nativeSession,
  owner,
  resourceWorld,
} from "./agents/page81-resource-fixture";
import { ACTOR } from "../../app/actions/action-fixtures";

vi.mock("node:fs/promises", async () =>
  (
    await import("../config/memory-config-files")
  ).memoryConfigFiles.promisesModule(),
);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const CONFIG_PATH = "/virtual/page97/config.toml";

beforeEach(() => {
  memoryConfigFiles.reset();
  memoryConfigFiles.files.set(
    CONFIG_PATH,
    'firstRun = true\nport = 3197\nmaxConcurrentAcpSessions = 1\ncustom = "preserved"\n',
  );
});

function settingsService(
  file = new ConfigFile(CONFIG_PATH),
): ServerSettingsService {
  return new ServerSettingsService(
    file,
    new PermissionService(async () => administratorFixture()),
  );
}

it.each([0, 1, 2, 999])(
  "persists limit %s in the instance config, applies it live and reloads it after restart",
  async (limit) => {
    const world = resourceWorld();
    const file = new ConfigFile(CONFIG_PATH);
    const result = await settingsService(file).updateAcpResources(
      ACTOR,
      limit,
      world.scheduler,
    );
    expect(result).toMatchObject({
      ok: true,
      resources: {
        limitSource: "config",
        options: { maxConcurrentAcpSessions: limit },
      },
    });
    const stored = await new ConfigFile(CONFIG_PATH).read();
    if (stored === null) throw new Error("Expected persisted configuration");
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toContain(
      'custom = "preserved"',
    );
    expect(stored.port).toBe(3197);
    const restarted = new AcpResourceScheduler({
      store: world.store,
      memory: world.memory,
      options: readAcpResourceOptions(stored, {}),
      limitSource: readAcpResourceLimitSource(stored, {}),
    });
    expect(restarted.snapshot().options.maxConcurrentAcpSessions).toBe(limit);
    expect(restarted.snapshot().limitSource).toBe("config");
    await world.scheduler.shutdown();
    await restarted.shutdown();
  },
);

it("leaves an existing explicit 1 untouched until an authorized change", async () => {
  const file = new ConfigFile(CONFIG_PATH);
  const stored = await file.read();
  if (stored === null) throw new Error("Expected configuration");
  expect(readAcpResourceOptions(stored, {}).maxConcurrentAcpSessions).toBe(1);
  expect(await file.read()).toEqual(stored);
});

it.each([-1, 0.5, 1000, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid server limit %s before persistence or runtime application",
  async (limit) => {
    const world = resourceWorld();
    const previous = memoryConfigFiles.files.get(CONFIG_PATH);
    expect(
      await settingsService().updateAcpResources(ACTOR, limit, world.scheduler),
    ).toEqual({ ok: false, error: "invalidSetting" });
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe(previous);
    expect(world.scheduler.snapshot().options.maxConcurrentAcpSessions).toBe(1);
    await world.scheduler.shutdown();
  },
);

it.each([{ isAdmin: false }, { mode: "role" as const }, { isActive: false }])(
  "denies a direct service write with current account restrictions %j",
  async (changes) => {
    const world = resourceWorld();
    const file = new ConfigFile(CONFIG_PATH);
    const permission = new PermissionService(async () =>
      accountFixture({ isAdmin: true, mode: "admin", ...changes }),
    );
    const previous = memoryConfigFiles.files.get(CONFIG_PATH);
    await expect(
      new ServerSettingsService(file, permission).updateAcpResources(
        ACTOR,
        2,
        world.scheduler,
      ),
    ).rejects.toBeInstanceOf(ServerSettingsDeniedError);
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe(previous);
    expect(world.scheduler.snapshot().options.maxConcurrentAcpSessions).toBe(1);
    await world.scheduler.shutdown();
  },
);

it.each([0, 2, 999])(
  "refuses apparently successful edits under environment override %s and keeps the saved value",
  async (limit) => {
    const world = resourceWorld();
    const scheduler = new AcpResourceScheduler({
      store: world.store,
      options: { maxConcurrentAcpSessions: limit },
      limitSource: "environment",
      memory: world.memory,
    });
    const previous = memoryConfigFiles.files.get(CONFIG_PATH);
    expect(
      await settingsService().updateAcpResources(ACTOR, 3, scheduler),
    ).toEqual({ ok: false, error: "environmentOverride" });
    expect(scheduler.snapshot()).toMatchObject({
      limitSource: "environment",
      options: { maxConcurrentAcpSessions: limit },
    });
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe(previous);
    expect(() => scheduler.updateMaxConcurrentAcpSessions(3)).toThrow(
      "environment",
    );
    await scheduler.shutdown();
    await world.scheduler.shutdown();
  },
);

it("keeps the old live and persisted limits after a write failure and permits a later retry", async () => {
  const world = resourceWorld();
  const previous = memoryConfigFiles.files.get(CONFIG_PATH);
  memoryConfigFiles.failures.set(
    "rename",
    new Error("synthetic write failure"),
  );
  await expect(
    settingsService().updateAcpResources(ACTOR, 2, world.scheduler),
  ).rejects.toThrow("cannot be written");
  expect(world.scheduler.snapshot().options.maxConcurrentAcpSessions).toBe(1);
  expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe(previous);
  memoryConfigFiles.failures.clear();
  expect(
    await settingsService().updateAcpResources(ACTOR, 2, world.scheduler),
  ).toMatchObject({ ok: true });
  await world.scheduler.shutdown();
});

it("does not acknowledge or apply the limit until storage confirms and then wakes the queued request", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const first = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const second = world.scheduler.open(
    owner("b"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const file = new ConfigFile(CONFIG_PATH);
  const confirmed = deferred<void>();
  const originalUpdate = file.update.bind(file);
  vi.spyOn(file, "update").mockImplementation(async (change) => {
    await confirmed.promise;
    return originalUpdate(change);
  });
  let isAcknowledged = false;
  const update = settingsService(file)
    .updateAcpResources(ACTOR, 2, world.scheduler)
    .then((result) => {
      isAcknowledged = true;
      return result;
    });
  await Promise.resolve();
  expect(isAcknowledged).toBe(false);
  expect(world.scheduler.snapshot().options.maxConcurrentAcpSessions).toBe(1);
  confirmed.resolve();
  expect(await update).toMatchObject({ ok: true });
  await (await second).close();
  await first.close();
  await world.scheduler.shutdown();
});

it("serializes concurrent administrators across request-scoped service instances without losing other config changes", async () => {
  const world = resourceWorld();
  const file = new ConfigFile(CONFIG_PATH);
  const first = settingsService(file);
  const second = settingsService(file);
  const application = vi.spyOn(
    world.scheduler,
    "updateMaxConcurrentAcpSessions",
  );
  const results = await Promise.all([
    first.updateAcpResources(ACTOR, 3, world.scheduler),
    second.updateAcpResources(
      { ...ACTOR, id: "other-admin" },
      0,
      world.scheduler,
    ),
    file.update((config) => ({ ...config, logRetentionDays: 7 })),
    first.updateAcpResources(ACTOR, 2, world.scheduler),
  ]);
  expect(results.slice(0, 2)).toMatchObject([{ ok: true }, { ok: true }]);
  expect(application.mock.calls.map(([limit]) => limit)).toEqual([3, 0, 2]);
  expect(await file.read()).toMatchObject({
    maxConcurrentAcpSessions: 2,
    logRetentionDays: 7,
  });
  expect(world.scheduler.snapshot().options.maxConcurrentAcpSessions).toBe(2);
  await world.scheduler.shutdown();
});

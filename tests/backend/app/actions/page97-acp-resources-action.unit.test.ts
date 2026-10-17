import { beforeEach, expect, it, vi } from "vitest";

import { handleUpdateAcpResources } from "@/app/lib/settings-actions/settings-acp-resources-action.server";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { ServerSettingsService } from "@/backend/service/ServerSettingsService";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";

import {
  accountFixture,
  administratorFixture,
} from "../../backend/auth/account-fixture";
import { memoryConfigFiles } from "../../backend/config/memory-config-files";
import { resourceWorld } from "../../backend/service/agents/page81-resource-fixture";
import {
  ACTOR,
  outcomeOf,
  settingsContext,
  thrownStatus,
} from "./action-fixtures";

import type { AccountOptions } from "../../backend/auth/account-fixture";
import type { FormFields } from "./action-fixtures";

vi.mock("node:fs/promises", async () =>
  (
    await import("../../backend/config/memory-config-files")
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
    "firstRun = true\nport = 3197\nmaxConcurrentAcpSessions = 1\n",
  );
});

function actionWorld(changes: AccountOptions = {}): {
  readonly world: ReturnType<typeof resourceWorld>;
  readonly file: ConfigFile;
  readonly service: ServerSettingsService;
  readonly getContext: ReturnType<typeof vi.fn>;
  readonly run: (
    fields: FormFields,
  ) => ReturnType<typeof handleUpdateAcpResources>;
} {
  const world = resourceWorld();
  const getContext = vi.fn(async () =>
    administratorFixture({ userId: ACTOR.id, ...changes }),
  );
  const file = new ConfigFile(CONFIG_PATH);
  const service = new ServerSettingsService(
    file,
    new PermissionService(getContext),
  );
  const services = {
    administrationService: { getContext },
    acpResourceScheduler: world.scheduler,
  };
  return {
    world,
    file,
    service,
    getContext,
    run: (fields) =>
      handleUpdateAcpResources(settingsContext(services, fields), service),
  };
}

it.each(["0", "2", "999"])(
  "accepts a direct authorized POST for %s and returns the confirmed global snapshot",
  async (input) => {
    const fixture = actionWorld();
    const result = await outcomeOf(
      await fixture.run({
        maxConcurrentAcpSessions: input,
        userId: "forged-user",
      }),
    );
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result).toMatchObject({
      status: 200,
      body: {
        intent: "update-acp-resources",
        ok: true,
        resources: {
          options: { maxConcurrentAcpSessions: Number(input) },
          limitSource: "config",
          active: [],
          waiting: [],
        },
      },
    });
    expect(fixture.getContext).toHaveBeenCalledWith(ACTOR.id);
    expect(fixture.getContext).not.toHaveBeenCalledWith("forged-user");
    expect(await fixture.file.read()).toMatchObject({
      maxConcurrentAcpSessions: Number(input),
    });
    await fixture.world.scheduler.shutdown();
  },
);

it.each([
  "",
  " ",
  "-1",
  "1.2",
  "1000",
  "NaN",
  "Infinity",
  "0x2",
  "1e2",
  "2oops",
])(
  "returns a useful validation error for manipulated limit %j without changing the live value",
  async (input) => {
    const fixture = actionWorld();
    expect(
      await outcomeOf(await fixture.run({ maxConcurrentAcpSessions: input })),
    ).toMatchObject({
      status: 400,
      body: { ok: false, error: "invalidSetting" },
    });
    expect(await fixture.file.read()).toMatchObject({
      maxConcurrentAcpSessions: 1,
    });
    expect(
      fixture.world.scheduler.snapshot().options.maxConcurrentAcpSessions,
    ).toBe(1);
    await fixture.world.scheduler.shutdown();
  },
);

it.each<FormFields>([
  {},
  { maxConcurrentAcpSessions: ["2", "3"] },
  { maxConcurrentAcpSessions: new File(["2"], "limit.txt") },
])("rejects missing, repeated or file-valued fields %j", async (fields) => {
  const fixture = actionWorld();
  expect(await outcomeOf(await fixture.run(fields))).toMatchObject({
    status: 400,
    body: { ok: false, error: "invalidSetting" },
  });
  expect(
    fixture.world.scheduler.snapshot().options.maxConcurrentAcpSessions,
  ).toBe(1);
  await fixture.world.scheduler.shutdown();
});

it.each([{ isAdmin: false }, { mode: "role" as const }, { isActive: false }])(
  "denies a forged direct POST with account restrictions %j before storage or scheduler inspection",
  async (changes) => {
    const fixture = actionWorld(changes);
    const inspection = vi.spyOn(fixture.world.scheduler, "snapshot");
    const before = memoryConfigFiles.files.get(CONFIG_PATH);
    expect(
      await thrownStatus(
        fixture.run({
          maxConcurrentAcpSessions: "0",
          isAdmin: "true",
          mode: "admin",
        }),
      ),
    ).toBe(403);
    expect(inspection).not.toHaveBeenCalled();
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe(before);
    await fixture.world.scheduler.shutdown();
  },
);

it("rechecks current authorization inside the serialized write", async () => {
  const fixture = actionWorld();
  fixture.getContext
    .mockResolvedValueOnce(administratorFixture())
    .mockResolvedValueOnce(accountFixture());
  expect(
    await thrownStatus(fixture.run({ maxConcurrentAcpSessions: "2" })),
  ).toBe(403);
  expect(await fixture.file.read()).toMatchObject({
    maxConcurrentAcpSessions: 1,
  });
  await fixture.world.scheduler.shutdown();
});

it("returns 409 under an environment override without persisting a misleading change", async () => {
  const fixture = actionWorld();
  const scheduler = new AcpResourceScheduler({
    store: fixture.world.store,
    options: { maxConcurrentAcpSessions: 0 },
    limitSource: "environment",
  });
  const context = settingsContext(
    {
      administrationService: { getContext: fixture.getContext },
      acpResourceScheduler: scheduler,
    },
    { maxConcurrentAcpSessions: "3" },
  );
  expect(
    await outcomeOf(await handleUpdateAcpResources(context, fixture.service)),
  ).toMatchObject({
    status: 409,
    body: { ok: false, error: "environmentOverride" },
  });
  expect(await fixture.file.read()).toMatchObject({
    maxConcurrentAcpSessions: 1,
  });
  expect(scheduler.snapshot().options.maxConcurrentAcpSessions).toBe(0);
  await scheduler.shutdown();
  await fixture.world.scheduler.shutdown();
});

it("returns an error and retains the live value when storage fails", async () => {
  const fixture = actionWorld();
  memoryConfigFiles.failures.set("rename", new Error("synthetic disk failure"));
  expect(
    await outcomeOf(await fixture.run({ maxConcurrentAcpSessions: "2" })),
  ).toMatchObject({ status: 500, body: { ok: false, error: "general" } });
  expect(
    fixture.world.scheduler.snapshot().options.maxConcurrentAcpSessions,
  ).toBe(1);
  await fixture.world.scheduler.shutdown();
});

it("never claims success or replaces the live value when runtime application fails", async () => {
  const fixture = actionWorld();
  vi.spyOn(
    fixture.world.scheduler,
    "updateMaxConcurrentAcpSessions",
  ).mockImplementationOnce(() => {
    throw new Error("synthetic runtime failure");
  });
  expect(
    await outcomeOf(await fixture.run({ maxConcurrentAcpSessions: "2" })),
  ).toMatchObject({ status: 500, body: { ok: false, error: "general" } });
  expect(
    fixture.world.scheduler.snapshot().options.maxConcurrentAcpSessions,
  ).toBe(1);
  await fixture.world.scheduler.shutdown();
});

import { beforeEach, expect, it, vi } from "vitest";

import { handleCheckAcpLeases } from "@/app/lib/settings-actions/settings-acp-resources-action.server";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { ServerSettingsService } from "@/backend/service/ServerSettingsService";

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

import type * as LoggerModule from "@/backend/logging/Logger";

vi.mock("node:fs/promises", async () =>
  (
    await import("../../backend/config/memory-config-files")
  ).memoryConfigFiles.promisesModule(),
);
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const CONFIG_PATH = "/virtual/page340/config.toml";

beforeEach(() => {
  memoryConfigFiles.reset();
  memoryConfigFiles.files.set(CONFIG_PATH, "firstRun = true\nport = 3197\n");
});

function actionWorld(changes: AccountOptions = {}): {
  readonly world: ReturnType<typeof resourceWorld>;
  readonly getContext: ReturnType<typeof vi.fn>;
  readonly preview: ReturnType<typeof vi.fn>;
  readonly cleanup: ReturnType<typeof vi.fn>;
  readonly run: (fields: FormFields) => ReturnType<typeof handleCheckAcpLeases>;
} {
  const world = resourceWorld();
  const report = {
    mode: "preview" as const,
    scope: "all" as const,
    at: "2026-11-12T20:00:00.000Z",
    counts: {
      releasable: 0,
      released: 0,
      kept_active: 0,
      kept_unproven: 0,
      check_failed: 0,
    },
    entries: [],
  };
  const preview = vi
    .spyOn(world.scheduler.leaseCleanup, "preview")
    .mockResolvedValue(report);
  const cleanup = vi
    .spyOn(world.scheduler.leaseCleanup, "cleanup")
    .mockResolvedValue({ ...report, mode: "cleanup" });
  const getContext = vi.fn(async () =>
    administratorFixture({ userId: ACTOR.id, ...changes }),
  );
  const service = new ServerSettingsService(
    new ConfigFile(CONFIG_PATH),
    new PermissionService(getContext),
  );
  const services = {
    administrationService: { getContext },
    acpResourceScheduler: world.scheduler,
  };
  return {
    world,
    getContext,
    preview,
    cleanup,
    run: (fields) =>
      handleCheckAcpLeases(settingsContext(services, fields), service),
  };
}

it("previews for an active administrator without changing anything", async () => {
  const fixture = actionWorld();

  const result = await outcomeOf(await fixture.run({ mode: "preview" }));

  expect(result).toMatchObject({
    status: 200,
    body: { intent: "check-acp-leases", ok: true, report: { mode: "preview" } },
  });
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  expect(fixture.preview).toHaveBeenCalledOnce();
  expect(fixture.cleanup).not.toHaveBeenCalled();
});

it("passes exactly the confirmed reservations to the cleanup", async () => {
  const fixture = actionWorld();

  const result = await outcomeOf(
    await fixture.run({ mode: "cleanup", instanceId: ["lease-a", "lease-b"] }),
  );

  expect(result).toMatchObject({ status: 200, body: { ok: true } });
  expect(fixture.cleanup).toHaveBeenCalledExactlyOnceWith(
    new Set(["lease-a", "lease-b"]),
  );
});

it.each<FormFields>([
  {},
  { mode: "delete-all" },
  { mode: "cleanup", instanceId: "../../etc" },
  { mode: "cleanup", instanceId: new File(["x"], "lease.txt") },
])("refuses the invalid request %j before any check", async (fields) => {
  const fixture = actionWorld();

  expect(await outcomeOf(await fixture.run(fields))).toMatchObject({
    status: 400,
    body: { ok: false, error: "invalidSelection" },
  });
  expect(fixture.preview).not.toHaveBeenCalled();
  expect(fixture.cleanup).not.toHaveBeenCalled();
});

it.each([{ isAdmin: false }, { mode: "role" as const }, { isActive: false }])(
  "denies an account with restrictions %j before any check or release",
  async (changes) => {
    const fixture = actionWorld(changes);

    expect(
      await thrownStatus(fixture.run({ mode: "cleanup", instanceId: "a" })),
    ).toBe(403);
    expect(fixture.preview).not.toHaveBeenCalled();
    expect(fixture.cleanup).not.toHaveBeenCalled();
  },
);

it("rechecks the permission in the service before releasing anything", async () => {
  const fixture = actionWorld();
  fixture.getContext
    .mockResolvedValueOnce(administratorFixture({ userId: ACTOR.id }))
    .mockResolvedValue(accountFixture());

  expect(
    await thrownStatus(fixture.run({ mode: "cleanup", instanceId: "a" })),
  ).toBe(403);
  expect(fixture.cleanup).not.toHaveBeenCalled();
});

it("answers a failed check as such without claiming a release", async () => {
  const fixture = actionWorld();
  fixture.preview.mockRejectedValue(new Error("store unavailable"));

  expect(await outcomeOf(await fixture.run({ mode: "preview" }))).toMatchObject(
    {
      status: 500,
      body: { intent: "check-acp-leases", ok: false, error: "general" },
    },
  );
});

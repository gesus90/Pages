import { expect, it, vi } from "vitest";

import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { WikiValidationError } from "@/backend/error/WikiErrors";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";

import { WikiSettingsService } from "./WikiSettingsService";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";

const actor = { id: "u1" } as unknown as User;

function serviceOf(
  allowed: boolean,
  stored: unknown = null,
): { service: WikiSettingsService; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn(async () => {});
  const repository = {
    settings: { find: vi.fn(async () => stored), save },
  } as unknown as WikiRepository;
  const permissions = {
    allows: vi.fn(async () => allowed),
  } as unknown as PermissionService;

  return { save, service: new WikiSettingsService(repository, permissions) };
}

it("returns the defaults while nothing is stored", async () => {
  await expect(serviceOf(true).service.get()).resolves.toBe(
    WIKI_SETTING_DEFAULTS,
  );
});

it("returns stored settings", async () => {
  const stored = { ...WIKI_SETTING_DEFAULTS, trashRetentionDays: 5 };

  await expect(serviceOf(true, stored).service.get()).resolves.toBe(stored);
});

it("saves valid settings", async () => {
  const { save, service } = serviceOf(true);

  await service.update(actor, WIKI_SETTING_DEFAULTS);

  expect(save).toHaveBeenCalledWith(WIKI_SETTING_DEFAULTS);
});

it("denies an actor without permission", async () => {
  const { save, service } = serviceOf(false);

  await expect(service.update(actor, WIKI_SETTING_DEFAULTS)).rejects.toThrow(
    InstanceSettingsDeniedError,
  );
  expect(save).not.toHaveBeenCalled();
});

it.each([
  { trashRetentionDays: 0 },
  { trashRetentionDays: 1.5 },
  { versionKeepLast: 100000 },
])("rejects the invalid setting %o", async (change) => {
  const { service } = serviceOf(true);

  await expect(
    service.update(actor, { ...WIKI_SETTING_DEFAULTS, ...change }),
  ).rejects.toThrow(WikiValidationError);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ConfigFile } from "@/backend/config/ConfigFile";
import {
  ServerSettingsDeniedError,
  ServerSettingsService,
} from "@/backend/service/ServerSettingsService";
import { ROLE } from "@/definition/Role";

import type { User } from "@/definition/User";

function createUser(role: User["role"]): User {
  return { displayName: "A", id: "u1", isActive: true, role, username: "a" };
}

describe("ServerSettingsService", () => {
  let directory: string;
  let configFile: ConfigFile;
  let service: ServerSettingsService;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-server-settings-"));
    configFile = new ConfigFile(path.join(directory, "config.toml"));
    service = new ServerSettingsService(configFile, new PermissionService());
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it("lets only administrators manage the server", () => {
    expect(service.canManage(createUser(ROLE.ADMIN))).toBe(true);
    expect(service.canManage(createUser(ROLE.MANAGER))).toBe(false);
  });

  it("reads the stored port or the default", async () => {
    await expect(service.readPort()).resolves.toBe(3000);

    await configFile.write({ databasePath: null, firstRun: true, port: 4100 });

    await expect(service.readPort()).resolves.toBe(4100);
  });

  it("stores a valid port and keeps the rest of the configuration", async () => {
    await configFile.write({
      databasePath: "/data/pages.duckdb",
      firstRun: false,
      port: 3000,
    });

    await expect(
      service.updatePort(createUser(ROLE.ADMIN), 8080),
    ).resolves.toBe(true);
    await expect(configFile.read()).resolves.toEqual({
      databasePath: "/data/pages.duckdb",
      firstRun: false,
      port: 8080,
    });
  });

  it("rejects invalid ports and other users", async () => {
    await expect(
      service.updatePort(createUser(ROLE.ADMIN), 70_000),
    ).resolves.toBe(false);
    await expect(
      service.updatePort(createUser(ROLE.EMPLOYEE), 8080),
    ).rejects.toThrow(ServerSettingsDeniedError);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { PicaMobileSettingsService } from "@/backend/service/mobile/PicaMobileSettingsService";
import { PicaMobileSettingsDeniedError } from "@/backend/service/mobile/PicaMobileSettingsService";

import { ACTOR } from "../../../app/actions/action-fixtures";
import { accountFixture, administratorFixture } from "../../auth/account-fixture";
import { memoryConfigFiles } from "../../config/memory-config-files";
import { createGatewayWorld, listenFailure } from "./pica-mobile-gateway-fixture";

import type { AccountAccess } from "@/definition/Authorization";
import type { GatewayWorld } from "./pica-mobile-gateway-fixture";

vi.mock("node:fs/promises", async () =>
  (
    await import("../../config/memory-config-files")
  ).memoryConfigFiles.promisesModule(),
);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

const CONFIG_PATH = "/virtual/pica-mobile/config.toml";

beforeEach(() => {
  memoryConfigFiles.reset();
  memoryConfigFiles.files.set(
    CONFIG_PATH,
    'firstRun = true\nport = 3197\ncustom = "preserved"\n',
  );
});

function serviceOn(
  world: GatewayWorld,
  account: AccountAccess = administratorFixture(),
): PicaMobileSettingsService {
  return new PicaMobileSettingsService({
    configFile: new ConfigFile(CONFIG_PATH),
    permissionService: new PermissionService(async () => account),
    gateway: world.gateway,
    readNetworkAddresses: () => ["192.168.0.52"],
  });
}

function storedConfig(): string {
  return memoryConfigFiles.files.get(CONFIG_PATH) ?? "";
}

describe("reading", () => {
  it("reports an instance without a port as not configured", async () => {
    const view = await serviceOn(createGatewayWorld()).read(ACTOR, "localhost");

    expect(view).toEqual({
      port: null,
      isListening: false,
      listenError: null,
      host: "192.168.0.52",
    });
  });

  it("reports the stored port as listening once it is bound", async () => {
    const world = createGatewayWorld();
    const service = serviceOn(world);

    await service.updatePort(ACTOR, 3001);

    expect(await service.read(ACTOR, "pages.example.net")).toEqual({
      port: 3001,
      isListening: true,
      listenError: null,
      host: "pages.example.net",
    });
  });

  it("explains why a stored port is not bound", async () => {
    memoryConfigFiles.files.set(
      CONFIG_PATH,
      "firstRun = true\nport = 3197\npicaMobilePort = 3001\n",
    );
    const world = createGatewayWorld([{ failure: listenFailure("EADDRINUSE") }]);
    const service = serviceOn(world);

    await world.gateway.switchTo(3001, async () => undefined).catch(() => undefined);

    expect(await service.read(ACTOR, "localhost")).toMatchObject({
      port: 3001,
      isListening: false,
      listenError: "portInUse",
    });
  });

  it("does not blame the stored port for a failed attempt on another one", async () => {
    memoryConfigFiles.files.set(
      CONFIG_PATH,
      "firstRun = true\nport = 3197\npicaMobilePort = 3001\n",
    );
    const world = createGatewayWorld([{ failure: listenFailure("EACCES") }]);

    await world.gateway.switchTo(80, async () => undefined).catch(() => undefined);

    expect(await serviceOn(world).read(ACTOR, "localhost")).toMatchObject({
      port: 3001,
      listenError: "listenFailed",
    });
  });

  it.each([{ isAdmin: false }, { mode: "role" as const }, { isActive: false }])(
    "denies the settings to the account %j",
    async (changes) => {
      const service = serviceOn(
        createGatewayWorld(),
        accountFixture({ isAdmin: true, mode: "admin", ...changes }),
      );

      await expect(service.read(ACTOR, "localhost")).rejects.toBeInstanceOf(
        PicaMobileSettingsDeniedError,
      );
    },
  );
});

describe("storing a port", () => {
  it("binds the port, stores it and keeps every other key", async () => {
    const world = createGatewayWorld();

    expect(await serviceOn(world).updatePort(ACTOR, 3001)).toEqual({
      ok: true,
      port: 3001,
    });

    expect(world.gateway.port).toBe(3001);
    expect(storedConfig()).toContain("picaMobilePort = 3001");
    expect(storedConfig()).toContain('custom = "preserved"');
    expect(storedConfig()).toContain("port = 3197");
  });

  it("loads the stored port again after a restart", async () => {
    await serviceOn(createGatewayWorld()).updatePort(ACTOR, 3001);

    const restarted = await new ConfigFile(CONFIG_PATH).read();

    expect(restarted?.picaMobilePort).toBe(3001);
  });

  it.each([0, -1, 65_536, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the port %s without touching the listener or the file",
    async (port) => {
      const world = createGatewayWorld();
      const before = storedConfig();

      expect(await serviceOn(world).updatePort(ACTOR, port)).toEqual({
        ok: false,
        error: "invalidPort",
      });

      expect(world.listeners).toHaveLength(0);
      expect(storedConfig()).toBe(before);
    },
  );

  it.each([
    ["EADDRINUSE", "portInUse"],
    ["EACCES", "permissionDenied"],
    ["EINVAL", "listenFailed"],
  ] as const)(
    "keeps the working setting when binding fails with %s",
    async (code, error) => {
      const world = createGatewayWorld([{}, { failure: listenFailure(code) }]);
      const service = serviceOn(world);

      await service.updatePort(ACTOR, 3001);
      const before = storedConfig();

      expect(await service.updatePort(ACTOR, 3002)).toEqual({ ok: false, error });

      expect(world.gateway.port).toBe(3001);
      expect(storedConfig()).toBe(before);
      expect(storedConfig()).toContain("picaMobilePort = 3001");
    },
  );

  it("refuses the port of the Pages web server", async () => {
    const world = createGatewayWorld([], { reservedPort: 3197 });

    expect(await serviceOn(world).updatePort(ACTOR, 3197)).toEqual({
      ok: false,
      error: "portOfPages",
    });
    expect(storedConfig()).not.toContain("picaMobilePort");
  });

  it("keeps the previous listener when the file cannot be written", async () => {
    const world = createGatewayWorld();
    const service = serviceOn(world);

    await service.updatePort(ACTOR, 3001);
    memoryConfigFiles.failures.set("rename", new Error("disk full"));

    await expect(service.updatePort(ACTOR, 3002)).rejects.toThrow();

    expect(world.gateway.port).toBe(3001);
    expect(world.listeners[1].close).toHaveBeenCalledTimes(1);
    expect(storedConfig()).toContain("picaMobilePort = 3001");
  });

  it.each([{ isAdmin: false }, { mode: "role" as const }, { isActive: false }])(
    "denies a direct write of the account %j before anything is bound",
    async (changes) => {
      const world = createGatewayWorld();
      const service = serviceOn(
        world,
        accountFixture({ isAdmin: true, mode: "admin", ...changes }),
      );
      const before = storedConfig();

      await expect(service.updatePort(ACTOR, 3001)).rejects.toBeInstanceOf(
        PicaMobileSettingsDeniedError,
      );

      expect(world.listeners).toHaveLength(0);
      expect(storedConfig()).toBe(before);
    },
  );
});

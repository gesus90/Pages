import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { action, loader } from "@/app/routes/settings-connections";

import { ACTOR } from "../actions/action-fixtures";
import { routeArguments } from "../server-lib/route-arguments";
import {
  accountFixture,
  administratorFixture,
} from "../../backend/auth/account-fixture";
import { memoryConfigFiles } from "../../backend/config/memory-config-files";
import {
  createGatewayWorld,
  listenFailure,
} from "../../backend/service/mobile/pica-mobile-gateway-fixture";

import type * as AuthServer from "@/app/lib/auth.server";
import type { AccountAccess } from "@/definition/Authorization";
import type { PicaMobileGateway } from "@/backend/service/mobile/PicaMobileGateway";
import type { GatewayWorld } from "../../backend/service/mobile/pica-mobile-gateway-fixture";

const world = vi.hoisted(
  (): {
    account: AccountAccess | null;
    gateway: PicaMobileGateway | null;
  } => ({ account: null, gateway: null }),
);

function currentAccount(): AccountAccess {
  if (world.account === null) {
    throw new Error("The test set no account.");
  }

  return world.account;
}

vi.mock("node:fs/promises", async () =>
  (
    await import("../../backend/config/memory-config-files")
  ).memoryConfigFiles.promisesModule(),
);
vi.mock("@/mcp/package.json", () => ({ default: { version: "9.9.9" } }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/app/lib/auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthServer>()),
  getAuthenticatedUser: vi.fn(),
}));
vi.mock("@/app/lib/services.server", async () => {
  const { PermissionService: Permissions } =
    await import("@/backend/auth/PermissionService");

  return {
    getApplicationServices: async () => ({
      administrationService: { getContext: async () => currentAccount() },
      permissionService: new Permissions(async () => currentAccount()),
      personalAgentTokenService: { list: async () => [] },
      pairingService: { validity: async () => 30, setValidity: vi.fn() },
    }),
  };
});
vi.mock("@/backend/runtime/PagesRuntime", async () => {
  const { ConfigFile: Config } = await import("@/backend/config/ConfigFile");

  return {
    getPagesRuntime: async () => ({
      configFile: new Config("/virtual/connections/config.toml"),
      getConfig: () => ({}),
    }),
  };
});
vi.mock("@/backend/runtime/PicaMobileRuntime", () => ({
  obtainPicaMobileGateway: () => world.gateway,
}));

const CONNECTIONS_URL = "http://pages.invalid/settings/connections";
const CONFIG_PATH = "/virtual/connections/config.toml";

let gatewayWorld: GatewayWorld;

beforeEach(() => {
  memoryConfigFiles.reset();
  memoryConfigFiles.files.set(CONFIG_PATH, "firstRun = true\nport = 3197\n");
  gatewayWorld = createGatewayWorld();
  world.gateway = gatewayWorld.gateway;
  world.account = administratorFixture();
  vi.mocked(getAuthenticatedUser).mockResolvedValue(ACTOR);
});

function setAccount(account: AccountAccess): void {
  world.account = account;
}

function post(
  fields: Record<string, string>,
  origin = "http://pages.invalid",
): Promise<Response> {
  return action(
    routeArguments(
      new Request(CONNECTIONS_URL, {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams(fields),
      }),
      ACTOR,
      {},
    ),
  );
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

describe("loader", () => {
  it("hands an administrator in the admin mode the Pica Mobile settings", async () => {
    const response = await loader(
      routeArguments(
        new Request("http://192.168.0.9:3000/settings/connections"),
        ACTOR,
        {},
      ),
    );
    const view = (await json(response)) as { picaMobile?: unknown };

    expect(view.picaMobile).toEqual({
      port: null,
      isListening: false,
      listenError: null,
      host: "192.168.0.9",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    [
      "an administrator in the role mode",
      administratorFixture({ mode: "role" }),
    ],
    ["an employee", accountFixture({ userId: "actor" })],
    ["a deactivated administrator", administratorFixture({ isActive: false })],
  ])("keeps the settings from %s", async (_, account) => {
    setAccount(account);

    const view = (await json(
      await loader(routeArguments(new Request(CONNECTIONS_URL), ACTOR, {})),
    )) as Record<string, unknown>;

    expect(view).not.toHaveProperty("picaMobile");
    expect(view).toHaveProperty("validityDays", 30);
  });

  it("refuses a request without a session with 401", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const thrown: unknown = await loader(
      routeArguments(new Request(CONNECTIONS_URL), ACTOR, {}),
    ).catch((error: unknown) => error);

    if (!(thrown instanceof Response)) {
      throw new Error("Expected the loader to throw a response.");
    }

    expect(thrown.status).toBe(401);
    expect(await json(thrown)).toEqual({ error: "access_denied" });
  });
});

describe("saving the port", () => {
  it("binds and stores the port and answers with it", async () => {
    const response = await post({
      intent: "update-pica-mobile-port",
      port: "3001",
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      picaMobile: { ok: true, port: 3001 },
    });
    expect(gatewayWorld.gateway.port).toBe(3001);
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toContain(
      "picaMobilePort = 3001",
    );
  });

  it.each(["", "abc", "0", "65536", "-1", "30 01", "3001.5", "1e3"])(
    "rejects the input %j before anything is bound",
    async (port) => {
      const before = memoryConfigFiles.files.get(CONFIG_PATH);
      const response = await post({ intent: "update-pica-mobile-port", port });

      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({
        picaMobile: { ok: false, error: "invalidPort" },
      });
      expect(gatewayWorld.listeners).toHaveLength(0);
      expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe(before);
    },
  );

  it("rejects a missing port", async () => {
    const response = await post({ intent: "update-pica-mobile-port" });

    expect(response.status).toBe(400);
  });

  it("explains a port that is taken and keeps the working one", async () => {
    gatewayWorld = createGatewayWorld([
      {},
      { failure: listenFailure("EADDRINUSE") },
    ]);
    world.gateway = gatewayWorld.gateway;

    await post({ intent: "update-pica-mobile-port", port: "3001" });
    const before = memoryConfigFiles.files.get(CONFIG_PATH);
    const response = await post({
      intent: "update-pica-mobile-port",
      port: "3002",
    });

    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({
      picaMobile: { ok: false, error: "portInUse" },
    });
    expect(gatewayWorld.gateway.port).toBe(3001);
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe(before);
  });

  it("reports a file that cannot be written as a general failure", async () => {
    memoryConfigFiles.failures.set("rename", new Error("disk full"));

    const response = await post({
      intent: "update-pica-mobile-port",
      port: "3001",
    });

    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({
      picaMobile: { ok: false, error: "general" },
    });
    expect(gatewayWorld.gateway.port).toBeNull();
  });
});

describe("refusing the wrong accounts", () => {
  it.each([
    ["an employee", accountFixture({ userId: "actor" })],
    [
      "an administrator in the role mode",
      administratorFixture({ mode: "role" }),
    ],
    ["a deactivated administrator", administratorFixture({ isActive: false })],
  ])("refuses %s on the server", async (_, account) => {
    setAccount(account);
    const before = memoryConfigFiles.files.get(CONFIG_PATH);

    const response = await post({
      intent: "update-pica-mobile-port",
      port: "3001",
    });

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: "access_denied" });
    expect(gatewayWorld.listeners).toHaveLength(0);
    expect(memoryConfigFiles.files.get(CONFIG_PATH)).toBe(before);
  });

  it("refuses a form posted from another origin", async () => {
    const response = await post(
      { intent: "update-pica-mobile-port", port: "3001" },
      "http://evil.invalid",
    );

    expect(response.status).toBe(403);
    expect(gatewayWorld.listeners).toHaveLength(0);
  });

  it("refuses a user without a session", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const response = await post({
      intent: "update-pica-mobile-port",
      port: "3001",
    });

    expect(response.status).toBe(401);
  });

  it("leaves the personal intents working", async () => {
    const response = await post({ intent: "set-token-duration", days: "7" });

    expect(await json(response)).toEqual({ updated: true });
  });
});

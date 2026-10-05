import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();

  return { ...actual, createServer: vi.fn() };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return { ...actual, networkInterfaces: vi.fn(() => ({})) };
});

vi.mock("@react-router/node", () => ({ createRequestListener: vi.fn() }));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  initializePagesRuntime: vi.fn(),
}));

vi.mock("@/backend/runtime/StaticAssets", () => ({
  serveStaticAsset: vi.fn(),
}));

import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

import { createRequestListener } from "@react-router/node";

import { ConfigError } from "@/backend/config/PagesConfig";
import { initializePagesRuntime } from "@/backend/runtime/PagesRuntime";
import {
  announceServer,
  createPagesRequestListener,
  listServerOrigins,
  startPagesServer,
} from "@/backend/runtime/PagesServer";
import { serveStaticAsset } from "@/backend/runtime/StaticAssets";

import type { ServerBuild } from "react-router";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

const build = {} as ServerBuild;

function createRuntime(options: {
  readonly token?: string | null;
  readonly port?: number;
  readonly update?: ReturnType<typeof vi.fn>;
}): PagesRuntime {
  return {
    configFile: { update: options.update ?? vi.fn().mockResolvedValue({}) },
    getConfig: () => ({
      databasePath: null,
      firstRun: true,
      port: options.port ?? 3000,
    }),
    getSetupToken: () => options.token ?? null,
  } as unknown as PagesRuntime;
}

/** A server double that fails or succeeds to listen. */
class FakeServer extends EventEmitter {
  public listenedPort: number | null = null;
  private readonly failure: unknown;

  public constructor(failure: unknown = null) {
    super();
    this.failure = failure;
  }

  public listen(port: number, onListening: () => void): this {
    this.listenedPort = port;

    if (this.failure === null) {
      onListening();
    } else {
      this.emit("error", this.failure);
    }

    return this;
  }
}

function useServer(server: FakeServer): void {
  vi.mocked(createServer).mockReturnValue(server as never);
}

describe("listServerOrigins", () => {
  it("lists localhost and external IPv4 addresses", () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [
        { address: "192.168.1.5", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      wifi: undefined,
    } as never);

    expect(listServerOrigins(4000)).toEqual([
      "http://localhost:4000",
      "http://192.168.1.5:4000",
    ]);
  });
});

describe("announceServer", () => {
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints only the addresses of a finished setup", () => {
    announceServer(createRuntime({}), ["http://localhost:3000"]);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "[pages] Pages is running at http://localhost:3000.",
    );
  });

  it("prints one setup link per address while the setup is pending", () => {
    announceServer(createRuntime({ token: "secret" }), [
      "http://localhost:3000",
      "http://10.0.0.2:3000",
    ]);

    expect(info).toHaveBeenCalledWith(
      "[pages]   http://localhost:3000/setup?token=secret",
    );
    expect(info).toHaveBeenCalledWith(
      "[pages]   http://10.0.0.2:3000/setup?token=secret",
    );
  });
});

describe("createPagesRequestListener", () => {
  it("serves build files first and the application otherwise", async () => {
    const application = vi.fn();

    vi.mocked(createRequestListener).mockReturnValue(application);

    const listener = createPagesRequestListener(build, "/client");
    const request = {} as never;
    const response = {} as never;

    vi.mocked(serveStaticAsset).mockResolvedValueOnce(true);
    listener(request, response);
    await vi.waitFor(() => expect(serveStaticAsset).toHaveBeenCalledTimes(1));
    expect(application).not.toHaveBeenCalled();

    vi.mocked(serveStaticAsset).mockResolvedValueOnce(false);
    listener(request, response);
    await vi.waitFor(() =>
      expect(application).toHaveBeenCalledWith(request, response),
    );
    expect(createRequestListener).toHaveBeenCalledWith({
      build,
      mode: "production",
    });
    expect(serveStaticAsset).toHaveBeenCalledWith(request, response, "/client");
  });
});

describe("startPagesServer", () => {
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function start(argumentList: readonly string[]): Promise<number> {
    return startPagesServer({ argumentList, build, clientDirectory: "/c" });
  }

  it("explains invalid start parameters", async () => {
    await expect(start(["--port", "x"])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(initializePagesRuntime).not.toHaveBeenCalled();
  });

  it("reports an unusable configuration", async () => {
    vi.mocked(initializePagesRuntime).mockRejectedValue(
      new ConfigError("broken config"),
    );

    await expect(start(["--config", "/etc/pages.toml"])).resolves.toBe(1);
    expect(initializePagesRuntime).toHaveBeenCalledWith("/etc/pages.toml");
    expect(error).toHaveBeenCalledWith("[pages] broken config");
  });

  it("lets unexpected start failures through", async () => {
    vi.mocked(initializePagesRuntime).mockRejectedValue(new Error("boom"));

    await expect(start([])).rejects.toThrow("boom");
  });

  it("listens on the configured port and keeps the configuration", async () => {
    const update = vi.fn();
    const server = new FakeServer();

    vi.mocked(initializePagesRuntime).mockResolvedValue(
      createRuntime({ port: 4100, update }),
    );
    useServer(server);

    await expect(start([])).resolves.toBe(0);
    expect(server.listenedPort).toBe(4100);
    expect(update).not.toHaveBeenCalled();
    expect(server.listenerCount("error")).toBe(0);
  });

  it("lets --port win and stores it after listening", async () => {
    const update = vi.fn().mockResolvedValue({});
    const server = new FakeServer();

    vi.mocked(initializePagesRuntime).mockResolvedValue(
      createRuntime({ port: 3000, update }),
    );
    useServer(server);

    await expect(start(["--port", "4200"])).resolves.toBe(0);
    expect(server.listenedPort).toBe(4200);

    const change = update.mock.calls[0]?.[0] as (config: object) => object;

    expect(change({ databasePath: null, firstRun: true, port: 3000 })).toEqual({
      databasePath: null,
      firstRun: true,
      port: 4200,
    });
  });

  it("does not rewrite a --port that matches the configuration", async () => {
    const update = vi.fn();

    vi.mocked(initializePagesRuntime).mockResolvedValue(
      createRuntime({ port: 4200, update }),
    );
    useServer(new FakeServer());

    await expect(start(["--port", "4200"])).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps running when the port cannot be stored", async () => {
    vi.mocked(initializePagesRuntime).mockResolvedValue(
      createRuntime({ update: vi.fn().mockRejectedValue(new Error("ro")) }),
    );
    useServer(new FakeServer());

    await expect(start(["--port", "4300"])).resolves.toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      "[pages] The port 4300 could not be stored.",
      expect.any(Error),
    );
  });

  it.each([
    ["EADDRINUSE", "Port 4400 is already in use."],
    ["EACCES", "Port 4400 cannot be used without more privileges."],
  ])("names the port when listening fails with %s", async (code, message) => {
    const update = vi.fn();

    vi.mocked(initializePagesRuntime).mockResolvedValue(
      createRuntime({ update }),
    );
    useServer(new FakeServer(Object.assign(new Error(code), { code })));

    await expect(start(["--port", "4400"])).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(update).not.toHaveBeenCalled();
  });

  it.each([new Error("other"), "plain failure"])(
    "lets other listen failures through",
    async (failure) => {
      vi.mocked(initializePagesRuntime).mockResolvedValue(createRuntime({}));
      useServer(new FakeServer(failure));

      await expect(start([])).rejects.toBe(failure);
    },
  );
});

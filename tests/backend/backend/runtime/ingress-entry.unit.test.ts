import { beforeEach, describe, expect, it, vi } from "vitest";

import { startIngress } from "@/backend/runtime/IngressEntry";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  initialize: vi.fn(),
  retention: vi.fn(),
  log: vi.fn(),
  shutdown: vi.fn(),
  register:
    vi.fn<(task: () => Promise<void>, options: { step: string }) => void>(),
  create: vi.fn(),
  listen: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  close: vi.fn(),
  closeIdle: vi.fn(),
}));

vi.mock("@/backend/config/ConfigFile", () => ({
  ConfigFile: class {
    public read = mocks.read;
  },
}));
vi.mock("@/backend/logging/Logger", () => ({
  initializeLogging: mocks.initialize,
  updateLogRetention: mocks.retention,
  logEvent: mocks.log,
}));
vi.mock("@/backend/runtime/Ingress", () => ({
  createIngressServer: mocks.create,
}));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  installProcessLogging: vi.fn(),
  registerShutdownTask: mocks.register,
  shutdownProcess: mocks.shutdown,
}));

const required = [
  "--config",
  "/instance/config.toml",
  "--listen",
  "127.0.0.1:4100",
  "--backend",
  "http://127.0.0.1:4200",
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({
    logRetentionDays: 7,
    trustedProxies: ["10.0.0.1"],
  });
  mocks.create.mockReturnValue({
    listen: mocks.listen,
    once: mocks.once,
    off: mocks.off,
    close: mocks.close,
    closeIdleConnections: mocks.closeIdle,
  });
  mocks.listen.mockImplementation(
    (port: number, address: string, callback: () => void) => callback(),
  );
});

describe("ingress startup", () => {
  it("starts with configured proxy and optional upstreams and registers shutdown", async () => {
    await startIngress([
      ...required,
      "--core",
      "http://127.0.0.1:4300",
      "--core-runner",
      "http://127.0.0.1:4400",
    ]);

    expect(mocks.initialize).toHaveBeenCalledWith(
      "/instance/config.toml",
      "ingress",
    );
    expect(mocks.retention).toHaveBeenCalledWith(7, "startup");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: new URL("http://127.0.0.1:4200"),
        core: new URL("http://127.0.0.1:4300"),
        coreRunner: new URL("http://127.0.0.1:4400"),
        trustedProxies: ["10.0.0.1"],
      }),
    );
    expect(mocks.listen).toHaveBeenCalledWith(
      4100,
      "127.0.0.1",
      expect.any(Function),
    );
    expect(mocks.log.mock.calls).toContainEqual([
      expect.objectContaining({ event: "ingress.started" }),
    ]);
    const task = mocks.register.mock.calls[0]?.[0];
    if (!task) throw new Error("Missing shutdown task");
    await task();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.closeIdle).toHaveBeenCalledOnce();
  });
});

describe("ingress validation", () => {
  it.each([
    [],
    [...required, "--listen", "127.0.0.1:1"],
    [...required, "--unknown", "x"],
    ["--config", "relative", ...required.slice(2)],
    [
      "--config",
      "/config",
      "--listen",
      "localhost:123",
      "--backend",
      "http://localhost:42",
    ],
    [
      "--config",
      "/config",
      "--listen",
      "[::1]:0",
      "--backend",
      "http://localhost:42",
    ],
    [
      "--config",
      "/config",
      "--listen",
      "[::1]:123",
      "--backend",
      "https://localhost:42",
    ],
  ])(
    "rejects invalid arguments before creating a server: %j",
    async (...args) => {
      await startIngress(args);
      expect(mocks.shutdown).toHaveBeenCalledWith(
        1,
        "ingress_startup",
        expect.any(Error),
      );
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it("uses default settings when configuration is absent", async () => {
    mocks.read.mockResolvedValue(null);
    await startIngress(required);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ trustedProxies: [] }),
    );
    expect(mocks.log.mock.calls).toContainEqual([
      expect.objectContaining({ event: "ingress.started" }),
    ]);
  });

  it("reports configuration failures through shutdown", async () => {
    const failure = new Error("invalid config");
    mocks.read.mockRejectedValue(failure);
    await startIngress(required);
    expect(mocks.shutdown).toHaveBeenCalledWith(1, "ingress_startup", failure);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

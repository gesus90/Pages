import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  RemoteConsoleService,
  type RemoteConsoleDependencies,
  type RemoteConsoleScope,
  type RemoteConsoleSetupAccess,
} from "./RemoteConsoleService";

import type { RemoteSession } from "@/backend/remote/RemoteSession";
import type { RemoteConsoleTarget } from "./RemoteConsoleSession";
import type { StoredConsoleSession } from "@/backend/database/repositories/remote/RemoteConsoleSessionRepository";
import type {
  RemoteConsoleEvent,
  RemoteConsoleState,
} from "@/definition/RemoteConsole";

const fakes = vi.hoisted(() => {
  class FakeConsole {
    public status = "connecting";
    public listener: ((event: RemoteConsoleEvent) => void) | null = null;
    public readonly close = vi.fn();
    public readonly target: () => Promise<unknown>;
    public readonly size: { columns: number; rows: number };
    public readonly restored?: { lastSequence: number; attempts: number };
    /** Records the arguments of the console the service builds. */
    public constructor(
      target: () => Promise<unknown>,
      size: { columns: number; rows: number },
      restored?: { lastSequence: number; attempts: number },
    ) {
      this.target = target;
      this.size = size;
      this.restored = restored;
      consoles.push(this);
    }
    /** Remembers the listener the service registers. */
    public follow(
      after: number,
      listener: (event: RemoteConsoleEvent) => void,
    ): () => void {
      this.listener = after > 0 ? null : listener;
      return () => undefined;
    }
    /** The state the service reads. */
    public view(): { status: string; attempts: number } {
      return { status: this.status, attempts: 2 };
    }
    /** The progress the service stores. */
    public progress(): {
      lastSequence: number;
      size: { columns: number; rows: number };
    } {
      return { lastSequence: 5, size: this.size };
    }
  }
  const consoles: FakeConsole[] = [];
  return { FakeConsole, consoles };
});

vi.mock("./RemoteConsoleSession", () => ({
  RemoteConsoleSession: fakes.FakeConsole,
  consoleMessageOf: vi.fn(() => "remote.failure.remote_failed"),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

let counter = 0;
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => `console-${++counter}`),
}));

// The setup double never touches the connection itself.
const stubSession = {} as unknown as RemoteSession;

const size = { columns: 80, rows: 24 };
const workspace: RemoteConsoleScope = { kind: "workspace", id: "w1" };
const connection: RemoteConsoleScope = { kind: "connection", id: "c1" };
const setupScope: RemoteConsoleScope = { kind: "setup", id: "c1" };

interface Rig {
  readonly dependencies: RemoteConsoleDependencies;
  readonly store: {
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    removeExpired: ReturnType<typeof vi.fn>;
  };
  readonly workspaces: {
    requireConsole: Mock<() => Promise<undefined>>;
    consoleTarget: ReturnType<typeof vi.fn>;
  };
  readonly connections: {
    requireConsole: ReturnType<typeof vi.fn>;
    consoleTarget: ReturnType<typeof vi.fn>;
  };
  readonly setup: RemoteConsoleSetupAccess & {
    requireAccess: ReturnType<typeof vi.fn>;
    requireStart: ReturnType<typeof vi.fn>;
    target: ReturnType<typeof vi.fn>;
  };
}

function rigOf(withStore = true): Rig {
  const store = {
    save: vi.fn(async () => undefined),
    find: vi.fn(async (): Promise<StoredConsoleSession | null> => null),
    remove: vi.fn(async () => undefined),
    removeExpired: vi.fn(async () => undefined),
  };
  const workspaces = {
    requireConsole: vi.fn(async () => undefined),
    consoleTarget: vi.fn(async () => ({ path: "/w" })),
  };
  const connections = {
    requireConsole: vi.fn(async () => undefined),
    consoleTarget: vi.fn(async () => ({ path: null })),
  };
  const setup = {
    requireAccess: vi.fn(async () => undefined),
    requireStart: vi.fn(async () => undefined),
    target: vi.fn(async (): Promise<RemoteConsoleTarget> => ({
      session: stubSession,
      path: "/s",
    })),
  };
  const dependencies = {
    workspaces,
    connections,
    store: withStore ? store : undefined,
  } as unknown as RemoteConsoleDependencies;
  return { dependencies, store, workspaces, connections, setup };
}

function storedOf(
  overrides: Partial<StoredConsoleSession> = {},
): StoredConsoleSession {
  return {
    id: "old",
    ownerId: "u1",
    scopeKind: "workspace",
    scopeId: "w1",
    columns: 100,
    rows: 30,
    attempts: 1,
    lastSequence: 9,
    ...overrides,
  };
}

function lastConsole(): InstanceType<typeof fakes.FakeConsole> {
  const last = fakes.consoles.at(-1);
  if (!last) throw new Error("no console");
  return last;
}

let service: RemoteConsoleService;

beforeEach(() => {
  vi.useFakeTimers();
  fakes.consoles.length = 0;
  vi.mocked(logCaughtError).mockClear();
});

afterEach(() => {
  service.shutdown();
  vi.useRealTimers();
});

describe("RemoteConsoleService open", () => {
  it("opens a stored workspace console and resolves targets per scope", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    service.attachSetup(rig.setup);
    const id = await service.open("u1", workspace, size);
    expect(rig.workspaces.requireConsole).toHaveBeenCalledWith("u1", "w1");
    expect(rig.store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        scopeKind: "workspace",
        columns: 80,
        attempts: 2,
        lastSequence: 5,
      }),
      90,
    );
    await lastConsole().target();
    expect(rig.workspaces.consoleTarget).toHaveBeenCalledWith("u1", "w1");
    await service.open("u1", connection, size);
    await lastConsole().target();
    expect(rig.connections.consoleTarget).toHaveBeenCalledWith("u1", "c1");
    await service.open("u1", setupScope, size, { origin: "https://a" });
    await lastConsole().target();
    expect(rig.setup.target).toHaveBeenCalledWith("u1", "c1", {
      origin: "https://a",
    });
    expect(rig.setup.requireStart).toHaveBeenCalledWith("u1", "c1");
    expect(rig.store.save).toHaveBeenCalledTimes(2);
  });

  it("needs the attached setup rules for a setup", async () => {
    service = new RemoteConsoleService(rigOf().dependencies);
    await expect(service.open("u1", setupScope, size)).rejects.toMatchObject({
      code: "remote_access_denied",
    });
  });

  it("refuses a second setup of the same connection", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    service.attachSetup(rig.setup);
    await service.open("u1", setupScope, size);
    expect(service.hasSetup("c1")).toBe(true);
    expect(service.hasSetup("other")).toBe(false);
    await expect(service.open("u2", setupScope, size)).rejects.toMatchObject({
      code: "remote_setup_running",
    });
    lastConsole().status = "ended";
    expect(service.hasSetup("c1")).toBe(false);
    await service.open("u2", setupScope, size);
  });
});

describe("RemoteConsoleService limits and store", () => {
  it("limits consoles per person and in total", async () => {
    const rig = rigOf(false);
    service = new RemoteConsoleService(rig.dependencies);
    for (let index = 0; index < 3; index += 1)
      await service.open("u1", workspace, size);
    await expect(service.open("u1", workspace, size)).rejects.toThrow(
      RemoteError,
    );
    for (let user = 2; user < 18; user += 1)
      for (let index = 0; index < 3; index += 1)
        if (service["entries"].size < 50)
          await service.open(`u${user}`, workspace, size);
    await expect(service.open("u99", workspace, size)).rejects.toThrow(
      RemoteError,
    );
  });

  it("does not store ended consoles and survives store failures", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    rig.store.save.mockRejectedValueOnce(new Error("db"));
    await service.open("u1", workspace, size);
    expect(logCaughtError).toHaveBeenCalled();
    lastConsole().status = "ended";
    rig.store.save.mockClear();
    const [entry] = service["entries"].values();
    if (entry) await service["store"]("x", entry);
    expect(rig.store.save).not.toHaveBeenCalled();
  });

  it("forgets a console that ended, but not on shutdown", async () => {
    const base: RemoteConsoleState = {
      status: "connecting",
      attempts: 0,
      message: null,
      exitCode: null,
      directory: null,
      setup: null,
    };
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    const id = await service.open("u1", workspace, size);
    const listener = lastConsole().listener;
    listener?.({ kind: "gap", sequence: 1 });
    listener?.({
      kind: "state",
      sequence: 2,
      state: { ...base, status: "connected" },
    });
    expect(rig.store.remove).not.toHaveBeenCalled();
    const ended: RemoteConsoleEvent = {
      kind: "state",
      sequence: 3,
      state: { ...base, status: "ended" },
    };
    listener?.(ended);
    expect(rig.store.remove).toHaveBeenCalledWith(id);
    rig.store.remove.mockClear();
    service.shutdown();
    listener?.(ended);
    expect(rig.store.remove).not.toHaveBeenCalled();
  });
});

describe("RemoteConsoleService require", () => {
  it("returns an owned console and refreshes the store lease", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    const id = await service.open("u1", connection, size);
    rig.store.save.mockClear();
    expect(await service.require("u1", connection, id)).toBe(lastConsole());
    expect(rig.store.save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16_000);
    await service.require("u1", connection, id);
    expect(rig.store.save).toHaveBeenCalledTimes(1);
  });
});

describe("RemoteConsoleService require access", () => {
  it("rejects other owners and targets", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    const id = await service.open("u1", workspace, size);
    await expect(service.require("u2", workspace, id)).rejects.toMatchObject({
      code: "remote_workspace_not_found",
    });
    await expect(
      service.require("u1", { kind: "workspace", id: "w2" }, id),
    ).rejects.toThrow(RemoteError);
    await expect(service.require("u1", connection, id)).rejects.toThrow(
      RemoteError,
    );
  });

  it("closes a console whose access was revoked", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    const id = await service.open("u1", workspace, size);
    rig.workspaces.requireConsole.mockRejectedValueOnce(new Error("revoked"));
    await expect(service.require("u1", workspace, id)).rejects.toThrow(
      "revoked",
    );
    expect(lastConsole().close).toHaveBeenCalledWith(
      "remote.failure.remote_failed",
    );
    expect(rig.store.remove).toHaveBeenCalledWith(id);
  });

  it("restores a stored console once for concurrent requests", async () => {
    const rig = rigOf();
    rig.store.find.mockResolvedValue(storedOf());
    service = new RemoteConsoleService(rig.dependencies);
    const [first, second] = await Promise.all([
      service.require("u1", workspace, "old"),
      service.require("u1", workspace, "old"),
    ]);
    expect(first).toBe(second);
    expect(fakes.consoles).toHaveLength(1);
    expect(lastConsole().restored).toEqual({ lastSequence: 9, attempts: 2 });
    expect(lastConsole().size).toEqual({ columns: 100, rows: 30 });
    await lastConsole().target();
    expect(rig.workspaces.consoleTarget).toHaveBeenCalled();
  });

  it("does not restore unknown, foreign or exhausted consoles", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    await expect(service.require("u1", workspace, "old")).rejects.toThrow(
      RemoteError,
    );
    rig.store.find.mockResolvedValue(storedOf({ ownerId: "u2" }));
    await expect(service.require("u1", workspace, "old")).rejects.toThrow(
      RemoteError,
    );
    rig.store.find.mockResolvedValue(storedOf({ attempts: 10 }));
    await expect(service.require("u1", workspace, "old")).rejects.toThrow(
      RemoteError,
    );
    await expect(service.require("u1", setupScope, "old")).rejects.toThrow(
      RemoteError,
    );
  });

  it("does not restore without a store", async () => {
    service = new RemoteConsoleService(rigOf(false).dependencies);
    await expect(service.require("u1", workspace, "old")).rejects.toThrow(
      RemoteError,
    );
  });

  it("forgets a stored console whose owner lost access", async () => {
    const rig = rigOf();
    rig.store.find.mockResolvedValue(storedOf());
    rig.workspaces.requireConsole.mockRejectedValueOnce(new Error("revoked"));
    service = new RemoteConsoleService(rig.dependencies);
    await expect(service.require("u1", workspace, "old")).rejects.toThrow(
      "revoked",
    );
    expect(rig.store.remove).toHaveBeenCalledWith("old");
  });

  it("refuses a restore over capacity", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    for (let index = 0; index < 3; index += 1)
      await service.open("u1", workspace, size);
    rig.store.find.mockResolvedValue(storedOf());
    await expect(service.require("u1", workspace, "old")).rejects.toThrow(
      RemoteError,
    );
  });

  it("uses a console that appeared while the access was checked", async () => {
    const rig = rigOf();
    rig.store.find.mockResolvedValue(storedOf({ id: "console-1" }));
    service = new RemoteConsoleService(rig.dependencies);
    counter = 0;
    rig.workspaces.requireConsole.mockImplementationOnce(() =>
      service.open("u1", workspace, size).then(() => undefined),
    );
    const session = await service.require("u1", workspace, "console-1");
    expect(session).toBe(lastConsole());
    expect(fakes.consoles).toHaveLength(1);
  });
});

describe("RemoteConsoleService close and expiry", () => {
  it("closes an owned console and rejects unknown ones", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    const id = await service.open("u1", workspace, size);
    service.close("u1", workspace, id);
    expect(lastConsole().close).toHaveBeenCalled();
    expect(rig.store.remove).toHaveBeenCalledWith(id);
    expect(() => service.close("u1", workspace, id)).toThrow(RemoteError);
  });

  it("releases a console that only the store holds", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    rig.store.find.mockResolvedValueOnce(storedOf());
    expect(() => service.close("u1", workspace, "old")).toThrow(RemoteError);
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.store.remove).toHaveBeenCalledWith("old");
    rig.store.remove.mockClear();
    rig.store.find.mockResolvedValueOnce(storedOf({ ownerId: "u2" }));
    expect(() => service.close("u1", workspace, "old")).toThrow(RemoteError);
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.store.remove).not.toHaveBeenCalled();
    rig.store.find.mockResolvedValueOnce(null);
    expect(() => service.close("u1", workspace, "old")).toThrow(RemoteError);
    rig.store.find.mockRejectedValueOnce(new Error("db"));
    expect(() => service.close("u1", workspace, "old")).toThrow(RemoteError);
    await vi.advanceTimersByTimeAsync(0);
    expect(logCaughtError).toHaveBeenCalled();
  });

  it("works without a store", async () => {
    service = new RemoteConsoleService(rigOf(false).dependencies);
    const id = await service.open("u1", workspace, size);
    expect(() => service.close("u1", workspace, "none")).toThrow(RemoteError);
    service.close("u1", workspace, id);
    vi.advanceTimersByTime(120_000);
  });

  it("logs a failing removal", async () => {
    const rig = rigOf();
    rig.store.remove.mockRejectedValue(new Error("db"));
    service = new RemoteConsoleService(rig.dependencies);
    const id = await service.open("u1", workspace, size);
    service.close("u1", workspace, id);
    await vi.advanceTimersByTimeAsync(0);
    expect(logCaughtError).toHaveBeenCalled();
  });

  it("expires abandoned consoles and logs a failing cleanup", async () => {
    const rig = rigOf();
    rig.store.removeExpired.mockRejectedValue(new Error("db"));
    service = new RemoteConsoleService(rig.dependencies);
    const id = await service.open("u1", workspace, size);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lastConsole().close).not.toHaveBeenCalled();
    await service.require("u1", workspace, id);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(lastConsole().close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lastConsole().close).toHaveBeenCalled();
    expect(rig.store.remove).toHaveBeenCalledWith(id);
    expect(logCaughtError).toHaveBeenCalled();
  });

  it("ends all shells on shutdown", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    await service.open("u1", workspace, size);
    service.shutdown();
    expect(lastConsole().close).toHaveBeenCalled();
    expect(service["entries"].size).toBe(0);
  });

  it("checks the setup access of a setup console", async () => {
    const rig = rigOf();
    service = new RemoteConsoleService(rig.dependencies);
    service.attachSetup(rig.setup);
    const id = await service.open("u1", setupScope, size);
    await service.require("u1", setupScope, id);
    expect(rig.setup.requireAccess).toHaveBeenCalledWith("u1", "c1");
  });
});

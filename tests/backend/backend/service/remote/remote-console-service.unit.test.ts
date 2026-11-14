import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { RemoteConsoleService } from "@/backend/service/remote/RemoteConsoleService";

import type {
  RemoteConsoleDependencies,
  RemoteConsoleScope,
} from "@/backend/service/remote/RemoteConsoleService";
import type { Mock } from "vitest";
import type { StoredConsoleSession } from "@/backend/database/repositories/remote/RemoteConsoleSessionRepository";

const scope: RemoteConsoleScope = { kind: "workspace", id: "workspace" };
const size = { columns: 80, rows: 24 };
const stored: StoredConsoleSession = {
  id: "saved",
  ownerId: "owner",
  scopeKind: "workspace",
  scopeId: "workspace",
  columns: 90,
  rows: 30,
  attempts: 2,
  lastSequence: 12,
};

interface Fixture {
  service: RemoteConsoleService;
  requireConsole: Mock<
    RemoteConsoleDependencies["workspaces"]["requireConsole"]
  >;
  consoleTarget: Mock<RemoteConsoleDependencies["workspaces"]["consoleTarget"]>;
  store: {
    save: Mock;
    find: Mock;
    remove: Mock;
    removeExpired: Mock;
  };
}

function fixture(): Fixture {
  const requireConsole = vi
    .fn<RemoteConsoleDependencies["workspaces"]["requireConsole"]>()
    .mockResolvedValue({
      id: "workspace",
      name: "Work",
      connectionId: "connection",
      path: "/work",
      projectId: "project",
      registeredBy: "owner",
      check: null,
      revision: 1,
    });
  const consoleTarget = vi
    .fn<RemoteConsoleDependencies["workspaces"]["consoleTarget"]>()
    .mockRejectedValue(new RemoteError("remote_access_denied"));
  const store = {
    save: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue(stored),
    remove: vi.fn().mockResolvedValue(undefined),
    removeExpired: vi.fn().mockResolvedValue(undefined),
  };
  const service = new RemoteConsoleService({
    workspaces: { requireConsole, consoleTarget },
    connections: {
      requireConsole: vi
        .fn()
        .mockRejectedValue(new RemoteError("remote_access_denied")),
      consoleTarget,
    },
    store,
  });
  return { service, requireConsole, consoleTarget, store };
}

const services: RemoteConsoleService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.shutdown();
});

function createFixture(): Fixture {
  const result = fixture();
  services.push(result.service);
  return result;
}

describe("remote console ownership and persistence", () => {
  it("opens, stores, checks ownership and closes a workspace console", async () => {
    const { service, requireConsole, store } = createFixture();
    const id = await service.open("owner", scope, size);
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        ownerId: "owner",
        scopeKind: "workspace",
        scopeId: "workspace",
        ...size,
      }),
      90,
    );
    const session = await service.require("owner", scope, id);
    expect(session).toBeDefined();
    expect(requireConsole).toHaveBeenCalledWith("owner", "workspace");
    await expect(service.require("other", scope, id)).rejects.toThrow(
      "remote_workspace_not_found",
    );
    service.close("owner", scope, id);
    expect(session.view().status).toBe("ended");
    expect(store.remove).toHaveBeenCalledWith(id);
  });

  it("restores an owned console with its saved progress and rechecks access", async () => {
    const { service, requireConsole, store } = createFixture();
    const session = await service.require("owner", scope, "saved");
    expect(session.view().attempts).toBe(3);
    expect(session.progress()).toEqual({
      lastSequence: 14,
      size: { columns: 90, rows: 30 },
    });
    expect(requireConsole).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "saved", attempts: 3 }),
      90,
    );
  });

  it("rejects a foreign saved console and removes it when access is revoked", async () => {
    const { service, requireConsole, store } = createFixture();
    await expect(service.require("other", scope, "saved")).rejects.toThrow(
      "remote_workspace_not_found",
    );
    expect(requireConsole).not.toHaveBeenCalled();
    requireConsole.mockRejectedValueOnce(
      new RemoteError("remote_access_denied"),
    );
    await expect(service.require("owner", scope, "saved")).rejects.toThrow(
      "remote_access_denied",
    );
    expect(store.remove).toHaveBeenCalledWith("saved");
  });

  it("enforces the per-user capacity and releases it on close", async () => {
    const { service } = createFixture();
    const ids = await Promise.all([
      service.open("owner", scope, size),
      service.open("owner", scope, size),
      service.open("owner", scope, size),
    ]);
    await expect(service.open("owner", scope, size)).rejects.toThrow(
      "remote_blocked",
    );
    const first = ids[0];
    if (!first) throw new Error("Missing console");
    service.close("owner", scope, first);
    await expect(service.open("owner", scope, size)).resolves.toEqual(
      expect.any(String),
    );
  });
});

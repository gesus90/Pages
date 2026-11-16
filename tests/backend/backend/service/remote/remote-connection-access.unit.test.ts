import { expect, it, vi } from "vitest";

import { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RemoteConnectionRecord } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { RemoteConnectionDependencies } from "@/backend/service/remote/RemoteConnectionService";

const RECORD = partial<RemoteConnectionRecord>({
  id: "connection",
  name: "Server",
  host: "example.test",
  port: 22,
  username: "login",
  departmentId: "team",
  revision: 4,
  hostKey: null,
  secrets: { password: null, privateKey: null, passphrase: null },
});

it("only exposes connections shared with the user's department", async () => {
  const dependencies = partial<RemoteConnectionDependencies>({
    authorization: {
      snapshot: async () => ({
        accounts: [
          {
            userId: "user",
            isActive: true,
            isAdmin: false,
            departments: ["team"],
          },
        ],
        departments: [{ id: "team", name: "Team" }],
      }),
    },
    connections: {
      list: async () => [
        RECORD,
        { ...RECORD, id: "other", departmentId: "other" },
      ],
      workspaceCounts: async () => new Map([["connection", 2]]),
      find: async (id: string) => (id === "connection" ? RECORD : null),
    },
    sessions: { view: () => null },
  });
  const service = new RemoteConnectionService(dependencies);
  await expect(service.scope("user")).resolves.toMatchObject({
    canManage: false,
    departments: [],
    connections: [
      {
        id: "connection",
        departmentName: "Team",
        workspaceCount: 2,
        storedSecrets: null,
        canOpenConsole: true,
      },
    ],
  });
  await expect(service.requireUsable("user", "connection")).resolves.toEqual(
    RECORD,
  );
  await expect(service.requireUsable("user", "other")).rejects.toMatchObject({
    code: "remote_access_denied",
  });
  await expect(
    service.requireConsole("user", "connection"),
  ).rejects.toMatchObject({ code: "remote_host_key_unconfirmed" });
  await expect(service.requireManagement("user")).rejects.toMatchObject({
    code: "remote_management_denied",
  });
});

it("probes an unconfirmed host and records connection failures against the current revision", async () => {
  const probe = vi.fn(async () => "unreachable_timeout");
  const saveCheck = vi.fn(async () => {});
  const service = new RemoteConnectionService(
    partial<RemoteConnectionDependencies>({
      connections: { find: async () => RECORD, saveCheck },
      client: { probe },
    }),
  );
  await expect(service.sessionTarget("connection")).rejects.toMatchObject({
    code: "remote_host_key_unconfirmed",
  });
  expect(probe).toHaveBeenCalledWith({ host: "example.test", port: 22 });
  await service.recordConnect("connection", "unreachable_timeout");
  expect(saveCheck).toHaveBeenCalledWith(
    "connection",
    4,
    expect.objectContaining({ code: "unreachable_timeout" }),
  );
  await expect(service.scopeForRunner("connection")).resolves.toBe(4);
});

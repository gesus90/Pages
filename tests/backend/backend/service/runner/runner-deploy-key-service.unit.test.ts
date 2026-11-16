import { describe, expect, it, vi } from "vitest";

import { RunnerDeployKeyService } from "@/backend/service/runner/RunnerDeployKeyService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";
import type { RunnerGitHubAccessService } from "@/backend/service/runner/RunnerGitHubAccessService";
import type { RunnerGitHubContext } from "@/backend/service/runner/RunnerGitHubContext";
import type { RunnerGitHubClient } from "@/definition/RunnerGitHub";

const blob = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from("ssh-ed25519"),
  Buffer.from("public"),
]);
const publicKey = `ssh-ed25519 ${blob.toString("base64")}`;
const projectId = "00000000-0000-4000-8000-000000000001";

function fixture(): {
  service: RunnerDeployKeyService;
  checkAccess: ReturnType<typeof vi.fn>;
  createKey: ReturnType<typeof vi.fn>;
  checkKey: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  const key = { id: "5", key: publicKey, title: "Runner", readOnly: true };
  const checkAccess = vi.fn().mockResolvedValue({ accessible: true });
  const createKey = vi.fn().mockResolvedValue({ key });
  const checkKey = vi.fn().mockResolvedValue({ key });
  const execute = vi.fn();
  const list = vi
    .fn()
    .mockResolvedValue([{ id: "w", projectId, connectionId: "c" }]);
  const client = partial<RunnerGitHubClient>({
    checkAccess,
    createKey,
    checkKey,
  });
  const workspaces = partial<AgentWorkspaceService>({
    requireManagement: vi.fn().mockResolvedValue(undefined),
  });
  const remote = {
    workspaces: partial<RemoteWorkspaceService>({ list }),
    connections: partial<RemoteConnectionService>({
      requireSetup: vi.fn().mockResolvedValue(undefined),
    }),
    context: partial<RunnerGitHubContext>({
      repository: vi.fn().mockResolvedValue("owner/repo"),
    }),
    access: partial<RunnerGitHubAccessService>({ execute }),
  };
  return {
    service: new RunnerDeployKeyService(client, workspaces, remote),
    checkAccess,
    createKey,
    checkKey,
    execute,
    list,
  };
}

describe("runner deploy key service", () => {
  it("registers and verifies the normalized public key", async () => {
    const { service, createKey } = fixture();
    await expect(
      service.register("u", {
        projectId,
        title: " Runner ",
        key: `${publicKey} comment`,
      }),
    ).resolves.toMatchObject({ accessible: true, key: { id: "5" } });
    expect(createKey).toHaveBeenCalledWith({
      projectId,
      title: "Runner",
      key: publicKey,
    });
  });

  it("rejects invalid keys, denied access, missing keys and verification mismatch", async () => {
    const { service, checkAccess, createKey, checkKey } = fixture();
    await expect(
      service.register("u", {
        projectId,
        title: "Runner",
        key: "ssh-ed25519 YWJj",
      }),
    ).rejects.toThrow("Invalid SSH public key");
    checkAccess.mockResolvedValueOnce({ accessible: false });
    await expect(
      service.register("u", { projectId, title: "Runner", key: publicKey }),
    ).rejects.toThrow("access denied");
    createKey.mockResolvedValueOnce({ key: null });
    await expect(
      service.register("u", { projectId, title: "Runner", key: publicKey }),
    ).rejects.toThrow("registration failed");
    checkKey.mockResolvedValueOnce({ key: null });
    await expect(
      service.register("u", { projectId, title: "Runner", key: publicKey }),
    ).rejects.toThrow("verification failed");
  });

  it("reports remote read and write access and handles unavailable probes", async () => {
    const { service, execute, list } = fixture();
    for (const [read, write, status] of [
      [false, false, "no_access"],
      [true, false, "read_only"],
      [true, true, "read_write"],
      [null, null, "unverifiable"],
    ] as const) {
      execute.mockResolvedValueOnce({
        read: { allowed: read, reason: null },
        write: { allowed: write, reason: null },
      });
      await expect(service.checkRunnerAccess("u", "w")).resolves.toMatchObject({
        accessStatus: status,
      });
    }
    execute.mockRejectedValueOnce(new Error("unavailable"));
    await expect(service.checkRunnerAccess("u", "w")).resolves.toMatchObject({
      accessStatus: "unverifiable",
      readReason: "unavailable",
    });
    list.mockResolvedValueOnce([]);
    await expect(service.checkRunnerAccess("u", "w")).rejects.toThrow(
      "workspace unavailable",
    );
  });
});

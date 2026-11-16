import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { RunnerSetupService } from "@/backend/service/runner/RunnerSetupService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Mock } from "vitest";

import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { RemoteConnectionService } from "@/backend/service/remote/RemoteConnectionService";
import type { RunnerService } from "@/backend/service/runner/RunnerService";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

function fixture(directory?: string): {
  service: RunnerSetupService;
  run: Mock<
    (
      command: string,
      timeout: number,
    ) => Promise<{ exitCode: number; stdout: string }>
  >;
  scope: ReturnType<typeof vi.fn>;
  usable: ReturnType<typeof vi.fn>;
} {
  const run = vi
    .fn<
      (
        command: string,
        timeout: number,
      ) => Promise<{ exitCode: number; stdout: string }>
    >()
    .mockResolvedValue({ exitCode: 0, stdout: "" });
  const scope = vi
    .fn()
    .mockResolvedValue({ canManage: true, connections: [{ id: "c" }] });
  const usable = vi.fn().mockResolvedValue({ revision: 1 });
  const connections = partial<RemoteConnectionService>({
    scope,
    requireUsable: usable,
    requireSetup: vi.fn().mockResolvedValue(undefined),
  });
  const sessions = partial<RemoteSessionRegistry>({
    session: vi.fn().mockReturnValue({ run }),
  });
  const runners = partial<RunnerService>({
    requireSetup: vi.fn().mockResolvedValue(undefined),
  });
  return {
    service: new RunnerSetupService({
      runners,
      connections,
      sessions,
      directory,
    }),
    run,
    scope,
    usable,
  };
}

describe("runner setup transfer", () => {
  it("validates the directory and checks administrator access", async () => {
    expect(() => fixture("../bad")).toThrow("Invalid runner setup directory");
    const { service, run, scope } = fixture("runner");
    expect(service.launchCommand()).toContain("runner/pages_setup.sh");
    await service.connect("u", "c");
    expect(run).toHaveBeenCalledWith("true", 15000);
    scope.mockResolvedValueOnce({ canManage: false, connections: [] });
    await expect(service.connect("u", "c")).rejects.toThrow(
      "administration required",
    );
    run.mockResolvedValueOnce({ exitCode: 1, stdout: "" });
    await expect(service.connect("u", "c")).rejects.toThrow(
      "SSH connection unavailable",
    );
  });

  it("transfers and verifies the exact script over a mocked session", async () => {
    const { service, run } = fixture();
    const digest = createHash("sha256").update(service.script()).digest("hex");
    run.mockImplementation(async (command: string) => ({
      exitCode: 0,
      stdout: command.includes("sha256sum") ? digest : "",
    }));
    await expect(service.transfer("u", "c")).resolves.toEqual({
      path: "~/pages_setup.sh",
      sha256: digest,
    });
    await expect(service.verify("u", "c")).resolves.toBeUndefined();
    await expect(service.makeExecutable("u", "c")).resolves.toBeUndefined();
  });

  it("rejects transfer failures, changed configuration and failed verification", async () => {
    const { service, run, usable } = fixture();
    run.mockResolvedValueOnce({ exitCode: 1, stdout: "" });
    await expect(service.transfer("u", "c")).rejects.toThrow(
      "Setup transfer failed",
    );
    const digest = createHash("sha256").update(service.script()).digest("hex");
    run.mockImplementation(async (command: string) => ({
      exitCode: 0,
      stdout: command.includes("sha256sum") ? digest : "",
    }));
    usable
      .mockResolvedValueOnce({ revision: 1 })
      .mockResolvedValueOnce({ revision: 2 });
    await expect(service.transfer("u", "c")).rejects.toThrow(
      "configuration changed",
    );
    run
      .mockResolvedValueOnce({ exitCode: 1, stdout: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "" });
    await expect(service.verify("u", "c")).rejects.toThrow();
    await expect(service.makeExecutable("u", "c")).rejects.toThrow();
  });
});

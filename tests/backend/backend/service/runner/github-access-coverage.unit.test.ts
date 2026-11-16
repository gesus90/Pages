import { afterEach, expect, it, vi } from "vitest";

import { RunnerGitHubAccessService } from "@/backend/service/runner/RunnerGitHubAccessService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerGitHubAccessCommand } from "@/definition/RunnerGitHubAccess";

afterEach(() => vi.useRealTimers());

it("correlates a probe with its repository and rejects concurrent requests", async () => {
  const requireOnline = vi.fn(async () => undefined);
  const service = new RunnerGitHubAccessService(
    partial<RunnerService>({ requireOnline, supportsGitHubAccess: () => true }),
  );
  const send = vi.fn<(request: RunnerGitHubAccessCommand) => void>();
  const detach = service.attach("connection", send);
  const pending = service.execute("user", "connection", "owner/repo");
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  const command = send.mock.calls[0]?.[0];
  if (!command) throw new Error("Expected a command");
  const reply = {
    version: 1 as const,
    type: "github-access-result" as const,
    requestId: command.requestId,
    repository: command.repository,
    read: { allowed: true, reason: "verified" },
    write: { allowed: false, reason: "denied" },
  };
  await expect(
    service.execute("user", "connection", "owner/repo"),
  ).rejects.toThrow("Runner GitHub channel unavailable");
  expect(() =>
    service.receive("connection", { ...reply, repository: "other/repo" }),
  ).toThrow("Runner repository mismatch");
  service.receive("connection", reply);
  await expect(pending).resolves.toEqual(reply);
  detach();
});

it("rejects a pending probe when the runner disconnects", async () => {
  const service = new RunnerGitHubAccessService(
    partial<RunnerService>({
      requireOnline: async () => undefined,
      supportsGitHubAccess: () => true,
    }),
  );
  const sent = vi.fn();
  const detach = service.attach("connection", sent);
  const pending = service.execute("user", "connection", "owner/repo");
  await vi.waitFor(() => expect(sent).toHaveBeenCalledOnce());
  detach();
  await expect(pending).rejects.toThrow("Runner channel closed");
});

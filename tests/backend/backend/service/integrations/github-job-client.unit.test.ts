import { describe, expect, it, vi } from "vitest";

import { GitHubJobClient } from "@/backend/service/integrations/GitHubJobClient";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { GitHubJobRepository } from "@/backend/database/repositories/integrations/GitHubJobRepository";
import type { GitHubCommand } from "@/definition/IntegrationJobs";

const command = partial<GitHubCommand>({
  operation: "project",
  actorId: "u",
  targetId: "p",
});

describe("GitHub durable job client", () => {
  it("returns validated result shapes from stored jobs", async () => {
    const enqueue = vi.fn().mockResolvedValue("job");
    const result = vi
      .fn()
      .mockResolvedValueOnce({ kind: "summary", summary: { count: 1 } })
      .mockResolvedValueOnce({ kind: "task", id: "t" })
      .mockResolvedValueOnce({ kind: "boolean", result: true })
      .mockResolvedValueOnce({ kind: "scheduled", completed: 3, failed: 1 });
    const client = new GitHubJobClient(
      partial<GitHubJobRepository>({ enqueue, result }),
    );
    await expect(client.summary(command)).resolves.toEqual({ count: 1 });
    await expect(client.task(command)).resolves.toBe("t");
    await expect(client.test(command)).resolves.toBe(true);
    await expect(client.scheduled()).resolves.toEqual({
      completed: 3,
      failed: 1,
    });
    expect(enqueue).toHaveBeenLastCalledWith(
      { operation: "scheduled" },
      "scheduled",
    );
  });

  it("rejects wrong result kinds and restores domain errors", async () => {
    const result = vi
      .fn()
      .mockResolvedValueOnce({ kind: "void" })
      .mockResolvedValueOnce({ kind: "void" })
      .mockResolvedValueOnce({ kind: "void" })
      .mockResolvedValueOnce({ kind: "error", code: "project_access" });
    const client = new GitHubJobClient(
      partial<GitHubJobRepository>({
        enqueue: vi.fn().mockResolvedValue("job"),
        result,
      }),
    );
    await expect(client.summary(command)).rejects.toThrow("summary reply");
    await expect(client.task(command)).rejects.toThrow("task reply");
    await expect(client.test(command)).rejects.toThrow("connection reply");
    await expect(client.scheduled()).rejects.toThrow();
  });

  it("enqueues publication without waiting by default", async () => {
    const enqueue = vi.fn().mockResolvedValue("job");
    const result = vi.fn();
    const client = new GitHubJobClient(
      partial<GitHubJobRepository>({ enqueue, result }),
    );
    const publish = {
      operation: "publish" as const,
      actorId: "u",
      targetId: "t",
    };
    await client.publish(publish);
    expect(enqueue).toHaveBeenCalledWith(publish);
    expect(result).not.toHaveBeenCalled();
  });
});

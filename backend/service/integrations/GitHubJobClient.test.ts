import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectNotFoundError } from "@/backend/error/ProjectErrors";

import { GitHubJobClient } from "./GitHubJobClient";

import type { Mock } from "vitest";
import type { GitHubJobRepository } from "@/backend/database/repositories/integrations/GitHubJobRepository";
import type { GitHubJobResult } from "@/definition/IntegrationJobs";

interface ClientFixture {
  readonly client: GitHubJobClient;
  readonly jobs: { enqueue: Mock; result: Mock };
}

function clientOf(
  results: readonly (GitHubJobResult | null)[],
  waitForPublication?: boolean,
): ClientFixture {
  const result = vi.fn();
  for (const entry of results) result.mockResolvedValueOnce(entry);
  const jobs = {
    enqueue: vi.fn(async () => "job-1"),
    result,
  };
  const client = new GitHubJobClient(
    jobs as unknown as GitHubJobRepository,
    waitForPublication === undefined ? undefined : { waitForPublication },
  );
  return { client, jobs };
}

const command = { operation: "project", actorId: "a", targetId: "t" } as const;
const summary = {
  pushed: 1,
  pulled: 2,
  created: 3,
  detected: 4,
  conflicts: 5,
  pullRequests: 6,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("GitHubJobClient", () => {
  it("returns a summary", async () => {
    const { client } = clientOf([{ kind: "summary", summary }]);
    await expect(client.summary(command)).resolves.toEqual(summary);
  });

  it("rejects a wrong summary reply", async () => {
    const { client } = clientOf([{ kind: "void" }]);
    await expect(client.summary(command)).rejects.toThrow("summary");
  });

  it("returns a task id", async () => {
    const { client } = clientOf([{ kind: "task", id: "x" }]);
    await expect(client.task(command)).resolves.toBe("x");
  });

  it("rejects a wrong task reply", async () => {
    const { client } = clientOf([{ kind: "void" }]);
    await expect(client.task(command)).rejects.toThrow("task");
  });

  it("returns a connection result", async () => {
    const { client } = clientOf([{ kind: "boolean", result: true }]);
    await expect(client.test(command)).resolves.toBe(true);
  });

  it("rejects a wrong connection reply", async () => {
    const { client } = clientOf([{ kind: "void" }]);
    await expect(client.test(command)).rejects.toThrow("connection");
  });

  it("enqueues a publication without waiting by default", async () => {
    const { client, jobs } = clientOf([]);
    const publish = {
      operation: "publish",
      actorId: "a",
      targetId: "t",
    } as const;
    await client.publish(publish);
    expect(jobs.enqueue).toHaveBeenCalledWith(publish);
    expect(jobs.result).not.toHaveBeenCalled();
  });

  it("waits for a publication when configured", async () => {
    const { client, jobs } = clientOf([{ kind: "void" }], true);
    await client.publish({ operation: "publish", actorId: "a", targetId: "t" });
    expect(jobs.result).toHaveBeenCalledWith("job-1");
  });

  it("returns scheduled counters", async () => {
    const { client, jobs } = clientOf([
      { kind: "scheduled", completed: 2, failed: 1 },
    ]);
    await expect(client.scheduled()).resolves.toEqual({
      completed: 2,
      failed: 1,
    });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      { operation: "scheduled" },
      "scheduled",
    );
  });

  it("rejects a wrong scheduled reply", async () => {
    const { client } = clientOf([{ kind: "void" }]);
    await expect(client.scheduled()).rejects.toThrow("scheduled");
  });

  it("restores an error reply", async () => {
    const { client } = clientOf([{ kind: "error", code: "project_missing" }]);
    await expect(client.summary(command)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it("polls until a reply arrives", async () => {
    vi.useFakeTimers();
    const { client } = clientOf([null, { kind: "task", id: "late" }]);
    const pending = client.task(command);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe("late");
  });

  it("reports a pending job after the deadline", async () => {
    vi.useFakeTimers();
    const { client, jobs } = clientOf([]);
    jobs.result.mockResolvedValue(null);
    const pending = client.task(command);
    const assertion = expect(pending).rejects.toThrow("pending");
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
  });
});

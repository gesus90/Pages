import { beforeEach, describe, expect, it, vi } from "vitest";

import { keepForCallCommit } from "@/backend/database/CallTransaction";
import { logEvent } from "@/backend/logging/Logger";

import { TaskGitHubPublisher } from "./TaskGitHubPublisher";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

vi.mock("@/backend/database/CallTransaction", () => ({
  keepForCallCommit: vi.fn(() => false),
}));
vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: vi.fn(
    async (...parameters: [string, () => Promise<void>]) => parameters[1](),
  ),
}));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });

function itemOf(githubLastError: string | null): WorkItemDetail {
  return doubleOf<WorkItemDetail>({ githubLastError, id: "w1" });
}

function setup(): {
  readonly publisher: TaskGitHubPublisher;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly history: Record<string, ReturnType<typeof vi.fn>>;
  readonly cache: Record<string, ReturnType<typeof vi.fn>>;
  readonly sync: Record<string, ReturnType<typeof vi.fn>>;
} {
  const repository = { setGitHubError: vi.fn(async () => {}) };
  const history = { recordGitHubSyncFailed: vi.fn(async () => {}) };
  const cache = { invalidateWorkItems: vi.fn() };
  const sync = { publishTaskUpdate: vi.fn(async () => {}) };
  const publisher = new TaskGitHubPublisher(
    doubleOf<TaskRepository>(repository),
    doubleOf<TaskHistoryRecorder>(history),
    doubleOf<ServerCache>(cache),
  );
  publisher.attach(doubleOf<GitHubSyncService>(sync));

  return { cache, history, publisher, repository, sync };
}

describe("TaskGitHubPublisher", () => {
  beforeEach(() => {
    vi.mocked(keepForCallCommit).mockReturnValue(false);
  });

  it("does nothing without an attached synchronization", async () => {
    const publisher = new TaskGitHubPublisher(
      doubleOf<TaskRepository>({}),
      doubleOf<TaskHistoryRecorder>({}),
      doubleOf<ServerCache>({}),
    );

    await expect(
      publisher.publish(actor, itemOf(null)),
    ).resolves.toBeUndefined();
  });

  it("publishes a clean item without touching the error state", async () => {
    const { publisher, repository, sync } = setup();

    await publisher.publish(actor, itemOf(null));

    expect(sync.publishTaskUpdate).toHaveBeenCalled();
    expect(repository.setGitHubError).not.toHaveBeenCalled();
  });

  it("clears an earlier error after a successful publication", async () => {
    const { cache, publisher, repository } = setup();

    await publisher.publish(actor, itemOf("old"));

    expect(repository.setGitHubError).toHaveBeenCalledWith("w1", null);
    expect(cache.invalidateWorkItems).toHaveBeenCalled();
  });

  it("records a failure with a truncated message", async () => {
    const { cache, history, publisher, repository, sync } = setup();
    sync.publishTaskUpdate.mockRejectedValue(new Error("e".repeat(300)));

    await publisher.publish(actor, itemOf(null));

    const message = "e".repeat(200);
    expect(repository.setGitHubError).toHaveBeenCalledWith("w1", message);
    expect(cache.invalidateWorkItems).toHaveBeenCalled();
    expect(history.recordGitHubSyncFailed).toHaveBeenCalledWith(
      actor,
      "w1",
      message,
    );
  });

  it("uses a generic message for a non-error failure and skips a repeat", async () => {
    const { publisher, repository, sync } = setup();
    sync.publishTaskUpdate.mockRejectedValue("boom");

    await publisher.publish(actor, itemOf("GitHub synchronization failed."));
    expect(repository.setGitHubError).not.toHaveBeenCalled();

    await publisher.publish(actor, itemOf(null));
    expect(repository.setGitHubError).toHaveBeenCalledWith(
      "w1",
      "GitHub synchronization failed.",
    );
  });

  it("logs when the failure cannot be stored", async () => {
    const { publisher, repository, sync } = setup();
    sync.publishTaskUpdate.mockRejectedValue(new Error("x"));
    repository.setGitHubError.mockRejectedValue(new Error("db"));

    await publisher.publish(actor, itemOf(null));

    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: "task.github_publish.failure_not_recorded",
      }),
    );
  });

  it("defers publication to the commit of an open call", async () => {
    const { publisher, sync } = setup();
    vi.mocked(keepForCallCommit).mockImplementation((effect) => {
      void effect();

      return true;
    });

    await publisher.publish(actor, itemOf(null));
    await vi.waitFor(() => expect(sync.publishTaskUpdate).toHaveBeenCalled());
  });
});

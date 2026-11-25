import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { GitHubApiError } from "@/backend/github/GitHubApiClient";

import { GitHubSyncBackoff, gitHubSyncRetryDelayMs } from "./GitHubSyncBackoff";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => mocks);

function containingText(text: string): string {
  return expect.stringContaining(text) as string;
}

function containingFields(fields: object): object {
  return expect.objectContaining(fields) as object;
}

const NOW = "2026-01-01T00:00:00.000Z";
const MINUTE = 60_000;

function setup(): {
  readonly backoff: GitHubSyncBackoff;
  readonly projectRepository: Record<string, Mock>;
} {
  const projectRepository = {
    deferNextSync: vi.fn().mockResolvedValue(undefined),
    markIntegrationDisconnected: vi.fn().mockResolvedValue(undefined),
  };
  const backoff = new GitHubSyncBackoff(
    projectRepository as unknown as ProjectRepository,
    () => NOW,
  );

  return { backoff, projectRepository };
}

function nextAt(minutes: number): string {
  return new Date(Date.parse(NOW) + minutes * MINUTE).toISOString();
}

beforeEach(() => {
  mocks.logCaughtError.mockReset();
  mocks.logDiagnostic.mockReset();
  mocks.logEvent.mockReset();
});

describe("gitHubSyncRetryDelayMs", () => {
  it("starts at one minute and doubles per failure", () => {
    expect(gitHubSyncRetryDelayMs(0)).toBe(MINUTE);
    expect(gitHubSyncRetryDelayMs(1)).toBe(MINUTE);
    expect(gitHubSyncRetryDelayMs(2)).toBe(2 * MINUTE);
    expect(gitHubSyncRetryDelayMs(4)).toBe(8 * MINUTE);
  });

  it("caps the delay at 60 minutes", () => {
    expect(gitHubSyncRetryDelayMs(7)).toBe(60 * MINUTE);
    expect(gitHubSyncRetryDelayMs(1000)).toBe(60 * MINUTE);
  });
});

describe("recordFailure", () => {
  it("defers the next sync and doubles the delay per failure", async () => {
    const { backoff, projectRepository } = setup();

    await backoff.recordFailure("project-1", new Error("boom"), null);
    await backoff.recordFailure("project-1", new Error("boom"), null);

    expect(projectRepository.deferNextSync).toHaveBeenNthCalledWith(
      1,
      "project-1",
      nextAt(1),
    );
    expect(projectRepository.deferNextSync).toHaveBeenNthCalledWith(
      2,
      "project-1",
      nextAt(2),
    );
    expect(
      projectRepository.markIntegrationDisconnected,
    ).not.toHaveBeenCalled();
  });

  it("starts again at one minute after a reset", async () => {
    const { backoff, projectRepository } = setup();

    await backoff.recordFailure("project-1", new Error("boom"), null);
    await backoff.recordFailure("project-1", new Error("boom"), null);
    backoff.reset("project-1");
    await backoff.recordFailure("project-1", new Error("boom"), null);

    expect(projectRepository.deferNextSync).toHaveBeenLastCalledWith(
      "project-1",
      nextAt(1),
    );
  });

  it("logs a plain failure without a status", async () => {
    const { backoff } = setup();

    await backoff.recordFailure("project-1", new Error("boom"), "token");

    expect(mocks.logEvent).toHaveBeenCalledWith(
      containingFields({
        message:
          "GitHub synchronization of a project failed; next attempt in 1 min.",
        metadata: {
          projectId: "project-1",
          reason: "sync_failed",
          sequence: 1,
          statusCode: null,
        },
      }),
    );
    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "GitHubSyncRunner",
      "error",
      "Pages could not synchronize a project with GitHub; next attempt in 1 min.",
      expect.any(Error),
    );
  });
});

describe("recordFailure authentication failures", () => {
  it("marks the integration disconnected after a rejected token", async () => {
    const { backoff, projectRepository } = setup();
    const error = new GitHubApiError(401, "Bad credentials");

    await backoff.recordFailure("project-1", error, "encrypted");

    expect(projectRepository.markIntegrationDisconnected).toHaveBeenCalledWith(
      "project-1",
      "encrypted",
    );
    expect(mocks.logEvent).toHaveBeenCalledWith(
      containingFields({
        message: containingText("(HTTP 401)"),
        metadata: containingFields({
          reason: "github_auth",
          statusCode: 401,
        }),
      }),
    );
  });

  it("does not disconnect without a used token", async () => {
    const { backoff, projectRepository } = setup();

    await backoff.recordFailure(
      "project-1",
      new GitHubApiError(401, "Bad credentials"),
      null,
    );

    expect(
      projectRepository.markIntegrationDisconnected,
    ).not.toHaveBeenCalled();
  });

  it("treats 403 as an auth failure but does not disconnect", async () => {
    const { backoff, projectRepository } = setup();

    await backoff.recordFailure(
      "project-1",
      new GitHubApiError(403, "Forbidden"),
      "encrypted",
    );

    expect(mocks.logEvent).toHaveBeenCalledWith(
      containingFields({
        metadata: containingFields({ reason: "github_auth" }),
      }),
    );
    expect(
      projectRepository.markIntegrationDisconnected,
    ).not.toHaveBeenCalled();
  });

  it("reports other statuses as sync failures", async () => {
    const { backoff } = setup();

    await backoff.recordFailure(
      "project-1",
      new GitHubApiError(500, "Server"),
      "encrypted",
    );

    expect(mocks.logEvent).toHaveBeenCalledWith(
      containingFields({
        metadata: containingFields({
          reason: "sync_failed",
          statusCode: 500,
        }),
      }),
    );
  });

  it("logs a failing write and carries on", async () => {
    const { backoff, projectRepository } = setup();
    const writeError = new Error("database down");
    projectRepository.deferNextSync.mockRejectedValueOnce(writeError);

    await expect(
      backoff.recordFailure("project-1", new Error("boom"), null),
    ).resolves.toBeUndefined();

    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "GitHubSyncBackoff",
      writeError,
    );
    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "GitHubSyncBackoff",
      "warn",
      expect.any(String),
      writeError,
    );
  });
});

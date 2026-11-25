import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubConnectionTester } from "./GitHubConnectionTester";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { GitHubSyncAccessGuard } from "@/backend/service/github/GitHubSyncAccessGuard";
import type {
  GitHubSyncContext,
  GitHubSyncContextLoader,
} from "@/backend/service/github/GitHubSyncContextLoader";
import type { User } from "@/definition/User";

const mocks = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

const ACTOR = { id: "user-1" } as unknown as User;
const INTEGRATION = {
  lastSyncAt: "2026-01-01T00:00:00.000Z",
  repoName: "old/name",
  repoUrl: "https://github.com/owner/repo",
  syncComments: true,
  syncCommits: false,
  syncDirection: "push",
  syncIntervalMinutes: 15,
  syncIssues: true,
  syncPullRequests: false,
  syncStatus: true,
};

function createTester(context: GitHubSyncContext | null): {
  readonly tester: GitHubConnectionTester;
  readonly upsertIntegration: ReturnType<typeof vi.fn>;
  readonly findContext: ReturnType<typeof vi.fn>;
  readonly requireWritableProject: ReturnType<typeof vi.fn>;
} {
  const upsertIntegration = vi.fn().mockResolvedValue(undefined);
  const findContext = vi.fn().mockResolvedValue(context);
  const requireWritableProject = vi.fn().mockResolvedValue(undefined);
  const tester = new GitHubConnectionTester(
    { upsertIntegration } as unknown as ProjectRepository,
    { requireWritableProject } as unknown as GitHubSyncAccessGuard,
    { findContext } as unknown as GitHubSyncContextLoader,
  );

  return { tester, upsertIntegration, findContext, requireWritableProject };
}

function contextWith(getRepository: () => Promise<string>): GitHubSyncContext {
  return {
    client: { getRepository },
    integration: INTEGRATION,
    repo: { owner: "owner", repo: "repo" },
  } as unknown as GitHubSyncContext;
}

beforeEach(() => {
  mocks.logCaughtError.mockReset();
});

describe("testConnection", () => {
  it("returns false without a resolvable context", async () => {
    const { tester, upsertIntegration, findContext, requireWritableProject } =
      createTester(null);

    await expect(tester.testConnection(ACTOR, "project-1")).resolves.toBe(
      false,
    );
    expect(requireWritableProject).toHaveBeenCalledWith(ACTOR, "project-1");
    expect(findContext).toHaveBeenCalledWith("project-1", {
      allowTokenless: true,
      includeDisabled: true,
    });
    expect(upsertIntegration).not.toHaveBeenCalled();
  });

  it("stores the connected state and repository name on success", async () => {
    const getRepository = vi.fn().mockResolvedValue("owner/repo");
    const { tester, upsertIntegration } = createTester(
      contextWith(getRepository),
    );

    await expect(tester.testConnection(ACTOR, "project-1")).resolves.toBe(true);
    expect(getRepository).toHaveBeenCalledWith("owner", "repo");
    expect(upsertIntegration).toHaveBeenCalledWith("project-1", {
      isConnected: true,
      lastSyncAt: INTEGRATION.lastSyncAt,
      repoName: "owner/repo",
      repoUrl: INTEGRATION.repoUrl,
      syncComments: true,
      syncCommits: false,
      syncDirection: "push",
      syncIntervalMinutes: 15,
      syncIssues: true,
      syncPullRequests: false,
      syncStatus: true,
      tokenEncrypted: null,
      tokenHash: null,
    });
  });

  it("logs the failure and stores the disconnected state", async () => {
    const failure = new Error("rejected");
    const { tester, upsertIntegration } = createTester(
      contextWith(() => Promise.reject(failure)),
    );

    await expect(tester.testConnection(ACTOR, "project-1")).resolves.toBe(
      false,
    );
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "GitHubConnectionTester",
      failure,
    );
    expect(upsertIntegration).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ isConnected: false, repoName: "old/name" }),
    );
  });
});

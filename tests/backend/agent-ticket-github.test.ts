import { expect, it, vi } from "vitest";

import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { GitHubApiClient } from "@/backend/github/GitHubApiClient";
import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import { TaskGitHubPublisher } from "@/backend/service/task/TaskGitHubPublisher";
import { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";

import {
  planningIdentity,
  planningTicket,
  useAgentPlanningHarness,
} from "../helpers/agent-planning";

import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";

const setup = useAgentPlanningHarness();

async function configureGitHub(
  run: Awaited<ReturnType<typeof setup>>,
  isEnabled: boolean,
) {
  const projects = new ProjectRepository(run.database);
  const tokenKey = Buffer.alloc(32, 7);
  await projects.upsertIntegration("p1", {
    repoUrl: "https://github.com/example/pages",
    repoName: "example/pages",
    tokenHash: null,
    tokenEncrypted: encryptGitHubToken("isolated-test-token", tokenKey),
    isConnected: true,
    syncIssues: true,
    syncStatus: true,
    syncComments: false,
    syncPullRequests: false,
    syncCommits: false,
    syncDirection: "bidirectional",
    syncIntervalMinutes: 0,
    lastSyncAt: null,
  });
  await projects.setIntegrationSyncEnabled("p1", isEnabled);
  const client = new GitHubApiClient("isolated-test-token", async () => {
    throw new Error("Unexpected network access.");
  });
  let remote: GitHubIssueData = {
    number: 42,
    title: "Original",
    body: "Original body",
    state: "open",
    url: "https://github.com/example/pages/issues/42",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const create = vi
    .spyOn(client, "createIssue")
    .mockImplementation(async (_owner, _repo, input) => {
      remote = { ...remote, ...input };
      return remote;
    });
  vi.spyOn(client, "getIssue").mockImplementation(async () => remote);
  const update = vi
    .spyOn(client, "updateIssue")
    .mockImplementation(async (_owner, _repo, _number, patch) => {
      remote = { ...remote, ...patch };
      return remote;
    });
  const sync = new GitHubSyncService({
    taskRepository: run.repository,
    projectRepository: projects,
    gitHubRepository: new GitHubRepository(run.database),
    userRepository: run.users,
    projectService: run.context.projects,
    taskService: run.context.tasks,
    createClient: () => client,
    tokenKey,
  });
  const publisher = new TaskGitHubPublisher(
    run.repository,
    new TaskHistoryRecorder(run.repository),
    run.cache,
  );
  publisher.attach(sync);
  const pending: Promise<void>[] = [];
  const planning = createAgentPlanningServices({
    database: run.database,
    users: { getById: (id) => run.users.findById(id) },
    events: run.events,
    cache: run.cache,
    publisher: {
      publish: (actor, item) => {
        const publication = publisher.publish(actor, item);
        pending.push(publication);
        return publication;
      },
    },
  });
  return { planning, pending, create, update };
}

it.each([false, true])(
  "follows project synchronization (%s) after commit and leaves retries, no-ops, conflicts and parent edits silent",
  async (isEnabled) => {
    const run = await setup();
    const { planning, pending, create, update } = await configureGitHub(
      run,
      isEnabled,
    );
    const first = await planning.tickets.apply(
      planningIdentity,
      "ticket.create",
      planningTicket(),
    );
    await Promise.all(pending.splice(0));
    if (!("ticketId" in first.result))
      throw new Error("Expected ticket result.");
    const ticketId = first.result.ticketId;
    expect(create).toHaveBeenCalledTimes(Number(isEnabled));
    expect(
      await planning.tickets.apply(
        planningIdentity,
        "ticket.create",
        planningTicket(),
      ),
    ).toEqual(first);
    const change = {
      operationId: "title",
      ticketId,
      expectedTitle: "Original",
      title: "New",
    };
    await planning.tickets.apply(planningIdentity, "ticket.setTitle", change);
    await Promise.all(pending.splice(0));
    expect(update).toHaveBeenCalledTimes(Number(isEnabled));
    expect(
      await planning.tickets.apply(planningIdentity, "ticket.setTitle", change),
    ).toMatchObject({ result: { changed: true } });
    await planning.tickets.apply(planningIdentity, "ticket.setTitle", {
      ...change,
      operationId: "noop",
    });
    await expect(
      planning.tickets.apply(planningIdentity, "ticket.setTitle", {
        ...change,
        operationId: "stale",
        title: "Other",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await planning.tickets.apply(
      planningIdentity,
      "ticket.create",
      planningTicket({ operationId: "epic", type: "epic" }),
    );
    await Promise.all(pending.splice(0));
    await planning.tickets.apply(planningIdentity, "ticket.setParent", {
      operationId: "parent",
      ticketId,
      expectedParentId: null,
      parentId: "PAGE-2",
    });
    expect(pending).toEqual([]);
    expect(create).toHaveBeenCalledTimes(Number(isEnabled));
    expect(update).toHaveBeenCalledTimes(Number(isEnabled));
    expect(await run.repository.findById(ticketId)).toMatchObject({
      title: "New",
      githubIssueNumber: isEnabled ? 42 : null,
      githubLastError: null,
    });
  },
);

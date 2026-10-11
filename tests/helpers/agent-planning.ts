import { rmSync } from "node:fs";

import { afterEach, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { CAPABILITY } from "@/definition/Authorization";

import { useMigratedDatabase } from "./test-database";
import { createWikiHarness } from "./wiki-harness";

import type { Database } from "@/backend/database/Database";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Deliberately stale identity: services must resolve current account rights. */
export const planningIdentity: AgentIdentity = {
  userId: "owner",
  isAdmin: false,
  permissions: [],
};

/** Explicit create parameters with no implied parent or milestone. */
export function planningTicket(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    operationId: "ticket-create",
    projectId: "p1",
    type: "task",
    title: "Original",
    description: "Original body",
    statusId: null,
    parentId: null,
    milestoneId: null,
    ...overrides,
  };
}

/** Explicit milestone parameters. */
export function planningMilestone(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    operationId: "milestone-create",
    projectId: "p1",
    name: "Release",
    description: "Plan",
    startAt: null,
    dueAt: null,
    ...overrides,
  };
}

async function createPlanningHarness(database: Database) {
  const wiki = createWikiHarness(database);
  for (const department of ["alpha", "beta"])
    await wiki.addDepartment(department);
  const owner = await wiki.addUser("owner", {
    isAdmin: true,
    mode: "role",
    departments: ["alpha"],
  });
  const writer = await wiki.addUser("writer", { departments: ["alpha"] });
  const reader = await wiki.addUser("reader", {
    departments: ["alpha"],
    capabilities: [],
  });
  const manager = await wiki.addUser("manager", {
    departments: ["alpha"],
    capabilities: [CAPABILITY.MANAGE_PROJECTS],
  });
  for (const [project, department, key] of [
    ["p1", "alpha", "PAGE"],
    ["p2", "beta", "OTHER"],
  ]) {
    await wiki.addProject(project, [department]);
    await database.execute(
      "INSERT INTO project_keys (project_id, key) VALUES ($id, $key);",
      { key, id: project },
    );
  }
  const authorization = new AuthorizationRepository(database);
  const managerAccount = (await authorization.snapshot()).accounts.find(
    ({ userId }) => userId === "manager",
  );
  if (!managerAccount) throw new Error("Expected manager account.");
  await authorization.saveAccount({
    ...managerAccount,
    managedDepartments: ["alpha"],
  });
  const users = new UserRepository(database);
  const events = new PagesEventPublisher();
  const listener = vi.fn();
  const release = events.subscribe(listener);
  const cache = new ServerCache();
  const invalidate = vi.spyOn(cache, "invalidateWorkItems");
  const publish = vi
    .fn<
      (
        actor: typeof owner,
        item: Awaited<ReturnType<TaskRepository["findById"]>>,
      ) => Promise<void>
    >()
    .mockResolvedValue(undefined);
  const planning = createAgentPlanningServices({
    database,
    users: { getById: (id) => users.findById(id) },
    events,
    cache,
    publisher: { publish },
  });
  return {
    ...wiki,
    owner,
    writer,
    reader,
    manager,
    users,
    events,
    listener,
    release,
    cache,
    invalidate,
    publish,
    planning,
    context: createAgentTaskContext(database, owner),
    repository: new TaskRepository(database),
  };
}

/** Migrated in-memory fixture; its temporary directory is removed after each test. */
export function useAgentPlanningHarness(): () => Promise<
  Awaited<ReturnType<typeof createPlanningHarness>>
> {
  const getDatabase = useMigratedDatabase();
  const directories = new Set<string>();
  afterEach(() => {
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
    directories.clear();
  });
  return async () => {
    const harness = await createPlanningHarness(getDatabase());
    directories.add(harness.filesDirectory);
    return harness;
  };
}

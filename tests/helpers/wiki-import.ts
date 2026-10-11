import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { createAgentWikiAccess } from "@/backend/service/agents/AgentWikiAccess";
import { readImportTitle } from "@/backend/service/agents/ImportMarkdownTitle";
import { WikiImportPlanner } from "@/backend/service/agents/WikiImportPlanner";

import { createWikiHarness } from "./wiki-harness";

import type { Database } from "@/backend/database/Database";
import type {
  AgentImportFile,
  AgentImportPlan,
  AgentImportPlanInput,
} from "@/definition/AgentImportManifest";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { User } from "@/definition/User";
import type { WikiHarness } from "./wiki-harness";

export interface WikiImportHarness extends WikiHarness {
  readonly owner: User;
  readonly actor: User;
  readonly planner: WikiImportPlanner;
  readonly router: AgentOperationRouter;
}

/** Adds two isolated projects and an ordinary writer to the existing in-memory wiki harness. */
export async function createWikiImportHarness(
  database: Database,
): Promise<WikiImportHarness> {
  const harness = createWikiHarness(database);
  const owner = await harness.addUser("owner", {
    isAdmin: true,
    mode: "admin",
  });
  const actor = await harness.addUser("writer", { departments: ["alpha"] });
  await harness.addDepartment("alpha");
  await harness.addDepartment("beta");
  await harness.addProject("alpha", ["alpha"]);
  await harness.addProject("beta", ["beta"]);
  const projects = new ProjectRepository(database);
  const users = new UserRepository(database);
  return {
    ...harness,
    owner,
    actor,
    planner: new WikiImportPlanner(
      harness.repository,
      createAgentWikiAccess(projects, actor),
    ),
    router: new AgentOperationRouter({
      projects,
      wiki: harness.repository,
      users: { getById: (id) => users.findById(id) },
    }),
  };
}

/** Creates a package; tests of title derivation use explicit expected index entries separately. */
export function importRequest(
  files: readonly AgentImportFile[] = [
    { sourceKey: "new.md", content: "Body" },
  ],
  destination: Partial<
    Pick<AgentImportPlanInput, "projectId" | "parentId">
  > = {},
): AgentImportPlanInput {
  return {
    projectId: "alpha",
    parentId: null,
    ...destination,
    manifest: { version: "1", index: files.map(readImportTitle), files },
  };
}

/** Narrows the existing read response union by the import plan's public discriminator. */
export function importPlan(response: PagesAgentReadResponse): AgentImportPlan {
  if (!("fingerprint" in response.result))
    throw new Error("Expected an import plan");
  return response.result;
}

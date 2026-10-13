import path from "node:path";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentDefinitionFiles } from "@/backend/service/agents/AgentDefinitionFiles";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { PageAgentService } from "@/backend/service/agents/PageAgentService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createAssistantHarness } from "./text-assistant";

import type { Database } from "@/backend/database/Database";
import type { PageAgentInput } from "@/definition/PageAgent";

/** User-owned fixtures name only an administrative profile and typed parameter definitions. */
export function pageAgentInput(
  overrides: Partial<PageAgentInput> = {},
): PageAgentInput {
  return {
    name: "Test agent",
    modelProfileId: "admin-model",
    reasoningEffort: "medium",
    configuration: {
      ...emptyAgentConfiguration(),
      accessMode: "shared",
      markdown: "Test {{input}}",
      parameters: [
        {
          name: "input",
          type: "text",
          description: "Task",
          isRequired: true,
          defaultValue: { type: "text", text: "Default task" },
        },
      ],
    },
    ...overrides,
  };
}

/** Real migrated DuckDB and policies; no provider, live database or instance file is touched. */
export async function createPageAgentHarness(database: Database) {
  const base = await createAssistantHarness(database);
  await base.authorization.saveAccount(base.admin);
  const repository = new AgentProfileRepository(database);
  const groups = new UserGroupRepository(database);
  const directory = path.join(base.wiki.filesDirectory, "Agents");
  const files = new AgentDefinitionFiles(directory);
  const dependencies = {
    profiles: repository,
    groups,
    connections: base.connections,
    authorization: base.authorization,
    operations: new AgentOperationRegistry(),
    files,
    content: new AgentContentAccess(
      new ProjectRepository(database),
      base.wiki.repository,
    ),
  };
  const profiles = new AgentProfileService(dependencies);
  await repository.save({
    id: "admin-model",
    name: "Admin model",
    connectionId: "connection",
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["agent"],
    targets: [{ kind: "system", targetId: "agent" }],
    configuration: emptyAgentConfiguration("system"),
  });
  const service = new PageAgentService(dependencies, profiles, files);
  return { ...base, repository, groups, directory, files, profiles, service };
}

import { randomUUID } from "node:crypto";

import { vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AssistantConversationRepository } from "@/backend/database/repositories/assistant/AssistantConversationRepository";
import { TextAssistantSettingsRepository } from "@/backend/database/repositories/assistant/TextAssistantSettingsRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import { TextAgentRoleService } from "@/backend/service/assistant/TextAgentRoleService";
import { TextAssistantContextService } from "@/backend/service/assistant/TextAssistantContextService";
import { TextAssistantService } from "@/backend/service/assistant/TextAssistantService";

import { createAccess } from "./authorization";
import { createCatalogModel } from "./agents";
import { createWikiHarness, pageInput } from "./wiki-harness";

import type { Database } from "@/backend/database/Database";
import type { TextAssistantRequest } from "@/definition/TextAssistant";
import type { TextExecution } from "@/backend/agents/TextExecution";

/** Synthetic request with no provider choice or credential material. */
export function assistantRequest(
  overrides: Partial<TextAssistantRequest> = {},
): TextAssistantRequest {
  return {
    requestId: randomUUID(),
    conversationId: null,
    context: { kind: "wiki", id: "page", version: "1" },
    action: "proofread",
    scope: "selection",
    change: "replace",
    source: "Chosen passage",
    instruction: "",
    targetLanguage: "en",
    ...overrides,
  };
}

/** Real DuckDB and access policies with an injected text adapter that never uses the network. */
export async function createAssistantHarness(database: Database) {
  const wiki = createWikiHarness(database);
  const alice = await wiki.addUser("alice", { departmentBound: false });
  const bob = await wiki.addUser("bob", { departmentBound: false });
  const reader = await wiki.addUser("reader", {
    departmentBound: false,
    capabilities: [],
  });
  const page = await wiki.service.create(
    alice,
    pageInput({ content: "Original page" }),
  );
  await wiki.addProject("project");
  await wiki.addEpic("ticket", "project");
  const authorization = new AuthorizationRepository(database);
  const permissions = new PermissionService(async (id) => {
    const snapshot = await authorization.snapshot();
    const account = snapshot.accounts.find((entry) => entry.userId === id);
    if (!account) throw new Error("Missing synthetic account");
    return account;
  });
  const projectService = new ProjectService(
    new ProjectRepository(database),
    permissions,
    undefined,
    new ServerCache(),
  );
  const settings = new TextAssistantSettingsRepository(database);
  const connections = new AgentConnectionRepository(database);
  await connections.insert({
    id: "connection",
    name: "Synthetic API",
    provider: "openrouter",
    secretEncrypted: "synthetic-ciphertext",
    testModel: "other-default",
    actorId: alice.id,
  });
  await connections.catalogs().save(
    "connection",
    {
      attemptedAt: "2026-10-09T12:00:00Z",
      errorCode: null,
      models: [
        createCatalogModel({
          id: "model-a",
          reasoning: "levels",
          reasoningEfforts: ["low", "medium"],
        }),
      ],
    },
    null,
  );
  await connections.checks().save(
    "connection",
    "auth",
    {
      status: "passed",
      errorCode: null,
      detail: {},
      durationMs: 1,
      checkedAt: "2026-10-09T12:00:00Z",
    },
    alice.id,
  );
  const roles = new TextAgentRoleService(settings, connections);
  const admin = createAccess({
    userId: alice.id,
    isAdmin: true,
    mode: "admin",
  });
  await roles.save(admin, {
    role: {
      connectionId: "connection",
      model: "model-a",
      reasoningEffort: "medium",
    },
    retentionDays: 30,
  });
  const contexts = new TextAssistantContextService(
    new WikiAccess(projectService, permissions),
    new WikiPageReader(wiki.repository),
    new TaskAccessGuard(
      new TaskRepository(database),
      projectService,
      permissions,
    ),
  );
  const conversations = new AssistantConversationRepository(database);
  const requests = new AssistantRequestRegistry();
  const execution = {
    run: vi.fn<TextExecution["run"]>().mockResolvedValue("Corrected passage"),
  };
  const service = new TextAssistantService({
    roles,
    contexts,
    conversations,
    requests,
    settings,
    execution,
  });
  const request = assistantRequest({
    context: { kind: "wiki", id: page.id, version: "1" },
  });
  return {
    wiki,
    alice,
    bob,
    reader,
    page,
    admin,
    authorization,
    projectService,
    permissions,
    settings,
    connections,
    roles,
    contexts,
    conversations,
    requests,
    execution,
    service,
    request,
  };
}

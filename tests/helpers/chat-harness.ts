import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, vi } from "vitest";

import { createChatServices } from "@/app/lib/chat-services.server";
import { createMcpServices } from "@/app/lib/mcp-services.server";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { CHAT_ACTION_FENCE } from "@/backend/service/chat/ChatActionProtocol";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";

import { createCatalogModel } from "./agents";
import { useMigratedDatabase } from "./test-database";
import { createWikiHarness } from "./wiki-harness";

import type { TextExecution } from "@/backend/agents/TextExecution";
import type { Database } from "@/backend/database/Database";
import type { ApiProviderId } from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentProfileInput } from "@/definition/AgentProfile";

/** Writes the reply of a model that requests one Pages action. */
export function chatAction(
  operation: string,
  parameters: Readonly<Record<string, unknown>> = {},
): string {
  return `\`\`\`${CHAT_ACTION_FENCE}\n${JSON.stringify({ operation, parameters })}\n\`\`\``;
}

/** The chat agent as an administrator assigns it to the system function Chat. */
export function chatProfile(
  overrides: Partial<AgentProfileInput> = {},
): AgentProfileInput {
  return {
    name: "Pica",
    connectionId: "openai",
    model: "chat-model",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["chat"],
    targets: [{ kind: "system", targetId: "chat" }],
    ...overrides,
  };
}

async function addConnection(
  connections: AgentConnectionRepository,
  id: string,
  provider: ApiProviderId,
): Promise<void> {
  await connections.insert({
    id,
    name: `Synthetic ${provider}`,
    provider,
    secretEncrypted: "synthetic-ciphertext",
    testModel: null,
    actorId: "admin",
  });
  await connections.catalogs().save(
    id,
    {
      attemptedAt: "2026-10-12T08:00:00Z",
      errorCode: null,
      models: [
        createCatalogModel({
          id: "chat-model",
          reasoning: "levels",
          reasoningEfforts: ["low", "medium"],
        }),
      ],
    },
    null,
  );
  await connections.checks().save(
    id,
    "auth",
    {
      status: "passed",
      errorCode: null,
      detail: {},
      durationMs: 1,
      checkedAt: "2026-10-12T08:00:00Z",
    },
    "admin",
  );
}

async function addPeople(
  database: Database,
  wiki: ReturnType<typeof createWikiHarness>,
) {
  for (const department of ["alpha", "beta"])
    await wiki.addDepartment(department);
  const people = {
    admin: await wiki.addUser("admin", {
      isAdmin: true,
      mode: "admin",
      departments: ["alpha"],
      displayName: "Ada Admin",
    }),
    roleAdmin: await wiki.addUser("roleadmin", { isAdmin: true, mode: "role" }),
    writer: await wiki.addUser("writer", {
      departments: ["alpha"],
      displayName: "Wanda Writer",
    }),
    reader: await wiki.addUser("reader", {
      departments: ["alpha"],
      capabilities: [],
    }),
    outsider: await wiki.addUser("outsider", { departments: ["beta"] }),
  };
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
  return people;
}

/**
 * The chat on a real database: people with different rights, two projects,
 * two API connections, the chat agent assigned by an administrator, the real
 * operation catalog of the chat channel and a scripted model.
 */
export async function createChatHarness(database: Database) {
  const directory = mkdtempSync(path.join(tmpdir(), "pages-chat-"));
  const wiki = createWikiHarness(database);
  const people = await addPeople(database, wiki);
  const authorization = new AuthorizationRepository(database);
  const users = new UserRepository(database);
  const account = async (id: string): Promise<AccountAccess> => {
    const found = (await authorization.snapshot()).accounts.find(
      ({ userId }) => userId === id,
    );
    if (!found) throw new Error(`Unknown test account ${id}.`);
    return found;
  };
  const accounts = {
    users: { getById: (id: string) => users.findById(id) },
    administration: { getContext: account },
  };
  const connections = new AgentConnectionRepository(database);
  await addConnection(connections, "openai", "openai");
  await addConnection(connections, "zai", "zai");
  const profiles = new AgentProfileService({
    profiles: new AgentProfileRepository(database),
    connections,
    authorization,
    groups: new UserGroupRepository(database),
    operations: new AgentOperationRegistry(),
  });
  const agentId = await profiles.save(
    await account("admin"),
    null,
    chatProfile(),
  );
  const mcp = createMcpServices(
    database,
    accounts.users,
    accounts.administration,
    {
      directory,
      wikiService: {
        getSettings: async () => WIKI_SETTING_DEFAULTS,
        openAttachment: (...parameters) =>
          wiki.service.openAttachment(...parameters),
      },
      tickets: { cache: new ServerCache(), publisher: null },
    },
  );
  const execution = { run: vi.fn<TextExecution["run"]>() };
  const chat = createChatServices({
    database,
    directory,
    accounts,
    agents: {
      agentProfileService: profiles,
      agentChatExecution: execution,
      chatRequests: new AssistantRequestRegistry({
        timeoutMs: 60_000,
        capacity: 4,
      }),
    },
    router: mcp.chatOperationRouter,
  });
  return {
    ...chat,
    wiki,
    mcp,
    database,
    directory,
    connections,
    profiles,
    agentId,
    account,
    execution,
    people,
    /** Sends one message of a person in an own, freshly opened session. */
    async ask(
      person: keyof typeof people,
      text: string,
      attachmentIds: readonly string[] = [],
    ) {
      const actor = people[person];
      const { session } = await chat.chatSessionService.open(actor);
      return chat.chatService.send(actor, {
        requestId: randomUUID(),
        sessionId: session.id,
        text,
        attachmentIds,
      });
    },
  };
}

/** The type of {@link createChatHarness}. */
export type ChatHarness = Awaited<ReturnType<typeof createChatHarness>>;

/** Migrated in-memory chat fixture; its temporary directories are removed after each test. */
export function useChatHarness(): () => Promise<ChatHarness> {
  const getDatabase = useMigratedDatabase();
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });
  return async () => {
    const harness = await createChatHarness(getDatabase());
    directories.push(harness.directory, harness.wiki.filesDirectory);
    return harness;
  };
}

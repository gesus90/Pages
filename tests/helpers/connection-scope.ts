import { vi } from "vitest";

import { ScopedExecution } from "@/backend/agents/ScopedExecution";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { TextAssistantService } from "@/backend/service/assistant/TextAssistantService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createCatalogModel } from "./agents";
import { createAssistantHarness } from "./text-assistant";

import type { Database } from "@/backend/database/Database";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";
import type { AgentProfileInput } from "@/definition/AgentProfile";
import type { User } from "@/definition/User";

/** The two kinds of connection every scope rule has to hold for. */
export type ScopedConnectionKind = "api" | "cli";

export const API_CONNECTION_ID = "connection";
export const CLI_CONNECTION_ID = "cli-connection";
export const SYNTHETIC_API_CIPHERTEXT = "synthetic-ciphertext";

/**
 * A real database with an administrator, five more accounts, one API and one
 * CLI connection, and a provider double that records every call.
 *
 * @remarks
 * Accounts: `alice` administrator, `bob` and `reader` from the shared harness,
 * `carol` (the person in direct scopes), `dave` (department member), `erin`
 * (group member), `frank` (no membership at all).
 */
export async function createScopeHarness(database: Database) {
  const harness = await createAssistantHarness(database);
  const { authorization, connections, admin, alice, profiles } = harness;
  await authorization.saveAccount(admin);
  const inherited = (await profiles.list(admin)).find(
    (profile) => profile.id === "system-text",
  );
  if (!inherited) throw new Error("Missing inherited system agent");
  await profiles.save(admin, inherited.id, {
    ...inherited,
    isActive: false,
    targets: [],
    configuration: emptyAgentConfiguration("system"),
  });
  await profiles.remove(admin, "system-text");

  const carol = await harness.wiki.addUser("carol", { departmentBound: false });
  const dave = await harness.wiki.addUser("dave", { departmentBound: false });
  const erin = await harness.wiki.addUser("erin", { departmentBound: false });
  const frank = await harness.wiki.addUser("frank", { departmentBound: false });
  await authorization.saveDepartment({
    id: "engineering",
    name: "Engineering",
  });
  await authorization.saveDepartment({ id: "finance", name: "Finance" });
  const groups = new UserGroupRepository(database);
  await groups.save({ id: "team", name: "Team", memberIds: [erin.id] });

  await connections.insert({
    id: CLI_CONNECTION_ID,
    name: "Synthetic CLI",
    provider: "codex_cli",
    secretEncrypted: null,
    testModel: null,
    actorId: alice.id,
  });
  await connections.setCliAccount(
    CLI_CONNECTION_ID,
    { loggedInAt: "2026-10-09T12:00:00Z", label: null },
    alice.id,
  );
  await connections.catalogs().save(
    CLI_CONNECTION_ID,
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

  const provider = {
    run: vi.fn<TextExecution["run"]>().mockResolvedValue("Corrected passage"),
  };
  const access = new AgentConnectionAccess({
    connections,
    authorization,
    groups,
  });
  const execution = new ScopedExecution(provider, access);
  const assistant = new TextAssistantService({
    roles: harness.roles,
    contexts: harness.contexts,
    conversations: harness.conversations,
    requests: harness.requests,
    settings: harness.settings,
    execution,
  });
  const management = new AgentConnectionService({
    repository: connections,
    operations: new AgentOperationRegistry(),
    cipher: new InstanceSecretCipher(Buffer.alloc(32, 8)),
    cli: {
      describe: vi.fn().mockResolvedValue({
        binaryFound: true,
        loggedInAt: "2026-10-09T12:00:00Z",
        accountLabel: null,
        login: null,
        terminalCommand: "isolated",
      }),
      cleanup: vi.fn(),
    },
  });

  async function accountOf(userId: string): Promise<AccountAccess> {
    const account = (await authorization.snapshot()).accounts.find(
      (entry) => entry.userId === userId,
    );
    if (!account) throw new Error(`Missing account ${userId}`);
    return account;
  }

  return {
    ...harness,
    carol,
    dave,
    erin,
    frank,
    groups,
    provider,
    access,
    execution,
    assistant,
    management,
    /** Administration-time scope change, exactly as the admin form saves it. */
    async setScope(
      connectionId: string,
      scope: AgentConnectionScope,
    ): Promise<void> {
      await connections.update(connectionId, {
        ...(await keepConnection(connectionId)),
        scope,
      });
    },
    /** One text agent on the connection, assigned to everybody by the system function. */
    async createTextAgent(connectionId: string): Promise<string> {
      return profiles.save(admin, null, textAgent(connectionId));
    },
    async setDepartments(
      userId: string,
      departments: readonly string[],
      managedDepartments: readonly string[] = [],
    ): Promise<void> {
      await authorization.saveAccount({
        ...(await accountOf(userId)),
        departments,
        managedDepartments,
      });
    },
    async deactivate(user: User): Promise<void> {
      await database.execute("UPDATE users SET is_active = 0 WHERE id = $id;", {
        id: user.id,
      });
    },
  };

  async function keepConnection(connectionId: string) {
    const connection = await connections.find(connectionId);
    if (!connection) throw new Error("Missing connection");
    return {
      name: connection.name,
      secretEncrypted: null,
      testModel: connection.testModel,
      reasoningEffort: connection.reasoningEffort,
      clearModel: false,
      actorId: alice.id,
    };
  }
}

export type ScopeHarness = Awaited<ReturnType<typeof createScopeHarness>>;

/** Text agent whose profile targets do not restrict anybody, so only the scope can. */
export function textAgent(
  connectionId: string,
  overrides: Partial<AgentProfileInput> = {},
): AgentProfileInput {
  return {
    name: "Scoped text agent",
    connectionId,
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["text"],
    targets: [{ kind: "system", targetId: "text" }],
    ...overrides,
  };
}

/** Connection id of the kind under test. */
export function connectionIdOf(kind: ScopedConnectionKind): string {
  return kind === "api" ? API_CONNECTION_ID : CLI_CONNECTION_ID;
}

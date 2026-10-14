import { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import { AgentCheckRepository } from "@/backend/database/repositories/agent/AgentCheckRepository";
import { AgentConnectionScopeRepository } from "@/backend/database/repositories/agent/AgentConnectionScopeRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentDefinitionFiles } from "@/backend/service/agents/AgentDefinitionFiles";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { PageAgentOperationService } from "@/backend/service/agents/PageAgentOperationService";
import { PageAgentService } from "@/backend/service/agents/PageAgentService";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";
import { CAPABILITY } from "@/definition/Authorization";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type {
  AgentProfileJournal,
  AgentProfileRemoveOptions,
} from "@/backend/database/repositories/agent/AgentProfileRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { AccountAccess, Capability } from "@/definition/Authorization";
import type {
  AgentCheckSummary,
  AgentProviderId,
} from "@/definition/AgentConnection";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";
import type {
  AgentCatalogModel,
  AgentModelCatalog,
  AgentReasoningSupport,
} from "@/definition/AgentModelCatalog";
import type {
  AgentProfile,
  AgentProfileTarget,
} from "@/definition/AgentProfile";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { UserGroup } from "@/definition/UserGroup";
import type { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";

/** The folder of agent definition files of the test instance. */
export const AGENTS_DIRECTORY = "/srv/pages/agents";

/** Stands in for a dependency the tested path never reaches. */
const UNUSED: unknown = Object.create(null);

/** What a test says about a person; everything else is the plainest account. */
export interface PersonOptions {
  readonly isAdmin?: boolean;
  readonly isActive?: boolean;
  readonly capabilities?: readonly Capability[];
  readonly departments?: readonly string[];
}

/** What a test says about a model that administrators released. */
export interface ModelOptions {
  /** The model name of the provider; the profile identifier is the first argument. */
  readonly model?: string;
  readonly name?: string;
  /** Efforts the catalog lists; none lists no level. */
  readonly efforts?: readonly string[];
  readonly catalogDefault?: string | null;
  readonly reasoning?: AgentReasoningSupport;
  readonly targets?: readonly AgentProfileTarget[];
  readonly isActive?: boolean;
  /** Whether the connection's authentication check passed. */
  readonly isVerified?: boolean;
  readonly scope?: AgentConnectionScope;
  readonly projectId?: string | null;
  /** The effort the administrator saved with the assignment; the first listed one by default. */
  readonly assignedEffort?: string | null;
}

/** A user agent a test starts from, placed without any operation. */
export interface SeededAgent {
  readonly id: string;
  readonly ownerId: string;
  readonly modelProfileId: string;
  readonly name?: string;
  readonly isGlobal?: boolean;
  readonly targets?: readonly AgentProfileTarget[];
  readonly operator?: "and" | "or";
  readonly reasoningEffort?: string | null;
  /** A connection the agent was pinned to before the model profile moved elsewhere. */
  readonly pinnedConnectionId?: string;
}

function account(userId: string, options: PersonOptions): AccountAccess {
  return {
    userId,
    role: {
      id: "role",
      name: "Role",
      rank: 10,
      departmentBound: false,
      permissions: options.capabilities ?? [CAPABILITY.WRITE],
    },
    isAdmin: options.isAdmin ?? false,
    mode: options.isAdmin ? "admin" : "role",
    firstName: userId,
    lastName: "Tester",
    isActive: options.isActive ?? true,
    departments: options.departments ?? [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
  };
}

const PASSED: AgentCheckSummary = {
  status: "passed",
  errorCode: null,
  checkedAt: "2026-01-01 00:00:00",
  durationMs: 1,
  detail: {},
};

function connectionRecord(
  id: string,
  provider: AgentProviderId,
): AgentConnectionRecord {
  return {
    isActive: true,
    id,
    name: `Connection ${id}`,
    provider,
    hasApiKey: true,
    testModel: null,
    reasoningEffort: null,
    cliLoggedInAt: null,
    cliAccountLabel: null,
    updatedAt: "2026-01-01 00:00:00",
  };
}

/** One administrator model grant with the connection facts the rules read. */
interface ModelFacts {
  readonly connection: AgentConnectionRecord;
  readonly catalog: AgentModelCatalog;
  readonly isVerified: boolean;
  readonly scope: AgentConnectionScope;
}

function catalogOf(model: AgentCatalogModel): AgentModelCatalog {
  return {
    models: [model],
    intervalHours: 0,
    nextRefreshAt: null,
    attemptedAt: null,
    refreshedAt: null,
    errorCode: null,
  };
}

/** A transaction no statement reaches; every repository below answers from memory. */
const NO_STATEMENTS: DatabaseTransaction = {
  query: async () => {
    throw new Error("Unexpected query");
  },
  execute: async () => {
    throw new Error("Unexpected statement");
  },
};

/** The profile table; it honours the revision rule and the journal like the real store. */
class MemoryProfiles extends AgentProfileRepository {
  private readonly world: PageAgentWorld;

  public constructor(world: PageAgentWorld) {
    super(UNUSED as Database);
    this.world = world;
  }

  /** Every stored profile in the order the table lists them. */
  public override async list(): Promise<readonly AgentProfile[]> {
    return [...this.world.stored()].sort(
      (left, right) =>
        left.name.toLowerCase().localeCompare(right.name.toLowerCase()) ||
        left.id.localeCompare(right.id),
    );
  }

  /** Removes the synthetic profile without touching a database. */
  public override async remove(
    id: string,
    options: AgentProfileRemoveOptions = {},
  ): Promise<void> {
    await this.world.transaction(async (transaction) => {
      const previous = this.world.stored().find((entry) => entry.id === id);
      if (
        options.expectedRevision !== undefined &&
        previous?.revision !== options.expectedRevision
      )
        throw new AgentError("profile_conflict");
      this.world.withdrawModel(id);
      await options.journal?.(transaction);
    });
  }

  /** Saves a profile under the revision rule and runs the journal in the same transaction. */
  public override async save(
    profile: AgentProfile,
    journal?: AgentProfileJournal,
  ): Promise<void> {
    await this.world.transaction(async (transaction) => {
      const previous = this.world.stored().find((e) => e.id === profile.id);
      if (
        profile.revision !== undefined &&
        previous?.revision !== profile.revision
      )
        throw new AgentError("profile_conflict");
      this.world.replace({
        ...profile,
        revision: (previous?.revision ?? 0) + 1,
      });
      this.world.writes.profiles += 1;
      await journal?.(transaction, profile);
    });
  }
}

class MemoryCatalogs extends AgentCatalogRepository {
  private readonly world: PageAgentWorld;

  public constructor(world: PageAgentWorld) {
    super(NO_STATEMENTS);
    this.world = world;
  }

  /** The catalog of the connection. */
  public override async find(id: string): Promise<AgentModelCatalog> {
    return this.world.facts(id).catalog;
  }
}

class MemoryChecks extends AgentCheckRepository {
  private readonly world: PageAgentWorld;

  public constructor(world: PageAgentWorld) {
    super(NO_STATEMENTS);
    this.world = world;
  }

  /** A passed authentication check, or none for a connection that is not verified. */
  public override async find(
    connectionId: string,
  ): Promise<AgentCheckSummary | null> {
    return this.world.facts(connectionId).isVerified ? PASSED : null;
  }
}

class MemoryScopes extends AgentConnectionScopeRepository {
  private readonly world: PageAgentWorld;

  public constructor(world: PageAgentWorld) {
    super(NO_STATEMENTS);
    this.world = world;
  }

  /** The scope of the connection. */
  public override async find(
    connectionId: string,
  ): Promise<AgentConnectionScope | null> {
    return this.world.facts(connectionId).scope;
  }
}

class MemoryConnections extends AgentConnectionRepository {
  private readonly world: PageAgentWorld;

  public constructor(world: PageAgentWorld) {
    super(UNUSED as Database);
    this.world = world;
  }

  /** The connection record. */
  public override async find(
    id: string,
  ): Promise<AgentConnectionRecord | null> {
    return this.world.facts(id).connection;
  }

  /** The catalogs of the connections. */
  public override catalogs(): AgentCatalogRepository {
    return new MemoryCatalogs(this.world);
  }

  /** The checks of the connections. */
  public override checks(): AgentCheckRepository {
    return new MemoryChecks(this.world);
  }

  /** The scopes of the connections. */
  public override scopes(): AgentConnectionScopeRepository {
    return new MemoryScopes(this.world);
  }
}

class MemoryAuthorization extends AuthorizationRepository {
  private readonly world: PageAgentWorld;

  public constructor(world: PageAgentWorld) {
    super(UNUSED as Database);
    this.world = world;
  }

  /** The accounts and departments of the test instance. */
  public override async snapshot(): Promise<AuthorizationSnapshot> {
    return this.world.snapshot();
  }
}

class MemoryGroups extends UserGroupRepository {
  private readonly world: PageAgentWorld;

  public constructor(world: PageAgentWorld) {
    super(UNUSED as Database);
    this.world = world;
  }

  /** Every group with its members. */
  public override async findAll(): Promise<UserGroup[]> {
    return [...this.world.groups];
  }

  /** The groups the person belongs to. */
  public override async findIdsByMember(userId: string): Promise<string[]> {
    return this.world.groups
      .filter((group) => group.memberIds.includes(userId))
      .map((group) => group.id);
  }
}

/**
 * The accounts, groups, model grants, profile table and operation keys of one test, in memory.
 *
 * @remarks
 * Only the boundaries are replaced: the account snapshot, the group table, the
 * connection facts, the profile table, the operation key table and the file
 * system. The agent management, its visibility and model rules, the definition
 * file writer and the operation service are the production classes, so a test
 * exercises the rules of Pages and not a copy.
 */
export class PageAgentWorld {
  /** Protected administrator operations over the same mocked boundaries. */
  public readonly administration: AgentProfileService;
  /** The management as the Pages interface uses it. */
  public readonly agents: PageAgentService;
  /** The operations an MCP client calls. */
  public readonly operations: PageAgentOperationService;
  /** The owner of the definition files, which a run holds while it reads them. */
  public readonly files: AgentDefinitionFiles;
  public readonly keys = new Map<string, StoredAgentOperation>();
  /** How often the profile table was written, to show that a refusal writes nothing. */
  public readonly writes = { profiles: 0 };
  public readonly groups: UserGroup[] = [];
  private profiles: AgentProfile[] = [];
  private readonly departments: { id: string; name: string }[] = [];
  private readonly accounts = new Map<string, AccountAccess>();
  private readonly models = new Map<string, ModelFacts>();

  public constructor(
    tickets?: Pick<AgentTicketParameterService, "choices" | "resolve">,
  ) {
    const profiles = new MemoryProfiles(this);
    const files = new AgentDefinitionFiles(AGENTS_DIRECTORY, () =>
      profiles.list(),
    );
    this.files = files;
    const dependencies = {
      profiles,
      connections: new MemoryConnections(this),
      authorization: new MemoryAuthorization(this),
      groups: new MemoryGroups(this),
      operations: new AgentOperationRegistry(),
      files,
      tickets,
    };
    this.administration = new AgentProfileService(dependencies);
    this.agents = new PageAgentService(
      dependencies,
      this.administration,
      files,
    );
    this.operations = new PageAgentOperationService({
      database: { transaction: (work) => this.transaction(work) },
      agents: this.agents,
    });
  }

  /** Adds an active person with the given rights. */
  public addPerson(userId: string, options: PersonOptions = {}): void {
    this.accounts.set(userId, account(userId, options));
  }

  /** Replaces the account of a person, as an administrator changing it does. */
  public changePerson(userId: string, options: PersonOptions): void {
    this.addPerson(userId, options);
  }

  /** Adds a group with its members. */
  public addGroup(id: string, memberIds: readonly string[]): void {
    this.groups.push({ id, name: `Group ${id}`, memberIds });
  }

  /** Deletes a group; shares that name it keep naming it until saved again. */
  public removeGroup(id: string): void {
    const index = this.groups.findIndex((group) => group.id === id);
    if (index >= 0) this.groups.splice(index, 1);
  }

  /** Adds a department of the instance. */
  public addDepartment(id: string): void {
    this.departments.push({ id, name: `Department ${id}` });
  }

  /**
   * Releases a model for the people its targets name, by default for everyone.
   *
   * @param id - Identifier of the administrator's model profile.
   * @param options - What differs from the plainest model.
   */
  public addModel(id: string, options: ModelOptions = {}): void {
    const efforts = options.efforts ?? [];
    const model = options.model ?? `model-${id}`;
    const connectionId = `connection-${id}`;
    this.models.set(connectionId, {
      connection: connectionRecord(connectionId, "openrouter"),
      isVerified: options.isVerified ?? true,
      scope: options.scope ?? GLOBAL_CONNECTION_SCOPE,
      catalog: catalogOf({
        id: model,
        name: model,
        contextWindow: null,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning:
          options.reasoning ?? (efforts.length > 0 ? "levels" : "none"),
        reasoningEfforts: efforts,
        defaultReasoningEffort: options.catalogDefault ?? null,
      }),
    });
    this.replace({
      id,
      name: options.name ?? `Model ${id}`,
      connectionId,
      model,
      // A model that lists levels is only released with one of them assigned.
      reasoningEffort:
        options.assignedEffort === undefined
          ? (efforts[0] ?? null)
          : options.assignedEffort,
      isActive: options.isActive ?? true,
      purposes: ["agent"],
      targets: options.targets ?? [{ kind: "system", targetId: "agent" }],
      configuration: {
        ...emptyAgentConfiguration("system"),
        accessMode: "shared",
        projectId: options.projectId ?? null,
      },
      revision: 1,
    });
  }

  /** Withdraws a model the way an administrator does: the assignment is gone. */
  public withdrawModel(id: string): void {
    this.profiles = this.profiles.filter((profile) => profile.id !== id);
  }

  /** Changes the connection of a released model, as a failed check does. */
  public setVerified(modelProfileId: string, isVerified: boolean): void {
    const profile = this.profiles.find((entry) => entry.id === modelProfileId);
    if (!profile) throw new Error(`Unknown model ${modelProfileId}`);
    const current = this.facts(profile.connectionId);
    this.models.set(profile.connectionId, { ...current, isVerified });
  }

  /** Places a user agent directly into the profile table, bypassing every rule. */
  public seedAgent(input: SeededAgent): void {
    const source = this.profiles.find(
      (entry) => entry.id === input.modelProfileId,
    );
    if (!source) throw new Error(`Unknown model ${input.modelProfileId}`);
    this.replace({
      id: input.id,
      name: input.name ?? `Agent ${input.id}`,
      ownerId: input.ownerId,
      modelProfileId: source.id,
      connectionId: input.pinnedConnectionId ?? source.connectionId,
      model: source.model,
      reasoningEffort: input.reasoningEffort ?? null,
      isActive: true,
      purposes: ["agent"],
      targets: [],
      configuration: {
        ...emptyAgentConfiguration("person"),
        accessMode: "shared",
        sharing: {
          isGlobal: input.isGlobal ?? false,
          targets: input.targets ?? [],
          ...(input.operator === undefined ? {} : { operator: input.operator }),
        },
      },
      revision: 1,
    });
  }

  /** The profile table as it is stored now. */
  public stored(): readonly AgentProfile[] {
    return this.profiles;
  }

  /** The stored user agents. */
  public storedAgents(): readonly AgentProfile[] {
    return this.profiles.filter((profile) => profile.ownerId !== undefined);
  }

  /** The facts of the connection of a released model. */
  public facts(connectionId: string): ModelFacts {
    const facts = this.models.get(connectionId);
    if (!facts) throw new Error(`Unknown connection ${connectionId}`);
    return facts;
  }

  /** The account, role and department state, as the authorization table reads. */
  public snapshot(): AuthorizationSnapshot {
    return {
      roles: [],
      departments: this.departments,
      accounts: [...this.accounts.values()],
    };
  }

  /** Stores a profile as it is, replacing one with the same identifier. */
  public replace(profile: AgentProfile): void {
    this.profiles = [
      ...this.profiles.filter((entry) => entry.id !== profile.id),
      profile,
    ];
  }

  /** The identity a verified MCP credential of the person resolves to. */
  public identity(userId: string): AgentIdentity {
    return {
      userId,
      isAdmin: this.accounts.get(userId)?.isAdmin ?? false,
      permissions: [],
    };
  }

  /** Calls an operation as the person and returns the result of its response. */
  public async call(
    userId: string,
    operation: string,
    parameters: unknown = {},
  ): Promise<unknown> {
    const response = await this.operations.handle(
      this.identity(userId),
      operation,
      parameters,
    );
    if (response === null) throw new Error(`Unhandled operation ${operation}`);
    return response.result;
  }

  /** Runs work in a transaction that leaves neither the profile nor its key when it fails. */
  public async transaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    const keys = this.keys;
    const transaction: DatabaseTransaction = {
      query: async (statement, parameters = {}) => {
        if (!statement.includes("FROM agent_operation_keys"))
          throw new Error("Unexpected query");
        const stored = keys.get(
          `${parameters.user_id}/${parameters.operation_id}`,
        );
        return stored
          ? [[stored.fingerprint, stored.operation, stored.resultJson]]
          : [];
      },
      execute: async (statement, parameters = {}) => {
        if (!statement.includes("INSERT INTO agent_operation_keys"))
          throw new Error("Unexpected statement");
        const key = `${parameters.user_id}/${parameters.operation_id}`;
        if (keys.has(key)) throw new Error(`Duplicate key "user_id: ${key}"`);
        keys.set(key, {
          operation: String(parameters.operation),
          fingerprint: String(parameters.fingerprint),
          resultJson: String(parameters.result_json),
        });
      },
    };
    const profiles = [...this.profiles];
    const stored = new Map(keys);
    try {
      return await work(transaction);
    } catch (error: unknown) {
      this.profiles = profiles;
      keys.clear();
      stored.forEach((value, key) => keys.set(key, value));
      throw error;
    }
  }
}

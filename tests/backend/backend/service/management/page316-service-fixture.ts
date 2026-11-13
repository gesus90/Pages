import { vi } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ManagementService } from "@/backend/service/management/ManagementService";
import { ADMINISTRATION_ROLE_ID, CAPABILITY } from "@/definition/Authorization";

import { organizationWorld } from "../accounts/administration-directory";

import type {
  CallCompletion,
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type {
  ManagementAgents,
  ManagementDatabase,
} from "@/backend/service/management/ManagementContext";

/** In-memory SQL boundary for operation receipts, descriptions and audit inserts, with no database process. */
export class ManagementDatabaseStub implements ManagementDatabase {
  public readonly receipts = new Map<string, StoredAgentOperation>();
  public readonly descriptions = new Map<string, string>();
  public readonly audited: SqlParameters[] = [];
  /** Reads only the persistence boundaries this unit owns. */
  public async query(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<readonly DatabaseValue[][]> {
    if (statement.includes("FROM agent_operation_keys")) {
      const receipt = this.receipts.get(
        `${String(parameters.user_id)}:${String(parameters.operation_id)}`,
      );
      return receipt
        ? [[receipt.fingerprint, receipt.operation, receipt.resultJson]]
        : [];
    }
    if (statement.includes("SELECT description"))
      return [[this.descriptions.get(String(parameters.id)) ?? ""]];
    return [];
  }
  /** Captures safe persistence effects for assertions. */
  public async execute(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<void> {
    if (statement.includes("INSERT INTO agent_operation_keys"))
      this.receipts.set(
        `${String(parameters.user_id)}:${String(parameters.operation_id)}`,
        {
          operation: String(parameters.operation),
          fingerprint: String(parameters.fingerprint),
          resultJson: String(parameters.result_json),
        },
      );
    if (statement.includes("INSERT INTO management_metadata"))
      this.descriptions.set(
        String(parameters.id),
        String(parameters.description),
      );
    if (statement.includes("INSERT INTO management_audit"))
      this.audited.push(parameters);
  }
  /** Reuses this mocked connection; no external transaction is opened. */
  public async transaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    return work(this);
  }
  /** Reads the same deterministic mock state. */
  public async readTransaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    return work(this);
  }
  /** Runs the production call's completion against the in-memory boundary. */
  public async runCall<Result>(
    work: () => Promise<Result>,
    finish: (completion: CallCompletion<Result>) => Promise<void>,
  ): Promise<Result> {
    const result = await work();
    await finish({ transaction: this, result, isNested: false });
    return result;
  }
}

/** Builds the production service with existing memory repositories and mocked mail/model boundaries. */
export function managementFixture(): {
  readonly service: ManagementService;
  readonly world: ReturnType<typeof organizationWorld>;
  readonly database: ManagementDatabaseStub;
  readonly send: ReturnType<typeof vi.fn>;
  readonly agents: ManagementAgents;
} {
  const world = organizationWorld();
  world.addAccount({
    userId: "management",
    roleId: ADMINISTRATION_ROLE_ID,
    departmentBound: false,
    rank: 1000000,
    permissions: [
      CAPABILITY.WRITE,
      CAPABILITY.MANAGE_PROJECTS,
      CAPABILITY.MANAGE_USERS,
      CAPABILITY.MILESTONES,
    ],
  });
  const database = new ManagementDatabaseStub();
  vi.spyOn(AuthorizationRepository.prototype, "snapshot").mockImplementation(
    () => world.repository.snapshot(),
  );
  vi.spyOn(AuthorizationRepository.prototype, "users").mockImplementation(() =>
    world.repository.users(),
  );
  vi.spyOn(AuthorizationRepository.prototype, "groups").mockImplementation(() =>
    world.repository.groups(),
  );
  vi.spyOn(AuthorizationRepository.prototype, "saveAccount").mockImplementation(
    (account) => world.repository.saveAccount(account),
  );
  vi.spyOn(AuthorizationRepository.prototype, "transaction").mockImplementation(
    (work) => work(world.repository),
  );
  const send = vi.fn().mockResolvedValue(undefined);
  const agents: ManagementAgents = {
    create: vi.fn(),
    detail: vi.fn(),
    update: vi.fn(),
    setActive: vi.fn(),
    forChannel: () => agents,
  };
  return {
    world,
    database,
    send,
    agents,
    service: new ManagementService({
      database,
      cache: world.cache,
      hasher: world.hasher,
      agents,
      invitations: { send },
    }),
  };
}

import { randomUUID } from "node:crypto";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { isUniqueViolationOn } from "@/backend/database/Database";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  AGENT_PROVIDERS,
  isAgentProvider,
  isApiProvider,
} from "@/definition/AgentConnection";

import { validateAgentInput } from "./AgentConnectionValidation";
import {
  requireAgentAdministrator,
  requireAgentConnection,
} from "./AgentServiceAccess";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  AgentCliState,
  AgentConnectionInput,
  AgentConnectionSummary,
} from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentOperationRegistry } from "./AgentOperationRegistry";

/** The connection service delegates CLI lifecycle work without knowing process details. */
export interface AgentCliAdministration {
  describe(
    actor: AccountAccess,
    connection: AgentConnectionRecord,
  ): Promise<AgentCliState>;
  cleanup(
    actor: AccountAccess,
    connection: AgentConnectionRecord,
  ): Promise<void>;
}

interface ConnectionDependencies {
  readonly repository: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
  readonly operations: AgentOperationRegistry;
  readonly cli: AgentCliAdministration;
}

/** Admin-only management of named, instance-wide connections, with no implicit checks. */
export class AgentConnectionService {
  private readonly dependencies: ConnectionDependencies;
  private readonly creationQueue = new SerialQueue();

  public constructor(dependencies: ConnectionDependencies) {
    this.dependencies = dependencies;
  }

  /** Loads metadata and previous results; it never calls a provider or starts a process. */
  public async list(actor: AccountAccess): Promise<AgentConnectionSummary[]> {
    requireAgentAdministrator(actor);
    const connections = await this.dependencies.repository.list();
    return Promise.all(
      connections.map(async (connection) => {
        const { repository, cli } = this.dependencies;
        const [auth, model, cliState] = await Promise.all([
          repository.checks().find(connection.id, "auth"),
          repository.checks().find(connection.id, "model"),
          isApiProvider(connection.provider)
            ? null
            : cli.describe(actor, connection),
        ]);
        return {
          id: connection.id,
          name: connection.name,
          provider: connection.provider,
          accessKind: AGENT_PROVIDERS[connection.provider].accessKind,
          hasApiKey: connection.hasApiKey,
          testModel: connection.testModel,
          reasoningEffort: connection.reasoningEffort,
          cli: cliState,
          checks: { auth, model },
          updatedAt: connection.updatedAt,
        };
      }),
    );
  }

  /** Serializes the count-and-insert operation so the 50-connection cap cannot race. */
  public async create(
    actor: AccountAccess,
    input: AgentConnectionInput,
  ): Promise<string> {
    requireAgentAdministrator(actor);
    return this.creationQueue.run(async () => {
      const provider = input.provider;
      if (!isAgentProvider(provider)) throw new AgentError("provider_invalid");
      const validated = validateAgentInput(input, provider);
      if (isApiProvider(provider) && !validated.apiKey)
        throw new AgentError("api_key_required");
      // A new connection has no catalog yet, so no effort can be confirmed.
      if (validated.reasoningEffort !== null)
        throw new AgentError("reasoning_effort_unsupported");
      const { repository, cipher } = this.dependencies;
      if ((await repository.count()) >= 50)
        throw new AgentError("connection_limit_reached");
      const id = randomUUID();
      await this.withNameConflict(async () =>
        repository.insert({
          id,
          name: validated.name,
          provider,
          secretEncrypted:
            validated.apiKey === null
              ? null
              : cipher.encrypt(id, validated.apiKey),
          testModel: validated.testModel,
          actorId: actor.userId,
        }),
      );
      return id;
    });
  }

  /** Retains a blank key, forbids provider changes, and invalidates stale checks. */
  public async update(
    actor: AccountAccess,
    id: string,
    input: AgentConnectionInput,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    await this.dependencies.operations.run(id, "write", async () => {
      const { repository, cipher } = this.dependencies;
      const connection = await requireAgentConnection(repository, id);
      if (
        input.provider !== undefined &&
        input.provider !== connection.provider
      )
        throw new AgentError("provider_immutable");
      const validated = validateAgentInput(input, connection.provider);
      // An unchanged choice stays valid even if a later catalog no longer lists it.
      const isModelUnchanged =
        validated.testModel === connection.testModel &&
        validated.reasoningEffort === connection.reasoningEffort;
      if (!isModelUnchanged)
        await this.requireListedEffort(
          id,
          validated.testModel,
          validated.reasoningEffort,
        );
      await this.withNameConflict(async () =>
        repository.update(id, {
          name: validated.name,
          secretEncrypted:
            validated.apiKey === null
              ? null
              : cipher.encrypt(id, validated.apiKey),
          testModel: validated.testModel,
          reasoningEffort: validated.reasoningEffort,
          clearModel: !isModelUnchanged,
          actorId: actor.userId,
        }),
      );
    });
  }

  /** Removes CLI credentials before deleting their record so failed cleanup is recoverable. */
  public async remove(actor: AccountAccess, id: string): Promise<void> {
    requireAgentAdministrator(actor);
    await this.dependencies.operations.run(id, "write", async () => {
      const { repository, cli } = this.dependencies;
      const connection = await requireAgentConnection(repository, id);
      if (!isApiProvider(connection.provider))
        await cli.cleanup(actor, connection);
      await repository.remove(id);
    });
  }

  /** Accepts only an effort the stored catalog lists for exactly the selected model. */
  private async requireListedEffort(
    id: string,
    model: string | null,
    effort: string | null,
  ): Promise<void> {
    if (effort === null) return;
    const catalog = await this.dependencies.repository.catalogs().find(id);
    const entry = catalog.models.find((candidate) => candidate.id === model);
    if (
      entry?.reasoning !== "levels" ||
      !entry.reasoningEfforts.includes(effort)
    )
      throw new AgentError("reasoning_effort_unsupported");
  }

  private async withNameConflict(
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      if (
        isUniqueViolationOn(error, 'lower("name")') ||
        isUniqueViolationOn(error, "lower(name)")
      )
        throw new AgentError("name_taken");
      throw error;
    }
  }
}

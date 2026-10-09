import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import {
  requireAgentAdministrator,
  requireAgentConnection,
} from "./AgentServiceAccess";

import type {
  ApiProviderAdapter,
  ProviderCheckOutcome,
} from "@/backend/agents/providers/ProviderContracts";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  AgentCheckKind,
  AgentCheckSummary,
  ApiProviderId,
} from "@/definition/AgentConnection";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentOperationRegistry } from "./AgentOperationRegistry";

/** CLI checks also use a shared deadline across version, status and optional generation. */
export interface AgentCliChecker {
  check(
    connection: AgentConnectionRecord,
    kind: AgentCheckKind,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome>;
}

/** Loads the model list after a confirmed access, inside the caller's lock. */
export interface AgentAccessCatalog {
  loadAfterAccess(id: string): Promise<void>;
}

interface CheckDependencies {
  readonly repository: AgentConnectionRepository;
  readonly catalog: AgentAccessCatalog;
  readonly cipher: InstanceSecretCipher;
  readonly providers: Readonly<Record<ApiProviderId, ApiProviderAdapter>>;
  readonly cli: AgentCliChecker;
  readonly operations: AgentOperationRegistry;
  readonly timeout?: (milliseconds: number) => AbortSignal;
}

/** Executes only explicit checks and persists their bounded, secret-free results. */
export class AgentCheckService {
  private readonly dependencies: CheckDependencies;
  private readonly timeout: (milliseconds: number) => AbortSignal;

  public constructor(dependencies: CheckDependencies) {
    this.dependencies = dependencies;
    this.timeout = dependencies.timeout ?? AbortSignal.timeout;
  }

  /** Rejects competing work and requires a saved API test model before any network call. */
  public async run(
    actor: AccountAccess,
    id: string,
    kind: AgentCheckKind,
  ): Promise<AgentCheckSummary> {
    requireAgentAdministrator(actor);
    return this.dependencies.operations.run(id, "check", async () => {
      const connection = await requireAgentConnection(
        this.dependencies.repository,
        id,
      );
      const startedAt = Date.now();
      const outcome = await this.execute(connection, kind);
      const checkedAt = new Date().toISOString();
      await this.updateCliState(actor, connection, outcome, checkedAt);
      const effort = kind === "model" ? connection.reasoningEffort : null;
      const check: AgentCheckSummary = {
        status: outcome.ok ? "passed" : "failed",
        errorCode: outcome.ok ? null : outcome.errorCode,
        detail: sanitizeCheckDetail(
          effort === null
            ? outcome.detail
            : { ...outcome.detail, reasoningEffort: effort },
        ),
        durationMs: Date.now() - startedAt,
        checkedAt,
      };
      await this.dependencies.repository
        .checks()
        .save(id, kind, check, actor.userId);
      if (kind === "auth" && outcome.ok)
        await this.dependencies.catalog.loadAfterAccess(id);
      return check;
    });
  }

  private async execute(
    connection: AgentConnectionRecord,
    kind: AgentCheckKind,
  ): Promise<ProviderCheckOutcome> {
    const { repository, cipher, providers, cli } = this.dependencies;
    if (!isApiProvider(connection.provider)) {
      return cli.check(
        connection,
        kind,
        this.timeout(kind === "model" ? 45_000 : 25_000),
      );
    }
    const testModel =
      kind === "auth" ? null : this.requireTestModel(connection.testModel);
    const signal = this.timeout(kind === "model" ? 30_000 : 15_000);
    const encrypted = await repository.findSecretEncrypted(connection.id);
    let apiKey: string;
    try {
      if (encrypted === null) throw new AgentError("secret_unavailable");
      apiKey = cipher.decrypt(connection.id, encrypted);
    } catch {
      return { ok: false, errorCode: "secret_unavailable", detail: {} };
    }
    const provider = providers[connection.provider];
    return testModel === null
      ? provider.checkAccess(apiKey, signal)
      : provider.runModelTest(
          {
            apiKey,
            model: testModel,
            reasoningEffort: connection.reasoningEffort,
          },
          signal,
        );
  }

  private requireTestModel(model: string | null): string {
    if (!model) throw new AgentError("test_model_required");
    return model;
  }

  private async updateCliState(
    actor: AccountAccess,
    connection: AgentConnectionRecord,
    outcome: ProviderCheckOutcome,
    checkedAt: string,
  ): Promise<void> {
    if (isApiProvider(connection.provider)) return;
    if (outcome.ok && connection.cliLoggedInAt === null) {
      await this.dependencies.repository.setCliAccount(
        connection.id,
        { loggedInAt: checkedAt, label: null },
        actor.userId,
      );
    } else if (
      !outcome.ok &&
      (outcome.errorCode === "cli_not_logged_in" ||
        outcome.errorCode === "cli_auth_failed")
    ) {
      await this.dependencies.repository.setCliAccount(
        connection.id,
        { loggedInAt: null, label: null },
        actor.userId,
      );
    }
  }
}

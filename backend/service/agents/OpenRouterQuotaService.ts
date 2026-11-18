import { UserPolicyService } from "@/backend/auth/UserPolicyService";

import { QuotaConnectionAccess } from "./QuotaConnectionAccess";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type { OpenRouterQuotaAccount } from "@/definition/OpenRouterQuota";
import type { OpenRouterQuotaProbe } from "./OpenRouterQuotaProbe";

interface OpenRouterQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  readonly probe: OpenRouterQuotaProbe;
}

/** Applies connection usage scope and administrator rights to OpenRouter quota readings. */
export class OpenRouterQuotaService {
  private readonly access: QuotaConnectionAccess;
  private readonly policy = new UserPolicyService();
  private readonly probe: OpenRouterQuotaProbe;

  public constructor(dependencies: OpenRouterQuotaDependencies) {
    this.access = new QuotaConnectionAccess(dependencies);
    this.probe = dependencies.probe;
  }

  /** Returns readings only for current connections and current account rights. */
  public async listStoredForUser(
    userId: string,
    connectionId?: string,
  ): Promise<QuotaSnapshot> {
    const readAt = new Date().toISOString();
    const view = await this.access.viewFor(userId, "openrouter", connectionId);
    if (!view) return { accounts: [], readAt };
    const canReadCredits = this.policy.isAdministrator(view.viewer.actor);
    const accounts = await Promise.all(
      view.connections.map((connection) =>
        this.account(connection, { canReadCredits }),
      ),
    );
    return { accounts, readAt };
  }

  /** Refreshes the permitted readings without involving any running model session. */
  public async refreshForUser(
    userId: string,
    connectionId?: string,
  ): Promise<void> {
    const view = await this.access.viewFor(userId, "openrouter", connectionId);
    if (!view) return;
    const canReadCredits = this.policy.isAdministrator(view.viewer.actor);
    await Promise.all(
      view.connections.flatMap((connection) => [
        this.probe.refreshKey(connection.id),
        ...(canReadCredits ? [this.probe.refreshCredits(connection.id)] : []),
      ]),
    );
  }

  private async account(
    connection: AgentConnectionRecord,
    { canReadCredits }: { readonly canReadCredits: boolean },
  ): Promise<OpenRouterQuotaAccount> {
    const { id, name } = connection;
    const [key, credits] = await Promise.all([
      this.probe.keyQuota(id),
      canReadCredits ? this.probe.creditQuota(id) : undefined,
    ]);
    return {
      provider: "openrouter",
      connectionId: id,
      name,
      key,
      ...(credits ? { credits } : {}),
    };
  }
}

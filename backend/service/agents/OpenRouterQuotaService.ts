import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";

import { QuotaConnectionAccess } from "./QuotaConnectionAccess";

import type {
  AgentConnectionRepository,
  OpenRouterCreditBaseline,
} from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type {
  OpenRouterBalanceDisplay,
  OpenRouterQuotaAccount,
} from "@/definition/OpenRouterQuota";
import type { OpenRouterQuotaProbe } from "./OpenRouterQuotaProbe";

interface OpenRouterQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  readonly probe: OpenRouterQuotaProbe;
}

/** The current card and whether a fresh baseline allowed the change. */
export interface OpenRouterBalanceUpdate {
  readonly snapshot: QuotaSnapshot;
  readonly isSaved: boolean;
}

function manualBalanceRemaining(
  startAmount: number,
  usageAtStart: number,
  usage: number,
): number {
  const spent = usage - usageAtStart;
  if (spent <= 0) return startAmount;
  const remaining = startAmount - spent;
  // At exhaustion, subtraction can leave a positive floating-point residue.
  const precision = Math.max(usage, startAmount) * Number.EPSILON;
  return remaining > precision ? remaining : 0;
}

/** Applies connection usage scope and administrator rights to OpenRouter quota readings. */
export class OpenRouterQuotaService {
  private readonly access: QuotaConnectionAccess;
  private readonly connections: AgentConnectionRepository;
  private readonly policy = new UserPolicyService();
  private readonly probe: OpenRouterQuotaProbe;

  public constructor(dependencies: OpenRouterQuotaDependencies) {
    this.access = new QuotaConnectionAccess(dependencies);
    this.connections = dependencies.connections;
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
        ...(canReadCredits ? [this.refreshCredits(connection.id)] : []),
      ]),
    );
  }

  /** Updates the display for an administrator who can use the connection. */
  public async setCreditDisplay(
    userId: string,
    connectionId: string,
    display: OpenRouterBalanceDisplay,
  ): Promise<OpenRouterBalanceUpdate> {
    await this.requireCreditAccess(userId, connectionId);
    const baseline =
      display.mode === "manual"
        ? await this.readBaseline(connectionId, display.startAmount)
        : null;
    if (display.mode === "manual" && baseline === null)
      return {
        snapshot: await this.listStoredForUser(userId, connectionId),
        isSaved: false,
      };
    if (baseline !== null) await this.requireCreditAccess(userId, connectionId);
    const saved = await this.connections.saveOpenRouterCreditDisplay(
      connectionId,
      baseline,
      userId,
    );
    if (!saved) throw new AgentError("openrouter_balance_changed");
    return {
      snapshot: await this.listStoredForUser(userId, connectionId),
      isSaved: true,
    };
  }

  private async requireCreditAccess(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const view = await this.access.viewFor(userId, "openrouter", connectionId);
    if (
      !view?.connections.length ||
      !this.policy.isAdministrator(view.viewer.actor)
    )
      throw new AgentAccessDeniedError();
  }

  private async readBaseline(
    id: string,
    startAmount: number,
  ): Promise<OpenRouterCreditBaseline | null> {
    const settings = await this.connections.findOpenRouterCreditSettings(id);
    const secretEncrypted = settings?.secretEncrypted;
    if (!secretEncrypted) return null;
    const { status, reading } = await this.probe.readFreshCredits(
      id,
      secretEncrypted,
    );
    if (status !== "reported" || reading === null) return null;
    return { secretEncrypted, startAmount, usageAtStart: reading.used };
  }

  private async refreshCredits(id: string): Promise<void> {
    const settings = await this.connections.findOpenRouterCreditSettings(id);
    if (settings?.secretEncrypted)
      await this.probe.refreshCredits(id, settings.secretEncrypted);
  }

  private async creditQuota(
    id: string,
  ): Promise<OpenRouterQuotaAccount["credits"]> {
    const settings = await this.connections.findOpenRouterCreditSettings(id);
    if (!settings) return undefined;
    const { secretEncrypted, startAmount, usageAtStart } = settings;
    const quota = this.probe.creditQuota(id, secretEncrypted);
    if (startAmount === null) return { mode: "account", ...quota };
    const { status, reading } = quota;
    if (usageAtStart === null)
      return {
        mode: "manual",
        startAmount,
        status: status === "reported" ? "baseline_missing" : status,
        reading: null,
      };
    return {
      mode: "manual",
      startAmount,
      status,
      reading: reading && {
        remaining: manualBalanceRemaining(
          startAmount,
          usageAtStart,
          reading.used,
        ),
        at: reading.at,
      },
    };
  }

  private async account(
    connection: AgentConnectionRecord,
    { canReadCredits }: { readonly canReadCredits: boolean },
  ): Promise<OpenRouterQuotaAccount> {
    const { id, name } = connection;
    const [key, credits] = await Promise.all([
      this.probe.keyQuota(id),
      canReadCredits ? this.creditQuota(id) : undefined,
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

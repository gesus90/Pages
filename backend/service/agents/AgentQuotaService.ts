import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type { OpenRouterBalanceDisplay } from "@/definition/OpenRouterQuota";
import type { AntigravityQuotaService } from "./AntigravityQuotaService";
import type { ClaudeQuotaService } from "./ClaudeQuotaService";
import type { CodexQuotaService } from "./CodexQuotaService";
import type {
  OpenRouterBalanceUpdate,
  OpenRouterQuotaService,
} from "./OpenRouterQuotaService";
import type { ZaiQuotaService } from "./ZaiQuotaService";

interface AgentQuotaDependencies {
  readonly claude: Pick<
    ClaudeQuotaService,
    "listStoredForUser" | "listForUser" | "refreshForUser"
  >;
  readonly codex: Pick<
    CodexQuotaService,
    "listStoredForUser" | "listForUser" | "refreshForUser"
  >;
  readonly antigravity: Pick<
    AntigravityQuotaService,
    "listStoredForUser" | "listForUser" | "refreshForUser"
  >;
  readonly openRouter: Pick<
    OpenRouterQuotaService,
    "listStoredForUser" | "refreshForUser" | "setCreditDisplay"
  >;
  readonly zai: Pick<
    ZaiQuotaService,
    "listStoredForUser" | "listForUser" | "refreshForUser"
  >;
}

/** The cards of every provider in the order of their connection names. */
function mergeSnapshots(snapshots: readonly QuotaSnapshot[]): QuotaSnapshot {
  const accounts = snapshots
    .flatMap((snapshot) => snapshot.accounts)
    .sort((first, second) => first.name.localeCompare(second.name));
  const readAt = snapshots
    .map((snapshot) => snapshot.readAt)
    .reduce((latest, next) =>
      Date.parse(next) > Date.parse(latest) ? next : latest,
    );
  return { accounts, readAt };
}

/**
 * Answers the Agents page: the quota cards of every provider a person may use.
 * @remarks
 * Each provider decides on its own which connections the person may use and
 * how it is asked; this service only puts the cards side by side. A card
 * belongs to exactly one provider, so the query of one card reaches only that
 * provider's service: the others find no such connection and ask nobody. The
 * providers are asked side by side, and the failed query of one is the status
 * of its own cards only.
 */
export class AgentQuotaService {
  private readonly dependencies: AgentQuotaDependencies;

  public constructor(dependencies: AgentQuotaDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the cards of a person from the stored figures, without asking a provider.
   * @param userId - The person reading the page.
   * @returns The cards of the providers with their stored figures.
   */
  public async listStoredForUser(userId: string): Promise<QuotaSnapshot> {
    const { claude, codex, antigravity, openRouter, zai } = this.dependencies;
    return mergeSnapshots(
      await Promise.all([
        claude.listStoredForUser(userId),
        codex.listStoredForUser(userId),
        antigravity.listStoredForUser(userId),
        openRouter.listStoredForUser(userId),
        zai.listStoredForUser(userId),
      ]),
    );
  }

  /**
   * Asks every provider about every connection of a person and reads their cards.
   * @param userId - The person reading the page.
   * @returns The cards of every provider; a failed query is the status of its card.
   */
  public async listForUser(userId: string): Promise<QuotaSnapshot> {
    const { claude, codex, antigravity, openRouter, zai } = this.dependencies;
    const [claudeSnapshot, codexSnapshot, antigravitySnapshot, zaiSnapshot] =
      await Promise.all([
        claude.listForUser(userId),
        codex.listForUser(userId),
        antigravity.listForUser(userId),
        zai.listForUser(userId),
        openRouter.refreshForUser(userId),
      ]);
    return mergeSnapshots([
      claudeSnapshot,
      codexSnapshot,
      antigravitySnapshot,
      zaiSnapshot,
      await openRouter.listStoredForUser(userId),
    ]);
  }

  /**
   * Asks about one connection and reads its card.
   * @param userId - The person reading the page.
   * @param connectionId - The connection of the card.
   * @returns A snapshot with the card, or without an account when the person
   * may not use the connection (any more) or it does not exist.
   */
  public async refreshForUser(
    userId: string,
    connectionId: string,
  ): Promise<QuotaSnapshot> {
    const { claude, codex, antigravity, openRouter, zai } = this.dependencies;
    const [claudeSnapshot, codexSnapshot, antigravitySnapshot, zaiSnapshot] =
      await Promise.all([
        claude.refreshForUser(userId, connectionId),
        codex.refreshForUser(userId, connectionId),
        antigravity.refreshForUser(userId, connectionId),
        zai.refreshForUser(userId, connectionId),
        openRouter.refreshForUser(userId, connectionId),
      ]);
    return mergeSnapshots([
      claudeSnapshot,
      codexSnapshot,
      antigravitySnapshot,
      zaiSnapshot,
      await openRouter.listStoredForUser(userId, connectionId),
    ]);
  }

  /** Updates the OpenRouter balance display and returns the current card. */
  public setOpenRouterBalanceDisplay(
    userId: string,
    connectionId: string,
    display: OpenRouterBalanceDisplay,
  ): Promise<OpenRouterBalanceUpdate> {
    return this.dependencies.openRouter.setCreditDisplay(
      userId,
      connectionId,
      display,
    );
  }
}

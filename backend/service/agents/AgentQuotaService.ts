import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type { OpenRouterBalanceDisplay } from "@/definition/OpenRouterQuota";
import type { AntigravityQuotaService } from "./AntigravityQuotaService";
import type { ClaudeQuotaService } from "./ClaudeQuotaService";
import type { CodexQuotaService } from "./CodexQuotaService";
import type {
  OpenRouterBalanceUpdate,
  OpenRouterQuotaService,
} from "./OpenRouterQuotaService";
import type { QuotaMeasurementService } from "./QuotaMeasurementService";
import type { ZaiCodingPlanQuotaService } from "./ZaiCodingPlanQuotaService";

interface AgentQuotaDependencies {
  readonly measurements: Pick<QuotaMeasurementService, "addPace">;
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
  readonly zaiCodingPlan: Pick<
    ZaiCodingPlanQuotaService,
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
    const { claude, codex, antigravity, openRouter, zaiCodingPlan } =
      this.dependencies;
    return this.withPace(
      await Promise.all([
        claude.listStoredForUser(userId),
        codex.listStoredForUser(userId),
        antigravity.listStoredForUser(userId),
        openRouter.listStoredForUser(userId),
        zaiCodingPlan.listStoredForUser(userId),
      ]),
    );
  }

  /**
   * Asks every provider about every connection of a person and reads their cards.
   * @param userId - The person reading the page.
   * @returns The cards of every provider; a failed query is the status of its card.
   */
  public async listForUser(userId: string): Promise<QuotaSnapshot> {
    const { claude, codex, antigravity, openRouter, zaiCodingPlan } =
      this.dependencies;
    const [claudeSnapshot, codexSnapshot, antigravitySnapshot, zaiSnapshot] =
      await Promise.all([
        claude.listForUser(userId),
        codex.listForUser(userId),
        antigravity.listForUser(userId),
        zaiCodingPlan.listForUser(userId),
        openRouter.refreshForUser(userId),
      ]);
    return this.withPace([
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
    const { claude, codex, antigravity, openRouter, zaiCodingPlan } =
      this.dependencies;
    const [claudeSnapshot, codexSnapshot, antigravitySnapshot, zaiSnapshot] =
      await Promise.all([
        claude.refreshForUser(userId, connectionId),
        codex.refreshForUser(userId, connectionId),
        antigravity.refreshForUser(userId, connectionId),
        zaiCodingPlan.refreshForUser(userId, connectionId),
        openRouter.refreshForUser(userId, connectionId),
      ]);
    return this.withPace([
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

  private withPace(
    snapshots: readonly QuotaSnapshot[],
  ): Promise<QuotaSnapshot> {
    return this.dependencies.measurements.addPace(mergeSnapshots(snapshots));
  }
}

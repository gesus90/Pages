import { logEvent } from "@/backend/logging/Logger";
import { AgentPlanOverviewCache } from "@/backend/service/agents/AgentPlanOverview";

import { toDashboardRun } from "../PicaMobileRunMapping";
import { readCurrentSessionUser } from "../PicaMobileSessionUser";
import { toPlanFlow } from "./PicaMobilePlanFlow";
import { toPlanRow } from "./PicaMobilePlanRows";

import type { AuthService } from "@/backend/auth/AuthService";
import type { AgentPlanActiveRun } from "@/backend/service/agents/AgentPlanActiveRuns";
import type { AgentPlanOverviewService } from "@/backend/service/agents/AgentPlanOverview";
import type { PicaMobilePlanRun } from "@/definition/PicaMobileProtocol";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type { PicaMobilePlanRunObserver } from "./PicaMobilePlanRunObserver";
import type {
  PicaMobilePlanOutcome,
  PicaMobilePlanReadOptions,
  PicaMobilePlansOutcome,
  PicaMobilePlansReadOptions,
  PicaMobilePlansProvider,
  PicaMobilePlansReader,
} from "./PicaMobilePlansProvider";

/** The Pages services the plan rows are read from. */
export interface PicaMobilePlansServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly agentPlanOverviewService: Pick<
    AgentPlanOverviewService,
    "read" | "readPlan"
  >;
}

/** What the provider is created with. */
export interface PagesPicaMobilePlansOptions {
  /**
   * Resolves the Pages services when a request needs them, so the listener
   * works before the database does.
   */
  readonly resolveServices: () => Promise<PicaMobilePlansServices>;
  /** Learns about run writes of this process. */
  readonly observer: Pick<PicaMobilePlanRunObserver, "watch">;
  /** Clock in milliseconds; tests replace it. */
  readonly now?: () => number;
}

const COMPONENT = "PagesPicaMobilePlans";
const SLOW_READ_MILLISECONDS = 500;

function toPlanRun(
  entry: AgentPlanActiveRun,
  options: PicaMobilePlanReadOptions,
): PicaMobilePlanRun {
  const run = toDashboardRun(entry);

  return options.withFlow ? { ...run, flow: toPlanFlow(entry) } : run;
}

/** Reads the plan rows of one connection with the checked runs it keeps. */
class PagesPicaMobilePlansReader implements PicaMobilePlansReader {
  private readonly options: PagesPicaMobilePlansOptions;
  private readonly cache = new AgentPlanOverviewCache();
  private readonly now: () => number;

  public constructor(options: PagesPicaMobilePlansOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** Reads every plan row of the account behind the session. */
  public async readPlans(
    session: PicaMobileSessionIdentity,
    options: PicaMobilePlansReadOptions,
  ): Promise<PicaMobilePlansOutcome> {
    const started = this.now();
    const services = await this.options.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    const entries = await services.agentPlanOverviewService.read(
      user.id,
      this.cache,
    );
    const rows = entries.flatMap((entry) => toPlanRow(entry, options) ?? []);

    this.reportSlowRead(started, rows.length);

    return { kind: "ready", rows };
  }

  /** Reads the latest own run of one plan of the account behind the session. */
  public async readPlan(
    session: PicaMobileSessionIdentity,
    planId: string,
    options: PicaMobilePlanReadOptions,
  ): Promise<PicaMobilePlanOutcome> {
    const services = await this.options.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    const plan = await services.agentPlanOverviewService.readPlan(
      user.id,
      planId,
    );

    return {
      kind: "ready",
      payload:
        plan.kind === "gone"
          ? { planId, access: "gone" }
          : {
              planId,
              access: "ok",
              run: plan.run === null ? null : toPlanRun(plan.run, options),
            },
    };
  }

  private reportSlowRead(started: number, rowCount: number): void {
    const durationMilliseconds = this.now() - started;

    if (durationMilliseconds < SLOW_READ_MILLISECONDS) {
      return;
    }

    logEvent({
      level: "warn",
      event: "pica_mobile.plans.slow",
      component: COMPONENT,
      message: "Reading the Pica Mobile plan rows was slow",
      metadata: { durationMilliseconds, rowCount },
    });
  }
}

/**
 * Answers `plans.v1` from the live Pages data.
 *
 * @remarks
 * Every read starts from the account the session belongs to right now and
 * reads the plans through the overview, which applies the plan rights on
 * every read. A read of 500 milliseconds or more is logged with its duration
 * and row count.
 */
export class PagesPicaMobilePlans implements PicaMobilePlansProvider {
  private readonly options: PagesPicaMobilePlansOptions;

  /**
   * Creates the provider.
   *
   * @param options - Services, run observer and clock.
   */
  public constructor(options: PagesPicaMobilePlansOptions) {
    this.options = options;
  }

  /** Creates the reader of one connection with its own checked runs. */
  public open(): PicaMobilePlansReader {
    return new PagesPicaMobilePlansReader(this.options);
  }

  /**
   * Follows the run writes of an account.
   *
   * @param userId - The account.
   * @param listener - Called after every write that changes a row.
   * @returns Stops following.
   */
  public watch(userId: string, listener: () => void): () => void {
    return this.options.observer.watch(userId, listener);
  }
}

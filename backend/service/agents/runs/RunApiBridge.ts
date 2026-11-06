import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { hasRunApiOwnership } from "@/backend/runtime/RunsMode";
import { pagesRunnerRequestSchema } from "@/definition/PagesRunsRunner";
import { AgentError } from "@/backend/error/AgentErrors";

import { readPlanSnapshot } from "../AgentPlanSnapshot";
import { RunsSocket } from "./RunsSocket";

import type { AgentPlanSessionGrants } from "../AgentPlanSessionAccess";
import type { RunApiCleanupRepository } from "@/backend/database/repositories/agent/RunApiCleanupRepository";
import type {
  PagesPlanBridgeOpened,
  PagesRunnerRequest,
  PagesRunnerFacts,
} from "@/definition/PagesRunsRunner";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";
import type { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

/** Live runner dependencies stay in the API, alongside its authenticated WebSocket endpoints. */
export interface RunApiServices {
  readonly runners: RunnerService;
  readonly provider: RunnerOpenRouterService;
  readonly pages: RunnerPagesAccessService;
  readonly runs: AgentPlanRunRepository;
  readonly cleanup: RunApiCleanupRepository;
  /** Opens and ends the plan bridge bearers, which only the API process may hold. */
  readonly planAccess: AgentPlanSessionGrants;
}

type RunApiStepRequest = Extract<
  PagesRunnerRequest,
  { readonly operation: "openPages" | "closePages" }
>;

/** Private API endpoint path; callers open a new connection for each bounded request. */
export function runApiSocketPath(databasePath: string): string {
  return path.join(path.dirname(databasePath), "runs-api", "api.sock");
}

/** Holds the API channel boundary separately from the scheduler's ownership lock. */
export class RunApiBridge {
  private readonly services: RunApiServices;
  private readonly socket: RunsSocket;
  private readonly capabilities = new SerialQueue();
  private timer: NodeJS.Timeout | null = null;
  private pending: Promise<void> | null = null;

  public constructor(
    services: RunApiServices,
    settings: { readonly databasePath: string },
  ) {
    this.services = services;
    this.socket = new RunsSocket(
      runApiSocketPath(settings.databasePath),
      () => undefined,
      (input) => this.handle(input),
    );
  }

  /** Rejects a second live listener instead of unlinking its control socket. */
  public async start(): Promise<void> {
    if (!hasRunApiOwnership())
      throw new Error("Run API ownership must precede recovery");
    await this.services.pages.recover();
    await this.socket.listen();
    this.timer = setInterval(() => this.scheduleCleanup(), 500);
    this.scheduleCleanup();
  }

  /** Stops direct requests before the API's services drain. */
  public async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.socket.close();
    await this.pending;
  }

  private async handle(input: unknown): Promise<unknown> {
    const request = pagesRunnerRequestSchema.parse(input);
    if (request.operation === "openPages" || request.operation === "closePages")
      return this.capabilities.run(() => this.dispatch(request));
    return this.dispatch(request);
  }

  private async dispatch(request: PagesRunnerRequest): Promise<unknown> {
    const { runners, provider } = this.services;
    switch (request.operation) {
      case "facts":
        return this.facts(request.connectionId);
      case "ready":
        return runners.ready(request.userId, request.connectionId);
      case "providerCatalog":
        return provider.catalog(request.userId, request.connectionId);
      case "enqueue":
        return runners.enqueue(
          request.userId,
          request.connectionId,
          request.plan,
          request.execution,
        );
      case "enqueueRetry":
        return runners.enqueueRetry(
          request.userId,
          request.connectionId,
          request.plan,
          request.execution,
        );
      case "cancel":
        await runners.cancel(request.connectionId, request.jobId);
        return null;
      case "pauseQueued":
        await runners.pauseQueued(request.connectionId, request.jobId);
        return null;
      case "closePages":
        await this.services.pages.close(
          request.runId,
          request.stepId,
          request.attemptId,
        );
        await this.services.cleanup.complete(request.attemptId);
        return null;
      case "openPages":
        return this.openPages(request);
      case "openPlanBridge":
        return this.openPlanBridge(request);
      case "closePlanBridge":
        return this.services.planAccess.revoke(request.runId, request.stepId);
    }
  }

  /** The API issues the credential and keeps the bearer; the engine only receives the bearer. */
  private async openPlanBridge(
    request: Extract<
      PagesRunnerRequest,
      { readonly operation: "openPlanBridge" }
    >,
  ): Promise<PagesPlanBridgeOpened> {
    const access = await this.services.planAccess.grant({
      userId: request.userId,
      runId: request.runId,
      stepId: request.stepId,
      instanceId: request.instanceId,
      tickets: request.tickets,
      lifetimeMs: request.lifetimeMs,
      reach: request.reach,
      ...(request.canSetStatus === undefined
        ? {}
        : { canSetStatus: request.canSetStatus }),
    });
    return {
      access: access
        ? {
            token: access.token,
            tools: access.tools ? [...access.tools] : null,
          }
        : null,
    };
  }

  private async openPages(request: RunApiStepRequest): Promise<null> {
    const run = await this.services.runs.find(request.runId);
    if (!run) throw new AgentError("plan_run_unavailable");
    const step = run.steps.find((entry) => entry.id === request.stepId);
    if (
      step?.execution?.attemptId !== request.attemptId ||
      step.status !== "running" ||
      run.stopRequested
    )
      throw new AgentError("plan_context_changed");
    const snapshot = readPlanSnapshot(
      await this.services.runs.snapshot(run.id),
    );
    const remote = snapshot.remoteSteps?.find(
      (entry) => entry.step.id === request.stepId,
    );
    if (!remote) throw new AgentError("plan_context_changed");
    await this.services.pages.open(run, remote, request.attemptId);
    return null;
  }

  private scheduleCleanup(): void {
    if (this.pending) return;
    this.pending = this.cleanCapabilities()
      .catch((error: unknown) => logCaughtError("RunApiBridge", error))
      .finally(() => {
        this.pending = null;
      });
  }

  private async cleanCapabilities(): Promise<void> {
    for (const entry of await this.services.cleanup.pending()) {
      await this.capabilities.run(() =>
        this.services.pages.close(entry.runId, entry.stepId, entry.attemptId),
      );
      await this.services.cleanup.complete(entry.attemptId);
    }
  }

  private async facts(connectionId: string): Promise<PagesRunnerFacts> {
    const { runners } = this.services;
    return {
      availability: await runners.availability(connectionId),
      pages: runners.supportsPagesAccess(connectionId),
      assets: runners.supportsAssetFiles(connectionId),
      openCode: runners.supportsOpenCode(connectionId),
      exactPayload: runners.supportsExactResultPayload(connectionId),
      continuation: runners.supportsContinuation(connectionId),
      contact: runners.contact(connectionId),
    };
  }
}

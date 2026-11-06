import { setTimeout as wait } from "node:timers/promises";

import { z } from "zod";

import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentError } from "@/backend/error/AgentErrors";
import { pagesRunnerFactsSchema } from "@/definition/PagesRunsRunner";
import { runnerInterpreterSchema } from "@/definition/RunnerExecution";
import { runnerJobSchema } from "@/definition/RunnerProtocol";
import { runnerOpenRouterResultSchema } from "@/definition/RunnerOpenRouter";

import { callRunApi } from "./RunsSocket";

import type {
  PagesRunnerFacts,
  PagesRunnerRequest,
} from "@/definition/PagesRunsRunner";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type {
  RunnerInterpreter,
  RunnerExecution,
} from "@/definition/RunnerExecution";
import type {
  RunnerJob,
  RunnerPlanBinding,
  RunnerCatalog,
} from "@/definition/RunnerProtocol";
import type { RunnerContact } from "@/backend/service/runner/RunnerContacts";

/** Run-side view of API-owned runner channels, with direct reads of durable progress. */
export class RunApiClient {
  private readonly socketPath: string;
  private readonly readers: RunnerService;
  private readonly facts = new Map<
    string,
    { readonly readAt: number; readonly view: PagesRunnerFacts }
  >();

  public constructor(socketPath: string, readers: RunnerService) {
    this.socketPath = socketPath;
    this.readers = readers;
  }

  /** Makes a bounded request; every call reconnects independently after a peer restart. */
  public async call(request: PagesRunnerRequest): Promise<unknown> {
    if (!["facts", "ready", "openPages", "enqueue"].includes(request.operation))
      return callRunApi(this.socketPath, request);
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        return await callRunApi(this.socketPath, request);
      } catch (error: unknown) {
        if (
          error instanceof AgentError ||
          error instanceof AgentPlanPausedError ||
          error instanceof AgentPlanCancelledError ||
          Date.now() >= deadline
        )
          throw error;
        await wait(250);
      }
    }
  }

  /** Refreshes live capability evidence before preparation reads synchronous capability predicates. */
  public async availability(
    connectionId: string,
  ): Promise<PagesRunnerFacts["availability"]> {
    try {
      return (await this.refresh(connectionId)).availability;
    } catch {
      this.facts.delete(connectionId);
      return "remoteOffline";
    }
  }

  /** Requires current executor rights on the API before returning interpreter choices. */
  public async ready(
    userId: string,
    connectionId: string,
  ): Promise<readonly RunnerInterpreter[]> {
    await this.refresh(connectionId);
    return z.array(runnerInterpreterSchema).parse(
      await this.call({
        version: 1,
        operation: "ready",
        userId,
        connectionId,
      }),
    );
  }

  /** Reads retained catalog metadata from the shared journal. */
  public catalog(connectionId: string): Promise<RunnerCatalog | undefined> {
    return this.readers.catalog(connectionId);
  }
  /** Uses freshly observed Pages capability only. */
  public supportsPagesAccess(connectionId: string): boolean {
    return this.current(connectionId)?.pages ?? false;
  }
  /** Uses freshly observed asset capability only. */
  public supportsAssetFiles(connectionId: string): boolean {
    return this.current(connectionId)?.assets ?? false;
  }
  /** Uses freshly observed OpenCode capability only. */
  public supportsOpenCode(connectionId: string): boolean {
    return this.current(connectionId)?.openCode ?? false;
  }
  /** Uses freshly observed exact-result capability only. */
  public supportsExactResultPayload(connectionId: string): boolean {
    return this.current(connectionId)?.exactPayload ?? false;
  }
  /** Uses freshly observed native-continuation capability only. */
  public supportsContinuation(connectionId: string): boolean {
    return this.current(connectionId)?.continuation ?? false;
  }

  /** Dispatches through the API's existing idempotent binding and authenticated channel. */
  public async enqueue(
    userId: string,
    connectionId: string,
    plan?: RunnerPlanBinding,
    execution?: RunnerExecution,
  ): Promise<RunnerJob> {
    if (!plan || !execution)
      throw new Error("Run dispatch requires an exact binding");
    return runnerJobSchema.parse(
      await this.call({
        version: 1,
        operation: "enqueue",
        userId,
        connectionId,
        plan,
        execution,
      }),
    );
  }

  /** Preserves explicit retry semantics; transport errors never trigger blind local replay. */
  public async enqueueRetry(
    userId: string,
    connectionId: string,
    plan: RunnerPlanBinding,
    execution: RunnerExecution,
  ): Promise<RunnerJob> {
    return runnerJobSchema.parse(
      await this.call({
        version: 1,
        operation: "enqueueRetry",
        userId,
        connectionId,
        plan,
        execution,
      }),
    );
  }

  /** Sends idempotent cancellation through the owner of the actual runner channel. */
  public async cancel(connectionId: string, jobId: string): Promise<void> {
    await this.call({ version: 1, operation: "cancel", connectionId, jobId });
  }
  /** Requests queue-only pause without killing a running remote agent. */
  public async pauseQueued(connectionId: string, jobId: string): Promise<void> {
    await this.call({
      version: 1,
      operation: "pauseQueued",
      connectionId,
      jobId,
    });
  }
  /** API restart cannot erase the durable attempt projection. */
  public progress(
    connectionId: string,
    runId: string,
    attemptId: string,
  ): Promise<RunnerJob | undefined> {
    return this.readers.progress(connectionId, runId, attemptId);
  }
  /** Reads deferred history directly from PostgreSQL. */
  public historyPending(jobId: string): Promise<number> {
    return this.readers.historyPending(jobId);
  }
  /** Reports lost contact after the bounded capability observation expires. */
  public contact(connectionId: string): RunnerContact {
    return (
      this.current(connectionId)?.contact ?? {
        state: "lost",
        lastContactAt: null,
      }
    );
  }
  /** Catalog requests use the authenticated API-owned provider channel. */
  public async providerCatalog(
    userId: string,
    connectionId: string,
  ): Promise<z.infer<typeof runnerOpenRouterResultSchema>> {
    return runnerOpenRouterResultSchema.parse(
      await this.call({
        version: 1,
        operation: "providerCatalog",
        userId,
        connectionId,
      }),
    );
  }

  private current(connectionId: string): PagesRunnerFacts | undefined {
    const stored = this.facts.get(connectionId);
    return stored && Date.now() - stored.readAt < 45_000
      ? stored.view
      : undefined;
  }

  private async refresh(connectionId: string): Promise<PagesRunnerFacts> {
    const view = pagesRunnerFactsSchema.parse(
      await this.call({ version: 1, operation: "facts", connectionId }),
    );
    this.facts.set(connectionId, { readAt: Date.now(), view });
    return view;
  }
}

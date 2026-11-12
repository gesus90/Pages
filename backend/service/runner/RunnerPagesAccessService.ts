import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import { canRunPlan } from "@/definition/AgentPlanTeam";
import { isOriginalRemoteJob } from "@/backend/service/agents/AgentPlanRemoteCancellation";
import { logCaughtError } from "@/backend/logging/Logger";
import { sanitizeFileName } from "@/backend/service/wiki/WikiFileTypes";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { assetFailure } from "@/backend/service/agents/AgentPlanStepFailure";
import { remoteAssetFile } from "@/backend/service/agents/AgentAssetRemoteFile";
import { ticketAssetReference } from "@/backend/service/agents/AgentTicketAssetReferences";
import { runnerPagesRequestSchema } from "@/definition/RunnerPagesAccess";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentError } from "@/backend/error/AgentErrors";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";
import {
  planSessionReach,
  planSessionScope,
} from "@/backend/service/agents/AgentPlanSessionAccess";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";
import { AGENT_STEP_PROGRESS_OPERATION } from "@/definition/AgentPlanStepProgress";
import { AGENT_STEP_REPORT_OPERATION } from "@/definition/AgentPlanStepReport";

import { RunnerAssetCursors } from "./RunnerAssetCursors";
import { RunnerAssetUploads } from "./RunnerAssetUploads";
import { FILE_CHUNK_BYTES, RunnerParameterFiles } from "./RunnerParameterFiles";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { PlanRemoteFile } from "@/definition/AgentPlanRemoteAccess";
import type { AgentPlanRemoteAccessRepository } from "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository";
import type { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import type { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import type { AgentPlanRemoteParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";
import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerPagesRequest } from "@/definition/RunnerPagesAccess";
import type { RunnerService } from "./RunnerService";

/** What the files a step reads through the download tool may add up to; parameter files have their own budget. */
const DOWNLOAD_TOTAL_BYTES = 10 * 1024 * 1024;

interface ActivePagesAccess {
  readonly attemptId: string;
  readonly downloads: Map<string, PlanRemoteFile>;
  readonly cursors: RunnerAssetCursors;
  readonly run: AgentPlanRun;
  readonly remote: RemotePlanStep;
  readonly token: string;
  readonly expiresAt: number;
}

interface PagesAccessDependencies {
  readonly credentials: AgentRunCredentialService;
  readonly runs: AgentPlanRunRepository;
  readonly plans: AgentPlanAccess;
  readonly runners: RunnerService;
  readonly parameters: AgentPlanRemoteParameters;
  readonly evidence: AgentPlanRemoteAccessRepository;
  readonly api: () => Promise<PagesAgentApiService>;
}

/** A live step capability held only by Pages; the remote host never receives its credential. */
export class RunnerPagesAccessService {
  private readonly dependencies: PagesAccessDependencies;
  private readonly uploads: RunnerAssetUploads;
  private readonly files: RunnerParameterFiles;
  private readonly active = new Map<string, ActivePagesAccess>();

  public constructor(dependencies: PagesAccessDependencies) {
    this.dependencies = dependencies;
    this.files = new RunnerParameterFiles(dependencies);
    this.uploads = new RunnerAssetUploads(async (ticket, bytes) =>
      (await dependencies.api()).uploadAsset(ticket, bytes),
    );
  }

  /** Restores only exact active attempts under current executor rights; old tokens are never inherited. */
  public async recover(): Promise<void> {
    for (const run of await this.dependencies.runs.unfinished()) {
      const snapshot = readPlanSnapshot(
        await this.dependencies.runs.snapshot(run.id),
      );
      for (const step of run.steps) await this.recoverStep(run, snapshot, step);
    }
  }

  /** Opens the same executor/read-or-YOLO scope as a local CLI, immediately before dispatch. */
  public async open(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    attemptId: string,
  ): Promise<void> {
    if (remote.command.pagesAccess !== 1) return;
    if (this.active.has(attemptId)) return;
    const node = remote.step;
    if (
      node.type !== "agent" ||
      !node.configuration?.provider ||
      !remote.parameters
    )
      throw new AgentError("plan_mcp_unavailable");
    const options = agentRunOptionsFor(
      node.configuration.provider,
      node.configuration.template.run,
    );
    const issued = await this.dependencies.credentials.issue(
      run.userId,
      planSessionScope({
        userId: run.userId,
        runId: run.id,
        stepId: node.id,
        reach: planSessionReach(node.configuration.provider, options),
        tickets: Object.values(remote.parameters.tickets).map((ticket) => ({
          id: ticket.id,
          key: ticket.key,
        })),
        lifetimeMs: options.timeoutMinutes * 60_000,
        canSetStatus: node.completion === "todos",
      }),
      // The worker owns execution deadlines; time spent queued must not expire an authorized step.
      0,
    );
    this.active.set(attemptId, {
      run,
      remote,
      attemptId,
      downloads: new Map(),
      cursors: new RunnerAssetCursors(),
      ...issued,
    });
    await this.dependencies.evidence.write(run.id, attemptId, (previous) => ({
      files: previous?.files ?? [],
      pages: "active",
      events: previous?.events ?? [],
    }));
  }

  /** Revokes the step even after failed dispatch, abort, timeout or normal completion. */
  public async close(
    runId: string,
    stepId: string,
    attemptId: string,
  ): Promise<void> {
    this.uploads.close(attemptId);
    const capability = this.active.get(attemptId);
    capability?.cursors.close();
    this.active.delete(attemptId);
    const run = await this.dependencies.runs.find(runId);
    const step = run?.steps.find((entry) => entry.id === stepId);
    if (
      step?.execution?.attemptId !== attemptId ||
      (!capability && step.resourceAccess?.pages !== "active")
    )
      return;
    await this.dependencies.credentials.revoke(runId, stepId);
    await this.dependencies.evidence.write(runId, attemptId, (previous) => ({
      files: previous?.files ?? [],
      events: previous?.events ?? [],
      pages: "closed",
    }));
  }

  /** Answers bounded auxiliary requests without persisting request arguments, results or credentials. */
  public async receive(
    connectionId: string,
    input: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    const message = runnerPagesRequestSchema.parse(input);
    if (Buffer.byteLength(JSON.stringify(message)) > 65536)
      throw new Error("Remote Pages request too large");
    let attemptId: string | undefined;
    try {
      const access = await this.requireAccess(connectionId, message);
      attemptId = access.attemptId;
      const result = await this.dispatch(access, message);
      return {
        version: 1,
        type: "pages-result",
        requestId: message.requestId,
        ok: true,
        result,
      };
    } catch (error: unknown) {
      return {
        version: 1,
        type: "pages-result",
        requestId: message.requestId,
        ok: false,
        error:
          error instanceof AgentError ? error.code : "plan_mcp_unavailable",
        ...this.uploadFailure(error, message, attemptId),
      };
    }
  }

  private async recoverStep(
    run: AgentPlanRun,
    snapshot: ReturnType<typeof readPlanSnapshot>,
    step: AgentPlanRun["steps"][number],
  ): Promise<void> {
    if (step.resourceAccess?.pages !== "active" || !step.execution) return;
    await this.dependencies.credentials.revoke(run.id, step.id);
    const remote = snapshot.remoteSteps?.find(
      (entry) => entry.step.id === step.id,
    );
    try {
      if (
        !remote ||
        step.status !== "running" ||
        run.stopRequested ||
        remote.command.pagesAccess !== 1
      )
        return;
      const job = await this.dependencies.runners.progress(
        remote.target.connectionId,
        run.id,
        step.execution.attemptId,
      );
      if (!canRestoreRemoteJob(run, step, job)) return;
      const plan = await this.dependencies.plans.require(
        run.userId,
        run.planId,
      );
      if (!canRunPlan(plan)) return;
      if (remote.parameters)
        await this.dependencies.parameters.authorize(
          run.userId,
          remote.parameters,
          { projectId: plan.projectId, target: remote.target },
        );
      await this.open(run, remote, step.execution.attemptId);
    } catch (error: unknown) {
      logCaughtError("RunnerPagesAccessService", error);
    } finally {
      if (!this.active.has(step.execution.attemptId))
        await this.dependencies.evidence.write(
          run.id,
          step.execution.attemptId,
          (previous) => ({
            files: previous?.files ?? [],
            events: previous?.events ?? [],
            pages: "closed",
          }),
        );
    }
  }

  private async requireAccess(
    connectionId: string,
    message: RunnerPagesRequest,
  ): Promise<ActivePagesAccess> {
    const job = await this.dependencies.runners.pagesJob(
      connectionId,
      message.jobId,
    );
    const access = job.plan ? this.active.get(job.plan.attemptId) : undefined;
    if (!access || access.expiresAt <= Date.now())
      throw new AgentError("plan_mcp_unavailable");
    const run = await this.dependencies.runs.find(access.run.id);
    const step = run?.steps.find((entry) => entry.id === access.remote.step.id);
    if (
      !run ||
      !["running", "pausing"].includes(run.status) ||
      run.stopRequested ||
      step?.status !== "running" ||
      step.execution?.attemptId !== job.plan?.attemptId
    )
      throw new AgentError("plan_mcp_unavailable");
    const plan = await this.dependencies.plans.require(run.userId, run.planId);
    if (!canRunPlan(plan)) throw new AgentError("plan_access_denied");
    if (access.remote.parameters)
      await this.dependencies.parameters.authorize(
        run.userId,
        access.remote.parameters,
        { projectId: plan.projectId, target: access.remote.target },
      );
    return access;
  }

  private async dispatch(
    access: ActivePagesAccess,
    message: RunnerPagesRequest,
  ): Promise<unknown> {
    const { request } = message;
    const prepared = access.remote.parameters;
    if (!prepared) throw new AgentError("plan_mcp_unavailable");
    if (request.kind === "upload") return this.upload(access, request);
    if (request.kind === "download") return this.download(access, request);
    if (request.kind === "lease") return { active: true };
    if (request.kind === "prepare") return this.files.manifest(access);
    if (request.kind === "asset") return this.files.chunk(access, request);
    const api = await this.dependencies.api();
    if (request.kind === "list") {
      const verification = await api.handle(access.token, {
        operation: "verify",
      });
      if (!("tools" in verification))
        throw new AgentError("plan_mcp_unavailable");
      return {
        tools: TOOL_ENTRIES.filter((entry) =>
          verification.tools.includes(entry.operation),
        ).map((entry) => entry.tool),
      };
    }
    return this.call(access, request, api);
  }

  private async upload(
    access: ActivePagesAccess,
    request: Extract<RunnerPagesRequest["request"], { kind: "upload" }>,
  ): Promise<unknown> {
    const identity = await (await this.dependencies.api()).verify(access.token);
    if (identity.run?.reach !== "full")
      throw new AgentError("plan_access_denied");
    const result = await this.uploads.receive(access.attemptId, request);
    if ("link" in result) {
      const outcome = result.expiresAt === null ? "uploaded" : "staged";
      const asset = ticketAssetReference(result.link);
      if (asset)
        await this.dependencies.evidence.write(
          access.run.id,
          access.attemptId,
          (previous) => ({
            pages: "active",
            events: previous?.events ?? [],
            files: [
              ...(previous?.files ?? []).filter(
                (file) =>
                  file.asset?.link !== result.link || file.outcome !== outcome,
              ),
              {
                parameter: "output",
                name: result.fileName,
                type: result.contentType,
                size: result.size,
                digest: request.digest,
                asset,
                representation: "original",
                outcome,
              },
            ],
          }),
        );
    }
    return result;
  }

  private async download(
    access: ActivePagesAccess,
    request: Extract<RunnerPagesRequest["request"], { kind: "download" }>,
  ): Promise<unknown> {
    const reference = ticketAssetReference(request.link);
    if (!reference || reference.link !== request.link)
      throw new AgentError("parameter_asset_reference_unsupported");
    const pinned = access.downloads.get(reference.link);
    const file = await (
      await this.dependencies.api()
    ).downloadAsset(
      access.token,
      reference.link,
      pinned?.digest ?? request.digest,
    );
    const metadata = remoteAssetFile("tool", reference, file);
    const parameterFiles = access.remote.parameters?.assets.length ?? 0;
    // Parameter files have their own budget of 512 MiB; what an agent downloads on top is bounded separately.
    if (
      !pinned &&
      (parameterFiles + access.downloads.size >= PLAN_HANDOVER_LIMITS.files ||
        [...access.downloads.values()].reduce(
          (total, entry) => total + entry.size,
          file.size,
        ) > DOWNLOAD_TOTAL_BYTES)
    )
      throw new AgentAssetError(
        "parameter_assets_too_large",
        reference,
        file.fileName,
      );
    if (request.offset > file.size)
      throw new AgentAssetError(
        "parameter_asset_unavailable",
        reference,
        file.fileName,
      );
    access.downloads.set(reference.link, metadata);
    await this.dependencies.evidence.write(
      access.run.id,
      access.attemptId,
      (previous) => ({
        pages: "active",
        events: previous?.events ?? [],
        files: [
          ...(previous?.files ?? []).filter(
            (entry) =>
              entry.asset?.link !== reference.link ||
              entry.parameter !== "tool",
          ),
          metadata,
        ],
      }),
    );
    const bytes = file.bytes.subarray(
      request.offset,
      request.offset + FILE_CHUNK_BYTES,
    );
    return {
      file: {
        ...metadata,
        textExtract:
          file.content.type === "text" &&
          file.content.representation === "text-extract"
            ? file.content.text
            : undefined,
      },
      base64: bytes.toString("base64"),
      size: file.size,
      done: request.offset + bytes.length === file.size,
    };
  }

  private uploadFailure(
    error: unknown,
    message: RunnerPagesRequest,
    attemptId: string | undefined,
  ): Readonly<Record<string, unknown>> {
    if (message.request.kind !== "upload" || !attemptId)
      return assetFailure(error);
    if (error instanceof AgentError)
      return {
        assetFailure: {
          id: "output",
          name: this.uploads.fileName(attemptId, message.request.ticket),
          cause: error.code,
        },
      };
    if (!(error instanceof AgentOperationError)) return assetFailure(error);
    const codes: Partial<Record<AgentOperationError["code"], AgentErrorCode>> =
      {
        CONFLICT: "parameter_asset_conflict",
        FORBIDDEN: "parameter_asset_write_denied",
        INVALID_REQUEST: "parameter_asset_output_invalid",
        NOT_FOUND: "parameter_asset_unavailable",
        PAYLOAD_TOO_LARGE: "parameter_assets_too_large",
      };
    const cause = codes[error.code] ?? "parameter_asset_unavailable";
    return {
      error: cause,
      assetFailure: {
        id: "output",
        name: this.uploads.fileName(attemptId, message.request.ticket),
        cause,
      },
    };
  }

  private rememberUpload(
    access: ActivePagesAccess,
    parameters: Readonly<Record<string, unknown>>,
    result: Awaited<ReturnType<PagesAgentApiService["handle"]>>,
  ): void {
    if (
      !("result" in result) ||
      !("ticket" in result.result) ||
      typeof result.result.ticket !== "string"
    )
      return;
    const operationId =
      typeof parameters.operationId === "string"
        ? parameters.operationId
        : result.result.ticket;
    const name =
      typeof parameters.fileName === "string"
        ? sanitizeFileName(parameters.fileName)
        : "output";
    this.uploads.register(
      access.attemptId,
      result.result.ticket,
      operationId,
      name,
    );
  }

  private async call(
    access: ActivePagesAccess,
    request: Extract<RunnerPagesRequest["request"], { kind: "call" }>,
    api: PagesAgentApiService,
  ): Promise<unknown> {
    const entry = TOOL_ENTRIES.find(
      (candidate) => candidate.tool.name === request.name,
    );
    if (!entry) throw new AgentError("plan_mcp_unavailable");
    let outcome: "ok" | "denied" | "failed" = "failed";
    try {
      const result = await api.handle(access.token, {
        operation: entry.operation,
        parameters: request.arguments,
      });
      if (entry.operation === "assets.upload.prepare")
        this.rememberUpload(access, request.arguments, result);
      outcome = "ok";
      return result;
    } catch (error: unknown) {
      outcome =
        error instanceof AgentOperationError && error.code === "FORBIDDEN"
          ? "denied"
          : "failed";
      return {
        isError: true,
        code: error instanceof AgentOperationError ? error.code : "FORBIDDEN",
        // A refused step report is only useful when the agent learns what to correct.
        ...(error instanceof AgentOperationError &&
        (entry.operation === AGENT_STEP_REPORT_OPERATION ||
          entry.operation === AGENT_STEP_PROGRESS_OPERATION)
          ? { details: error.details }
          : {}),
      };
    } finally {
      const attemptId = access.run.steps.find(
        (step) => step.id === access.remote.step.id,
      )?.execution?.attemptId;
      if (!attemptId) throw new AgentError("plan_context_changed");
      await this.dependencies.evidence.write(
        access.run.id,
        attemptId,
        (previous) => {
          const events = previous?.events ?? [];
          return {
            files: previous?.files ?? [],
            pages: "active",
            events: [
              ...events,
              {
                at: new Date().toISOString(),
                tool: entry.tool.name,
                target: auditTarget(request.arguments),
                result: outcome,
              },
            ],
          };
        },
      );
    }
  }
}

function auditTarget(
  parameters: Readonly<Record<string, unknown>>,
): string | null {
  const target =
    parameters.ticketId ?? parameters.pageId ?? parameters.projectId;
  return typeof target === "string" &&
    /^(?:[a-f0-9-]{36}|[A-Z][A-Z0-9]{0,15}-[0-9]{1,10})$/u.test(target)
    ? target
    : null;
}

function canRestoreRemoteJob(
  run: AgentPlanRun,
  step: AgentPlanRun["steps"][number],
  job: Awaited<ReturnType<RunnerService["progress"]>>,
): boolean {
  return (
    isOriginalRemoteJob(run, step, job) &&
    !job.cancellation &&
    ["queued", "accepted", "running"].includes(job.status)
  );
}

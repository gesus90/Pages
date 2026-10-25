import { runnerPagesRequestSchema } from "@/definition/RunnerPagesAccess";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentError } from "@/backend/error/AgentErrors";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";
import { planSessionReach } from "@/backend/service/agents/AgentPlanSessionAccess";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";

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

interface ActivePagesAccess {
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
  private readonly active = new Map<string, ActivePagesAccess>();

  public constructor(dependencies: PagesAccessDependencies) {
    this.dependencies = dependencies;
  }

  /** A restarted Pages process never restores a previous step's in-memory capability. */
  public async recover(): Promise<void> {
    for (const run of await this.dependencies.runs.unfinished()) {
      for (const step of run.steps) {
        if (step.resourceAccess?.pages !== "active" || !step.execution)
          continue;
        await this.dependencies.credentials.revoke(run.id, step.id);
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
  }

  /** Opens the same executor/read-or-YOLO scope as a local CLI, immediately before dispatch. */
  public async open(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    attemptId: string,
  ): Promise<void> {
    if (remote.command.pagesAccess !== 1) return;
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
      {
        runId: run.id,
        stepId: node.id,
        reach: planSessionReach(node.configuration.provider, options),
        operations: [],
        tickets: Object.values(remote.parameters.tickets).map((ticket) => ({
          id: ticket.id,
          key: ticket.key,
        })),
      },
      options.timeoutMinutes === 0 ? 0 : options.timeoutMinutes * 60_000,
    );
    this.active.set(attemptId, { run, remote, ...issued });
    await this.dependencies.evidence.write(run.id, attemptId, () => ({
      files: [],
      pages: "active",
      events: [],
    }));
  }

  /** Revokes the step even after failed dispatch, abort, timeout or normal completion. */
  public async close(
    runId: string,
    stepId: string,
    attemptId: string,
  ): Promise<void> {
    if (!this.active.delete(attemptId)) return;
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
    try {
      const access = await this.requireAccess(connectionId, message);
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
      };
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
    if (!plan.canEdit) throw new AgentError("plan_access_denied");
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
    if (request.kind === "lease") return { active: true };
    if (request.kind === "prepare")
      return { files: prepared.assets.map((asset) => asset.file) };
    if (request.kind === "asset") return this.asset(access, request);
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

  private async asset(
    access: ActivePagesAccess,
    request: Extract<RunnerPagesRequest["request"], { kind: "asset" }>,
  ): Promise<unknown> {
    const prepared = access.remote.parameters;
    const asset = prepared?.assets[request.index];
    if (!prepared || !asset)
      throw new AgentError("parameter_asset_unavailable");
    const bytes = await this.dependencies.parameters.readAsset(
      access.run.userId,
      asset,
      prepared,
    );
    if (request.offset > bytes.length)
      throw new AgentError("parameter_asset_unavailable");
    const chunk = bytes.subarray(request.offset, request.offset + 512 * 1024);
    const attemptId = access.run.steps.find(
      (entry) => entry.id === access.remote.step.id,
    )?.execution?.attemptId;
    if (!attemptId) throw new AgentError("plan_context_changed");
    await this.dependencies.evidence.write(
      access.run.id,
      attemptId,
      (previous) => ({
        pages: "active",
        events: previous?.events ?? [],
        files: [
          ...(previous?.files ?? []).filter(
            (file) =>
              file.digest !== asset.file.digest ||
              file.parameter !== asset.file.parameter,
          ),
          asset.file,
        ],
      }),
    );
    return {
      base64: chunk.toString("base64"),
      size: bytes.length,
      done: request.offset + chunk.length === bytes.length,
    };
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

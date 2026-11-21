import { isPlanRetryCode } from "@/backend/agents/AgentProviderFailure";
import { httpProviderReset } from "@/backend/agents/providers/ProviderReset";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentError } from "@/backend/error/AgentErrors";
import { apiProviderEndpoint } from "@/definition/AgentConnection";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";
import { requestHeaders } from "@/backend/agents/providers/ProviderHttpClient";
import { readTextProviderResponse } from "@/backend/agents/providers/TextProviderPayload";
import { classifyProviderError } from "@/backend/agents/providers/ProviderErrors";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { canRunPlan } from "@/definition/AgentPlanTeam";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import type { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { PlanBridgeGrants } from "@/backend/service/agents/bridge/PlanBridgeGrants";
import type { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import type { CliCredentialAccess } from "@/backend/agents/cli/CliContracts";
import type { RunnerJob } from "@/definition/RunnerProtocol";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerPagesRequest } from "@/definition/RunnerPagesAccess";
import type { RunnerManagedGitHub } from "./RunnerManagedGitHub";
import type { RunnerManagedFiles } from "./RunnerManagedFiles";

interface ManagedAccessDependencies {
  readonly files: RunnerManagedFiles;
  readonly nativeCredentials: (
    connectionId: string,
  ) => Promise<CliCredentialAccess>;
  readonly readBody: (reference: string) => Promise<string>;
  readonly binary: (
    job: RunnerJob,
    token: string,
    request: RunnerPagesRequest["request"],
  ) => Promise<unknown>;
  readonly uploadTicket: (
    attemptId: string,
    parameters: Readonly<Record<string, unknown>>,
    result: Awaited<ReturnType<PagesAgentApiService["handle"]>>,
  ) => void;
  readonly github: RunnerManagedGitHub;
  readonly connections: AgentConnectionRepository;
  readonly access: AgentConnectionAccess;
  readonly cipher: InstanceSecretCipher;
  readonly runs: AgentPlanRunRepository;
  readonly plans: AgentPlanAccess;
  readonly bridges: PlanBridgeGrants;
  readonly api: () => Promise<PagesAgentApiService>;
}

/** Supplies ephemeral provider headers and existing session tools to runner-owned turns. */
export class RunnerManagedAccess {
  private readonly dependencies: ManagedAccessDependencies;

  public constructor(dependencies: ManagedAccessDependencies) {
    this.dependencies = dependencies;
  }

  /** Rechecks the durable owner and current rights on every auxiliary call. */
  public async receive(
    job: RunnerJob,
    request: RunnerPagesRequest["request"],
  ): Promise<unknown> {
    await this.requireOwner(job);
    if (request.kind === "lease") return { active: true };
    if (request.kind === "prepare" || request.kind === "asset")
      return this.dependencies.files.receive(job, request);
    if (request.kind === "turn-context") return this.providerContext(job);
    if (request.kind === "provider-response")
      return this.providerResponse(job, request);
    if (request.kind === "provider-body")
      return this.providerBody(job, request.offset, request.source);
    return this.receiveBridge(job, request);
  }

  private async requireOwner(job: RunnerJob): Promise<void> {
    const { plan: binding, execution: command } = job;
    if (!binding?.managed || !command?.managed)
      throw new AgentError("plan_context_changed");
    const run = await this.dependencies.runs.find(binding.runId);
    const isDraining = isDrainingJob(run, job.jobId);
    if (
      !run ||
      run.stopRequested ||
      (!isDraining && !["running", "pausing", "paused"].includes(run.status))
    )
      throw new AgentError("plan_access_denied");
    if (!(await this.hasRunningOwner(run, binding, isDraining)))
      throw new AgentError("plan_access_denied");
    if (command.managed.connectionId)
      await this.dependencies.access.requireUser(
        run.userId,
        command.managed.connectionId,
      );
  }

  private async hasRunningOwner(
    run: AgentPlanRun,
    binding: NonNullable<RunnerJob["plan"]>,
    isDraining: boolean,
  ): Promise<boolean> {
    if (!isDraining) {
      const owner = allPlanRunResults(run).find(
        (step) => step.id === (binding.ownerStepId ?? binding.stepId),
      );
      if (owner?.status !== "running") return false;
    }
    return canRunPlan(
      await this.dependencies.plans.require(run.userId, run.planId),
    );
  }

  private async providerBody(
    job: RunnerJob,
    offset: number,
    source: "prompt" | "body" | undefined,
  ): Promise<unknown> {
    const program = job.execution?.program;
    let reference = job.execution?.managed?.promptFile;
    if (source !== "prompt")
      reference = program?.kind === "api" ? program.bodyFile : undefined;
    if (!reference) throw new AgentError("plan_context_changed");
    const bytes = Buffer.from(await this.dependencies.readBody(reference));
    if (bytes.length > 33554432 || offset > bytes.length)
      throw new AgentError("plan_context_changed");
    const chunk = bytes.subarray(offset, offset + 524288);
    return {
      base64: chunk.toString("base64"),
      size: bytes.length,
      done: offset + chunk.length === bytes.length,
    };
  }

  private async receiveBridge(
    job: RunnerJob,
    request: RunnerPagesRequest["request"],
  ): Promise<unknown> {
    const { plan: binding, execution: command } = job;
    if (!binding || !command?.managed)
      throw new AgentError("plan_context_changed");
    const sealed = command.managed.bridge;
    if (!sealed) throw new AgentError("plan_mcp_unavailable");
    const bearer = this.dependencies.cipher.decrypt(
      `runner-turn:${binding.attemptId}`,
      sealed,
    );
    const token = await this.dependencies.bridges.resolve(bearer);
    if (!token) throw new AgentError("plan_mcp_unavailable");
    if (request.kind === "upload" || request.kind === "download")
      return this.dependencies.binary(job, token, request);
    if (request.kind === "list") return this.bridgeTools(token);
    if (request.kind !== "call") throw new AgentError("plan_mcp_unavailable");
    return this.bridgeCall(binding, request, token);
  }

  private async bridgeTools(token: string): Promise<unknown> {
    const api = await this.dependencies.api();
    const identity = await api.handle(token, { operation: "verify" });
    if (!("tools" in identity)) throw new AgentError("plan_mcp_unavailable");
    return {
      tools: TOOL_ENTRIES.filter((entry) =>
        identity.tools.includes(entry.operation),
      ).map((entry) => entry.tool),
    };
  }

  private async bridgeCall(
    binding: NonNullable<RunnerJob["plan"]>,
    request: Extract<RunnerPagesRequest["request"], { kind: "call" }>,
    token: string,
  ): Promise<unknown> {
    const entry = TOOL_ENTRIES.find((tool) => tool.tool.name === request.name);
    if (!entry) throw new AgentError("plan_mcp_unavailable");
    const api = await this.dependencies.api();
    try {
      const result = await api.handle(token, {
        operation: entry.operation,
        parameters: request.arguments,
      });
      if (entry.operation === "assets.upload.prepare")
        this.dependencies.uploadTicket(
          binding.recordingAttemptId ?? binding.attemptId,
          request.arguments,
          result,
        );
      return result;
    } catch (error: unknown) {
      if (!(error instanceof AgentOperationError)) throw error;
      return { isError: true, code: error.code, details: error.details };
    }
  }

  private async providerContext(job: RunnerJob): Promise<unknown> {
    const program = job.execution?.program;
    if (program?.kind === "cli" && program.access === "full_environment")
      return {};
    if (
      program?.kind === "cli" &&
      job.execution?.managed?.connectionId &&
      program.route.tool === "opencode"
    )
      return this.openCodeContext(job);
    if (program?.kind !== "api") return this.dependencies.github.context(job);
    const connection = await this.dependencies.connections.find(
      program.connectionId,
    );
    if (!connection || connection.provider !== program.provider)
      throw new AgentError("plan_context_changed");
    const apiKey = await this.apiKey(program.connectionId);
    return {
      url: `${apiProviderEndpoint(program.provider)}${program.path}`,
      headers: requestHeaders(program.provider, apiKey),
    };
  }

  private async openCodeContext(job: RunnerJob): Promise<unknown> {
    const program = job.execution?.program;
    const connectionId = job.execution?.managed?.connectionId;
    if (program?.kind !== "cli" || !connectionId)
      throw new AgentError("plan_context_changed");
    const github = await this.dependencies.github.context(job);
    if (!program.linkedProvider) {
      const credentials =
        await this.dependencies.nativeCredentials(connectionId);
      return {
        ...github,
        secrets: [...(github.secrets ?? []), ...(credentials.secrets ?? [])],
        auth: credentials.environmentFor(program.model.split("/")[0])
          .OPENCODE_AUTH_CONTENT,
      };
    }
    const connection = await this.dependencies.connections.find(connectionId);
    if (!connection || connection.provider !== program.linkedProvider)
      throw new AgentError("plan_context_changed");
    const apiKey = await this.apiKey(connectionId);
    return {
      ...github,
      auth: JSON.stringify({
        [program.linkedProvider]: { type: "api", key: apiKey },
      }),
    };
  }

  private async providerResponse(
    job: RunnerJob,
    response: Extract<
      RunnerPagesRequest["request"],
      { kind: "provider-response" }
    >,
  ): Promise<unknown> {
    const program = job.execution?.program;
    if (program?.kind !== "api") throw new AgentError("plan_context_changed");
    const failureCode = classifyProviderError(
      response.status,
      response.payload,
    );
    if (failureCode)
      return {
        failureCode,
        resetAt: isPlanRetryCode(failureCode)
          ? httpProviderReset(
              new Response(null, {
                status: response.status,
                headers: response.headers,
              }),
              response.payload,
              failureCode,
            )
          : null,
      };
    const apiKey = await this.apiKey(program.connectionId);
    try {
      return {
        output: readTextProviderResponse(program.provider, response.payload, {
          webSearch: program.webSearch,
        }).replaceAll(apiKey, "[redacted]"),
      };
    } catch (error: unknown) {
      if (!(error instanceof AgentExecutionError)) throw error;
      return { failureCode: "provider_bad_response" };
    }
  }

  private async apiKey(connectionId: string): Promise<string> {
    const encrypted =
      await this.dependencies.connections.findSecretEncrypted(connectionId);
    if (!encrypted) throw new AgentError("secret_unavailable");
    return this.dependencies.cipher.decrypt(connectionId, encrypted);
  }
}

function isDrainingJob(run: AgentPlanRun | null, jobId: string): boolean {
  return (
    run?.runnerJobs?.some(
      (entry) => entry.jobId === jobId && entry.closeout === "pending",
    ) === true
  );
}

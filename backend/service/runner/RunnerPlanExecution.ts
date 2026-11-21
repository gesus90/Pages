import { randomUUID } from "node:crypto";

import { isPlanRetryCode } from "@/backend/agents/AgentProviderFailure";
import { readTicketAssetInput } from "@/backend/agents/TicketAssetInput";
import { createTextProviderRequest } from "@/backend/agents/providers/TextProviderPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentProviderError } from "@/backend/error/AgentProviderError";
import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import { isApiProvider } from "@/definition/AgentConnection";
import {
  runnerExecutionSchema,
  runnerToolFor,
} from "@/definition/RunnerExecution";

import { LOCAL_RUNNER_CONNECTION_ID } from "./LocalRunnerIdentity";
import { RunnerManagedJobs } from "./RunnerManagedJobs";
import { RunnerPlanSession } from "./RunnerPlanSession";

import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { ExecutionAuthorizer } from "@/backend/agents/ScopedExecution";
import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanRequestControl,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { ApiProviderId } from "@/definition/AgentConnection";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { RunnerExecution } from "@/definition/RunnerExecution";
import type {
  RunnerJob,
  RunnerJobResult,
  RunnerPlanBinding,
} from "@/definition/RunnerProtocol";
import type { ManagedRunnerTransport } from "./RunnerManagedJobs";
import type { ToolInventory } from "@/definition/RemoteSetup";

// Managed execution uses the same bound as the runner's admission gate.
const MANAGED_RUNNER_CAPACITY = 4;

interface RunnerPlanDependencies {
  readonly access: ExecutionAuthorizer;
  readonly runners: ManagedRunnerTransport;
  readonly runs: Pick<AgentPlanRunRepository, "find" | "snapshot">;
  readonly cipher: InstanceSecretCipher;
  readonly bridgeUrl: string;
  readonly saveBody: (planId: string, body: string) => Promise<string>;
  readonly finishLegacy: (runId: string) => Promise<void>;
}

interface PlanTurnControl {
  readonly signal: AbortSignal;
  readonly observer?: PlanSessionObserver;
  readonly resume?: string | null;
  readonly session?: AgentPlanSessionInput;
  readonly turn?: number;
  readonly historyBase?: number;
  readonly request?: PlanRequestControl;
}

/** Executes every plan model through the same worker contract as remote jobs. */
export class RunnerPlanExecution implements PlanExecution {
  /** The runner importer owns journal sequencing and usage, including retained turns. */
  public readonly hasDurableLocalSessions = true;
  private readonly dependencies: RunnerPlanDependencies;
  private readonly jobs: RunnerManagedJobs;
  private activeTurns = 0;

  public constructor(dependencies: RunnerPlanDependencies) {
    this.dependencies = dependencies;
    this.jobs = new RunnerManagedJobs(dependencies.runners, dependencies.runs);
  }

  /** Issues a provider request from the worker, keeping credentials outside the durable command. */
  public async run(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    control?: PlanRequestControl,
  ): Promise<string> {
    const result = control?.runnerJob
      ? await this.jobs.reattach(
          control.runnerJob,
          input.resourceContext?.runId ?? "",
          signal,
        )
      : await this.execute(input, { signal, request: control });
    if (isPlanRetryCode(result.failureCode))
      throw new AgentProviderError({
        code: result.failureCode,
        resetAt: result.resetAt ?? null,
      });
    if (result.failureCode) throw new AgentError(result.failureCode);
    if (
      result.exitCode !== 0 ||
      result.reason ||
      result.closeout !== "confirmed"
    )
      throw new AgentError("plan_runner_failed");
    return result.output ?? "";
  }

  /** Provides retained group, loop, decision and swarm sessions over native continuation. */
  public async open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    return new RunnerPlanSession(
      input,
      { signal, observer, resume: input.resumeSessionId ?? null },
      {
        execute: (next, control) =>
          this.execute(
            {
              ...input,
              ...next,
              resourceContext: next.resourceContext ?? input.resourceContext,
            },
            { ...control, session: input },
          ),
        setPaused: (isPaused) =>
          this.setRunPaused(input.resourceContext?.runId ?? "", isPaused),
      },
    );
  }

  /** Keeps the original grant usable while an adopted worker finishes its turn. */
  public async restoreAccess(
    reference: NonNullable<AgentPlanSessionRecord["runnerJob"]>,
    runId: string,
  ): Promise<CliSessionMcp | null> {
    const job = await this.dependencies.runners.progress(
      reference.connectionId,
      runId,
      reference.attemptId,
    );
    if (job?.jobId !== reference.jobId || job.plan?.runId !== runId)
      throw new AgentError("plan_context_changed");
    const sealed = job.execution?.managed?.bridge;
    if (!sealed) return null;
    return {
      url: this.dependencies.bridgeUrl,
      token: this.dependencies.cipher.decrypt(
        `runner-turn:${reference.attemptId}`,
        sealed,
      ),
      tools: null,
    };
  }

  /** Reattaches the original worker while later turns use the usual authorized dispatch. */
  public async reattach(
    input: AgentPlanSessionInput,
    reference: NonNullable<AgentPlanSessionRecord["runnerJob"]>,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    let isFirst = true;
    const runId = input.resourceContext?.runId ?? "";
    const job = await this.dependencies.runners.progress(
      reference.connectionId,
      runId,
      reference.attemptId,
    );
    return new RunnerPlanSession(
      input,
      {
        signal,
        observer,
        resume: null,
        initialTurn: job?.plan?.turn,
        initialBase: job?.plan?.historyBase,
      },
      {
        execute: (next, control) => {
          if (isFirst) {
            isFirst = false;
            return this.jobs.reattach(reference, runId, control.signal);
          }
          return this.execute(
            {
              ...input,
              ...next,
              resourceContext: next.resourceContext ?? input.resourceContext,
            },
            { ...control, session: input },
          );
        },
        setPaused: (isPaused) => this.setRunPaused(runId, isPaused),
      },
    );
  }

  /** Applies acknowledged native suspension to all active jobs of a run. */
  public setRunPaused(runId: string, isPaused: boolean): Promise<void> {
    return this.jobs.setRunPaused(runId, isPaused);
  }

  /** Counts pending dispatch as occupied so simultaneous helpers cannot overbook admission. */
  public capacity(): { readonly limit: number; readonly active: number } {
    return { limit: MANAGED_RUNNER_CAPACITY, active: this.activeTurns };
  }

  /** Retains historical owner cleanup without starting another legacy process. */
  public finishPlanRun(runId: string): Promise<void> {
    return this.dependencies.finishLegacy(runId);
  }

  private async execute(
    input: AgentPlanExecutionInput,
    control: PlanTurnControl,
  ): Promise<RunnerJobResult> {
    this.activeTurns += 1;
    try {
      return await this.executeTurn(input, control);
    } finally {
      this.activeTurns -= 1;
    }
  }

  private async executeTurn(
    input: AgentPlanExecutionInput,
    control: PlanTurnControl,
  ): Promise<RunnerJobResult> {
    await input.beforeStart?.();
    if (!input.runnerTarget) {
      await this.dependencies.access.requireUser(
        input.userId,
        input.agent.connection.id,
      );
      if (input.agent.connection.provider === "claude_code")
        await this.dependencies.access.requireClaudeBudget?.(input.userId);
    }
    control.signal.throwIfAborted();
    const binding = await this.turnBinding(input, control);
    const connectionId =
      input.runnerTarget?.connectionId ?? LOCAL_RUNNER_CONNECTION_ID;
    await this.dependencies.runners.ready(input.userId, connectionId);
    const command = await this.command(input, control, binding);
    return this.jobs.run({
      userId: input.userId,
      connectionId,
      binding,
      command,
      signal: control.signal,
      progressed: nativePlanObserver(input, control.session),
      dispatched: async (job) => {
        await control.request?.dispatched({
          connectionId,
          jobId: job.jobId,
          attemptId: binding.attemptId,
        });
        control.observer?.started({
          mode: "one_shot",
          processId: null,
          runnerJob: {
            connectionId,
            jobId: job.jobId,
            attemptId: binding.attemptId,
          },
          startedAt: new Date().toISOString(),
          arguments: [],
          unattended: control.session?.options.access ?? "read_only",
        });
      },
    });
  }

  private async turnBinding(
    input: AgentPlanExecutionInput,
    control: PlanTurnControl,
  ): Promise<RunnerPlanBinding> {
    return {
      ...(await this.binding(input)),
      ...(control.request ? { attemptId: control.request.attemptId } : {}),
      turn: control.turn ?? 1,
      historyBase: control.historyBase ?? 0,
      recordingAttemptId:
        input.recording?.key.attemptId ?? control.request?.attemptId,
      recordingInstanceId: input.recording?.instanceId,
      recordingAgentId: input.recording?.agentId,
      recordingConnectionId: input.recording?.connectionId,
      recordingModel: input.recording?.requestedModel ?? input.agent.model,
    };
  }

  private async command(
    input: AgentPlanExecutionInput,
    control: PlanTurnControl,
    binding: RunnerPlanBinding,
  ): Promise<RunnerExecution> {
    let program = await this.commandProgram(input, control, binding);
    let promptFile: string | undefined;
    if (
      "prompt" in program &&
      (program.prompt.length > 100000 ||
        Buffer.byteLength(program.prompt) > 200000)
    ) {
      promptFile = await this.dependencies.saveBody(
        binding.planId,
        program.prompt,
      );
      program = { ...program, prompt: "" };
    }
    const timeoutSeconds = turnTimeoutSeconds(input, control);
    return runnerExecutionSchema.parse({
      version: 1,
      revision: binding.planRevision,
      workspace: input.directory ?? control.session?.directory ?? "/",
      timeoutSeconds,
      outputBytes: program.kind === "api" ? 1048576 : 65536,
      input: "",
      pagesAccess: 1,
      managed: await this.managedCommand(input, control, binding, promptFile),
      ...(program.kind === "cli" ? this.cliExtras(input, control) : {}),
      program,
    });
  }

  private async managedCommand(
    input: AgentPlanExecutionInput,
    control: PlanTurnControl,
    binding: RunnerPlanBinding,
    promptFile: string | undefined,
  ): Promise<RunnerExecution["managed"]> {
    const bridge = control.session?.mcp?.token;
    return {
      promptFile,
      connectionId: input.runnerTarget ? undefined : input.agent.connection.id,
      files: await this.fileBasis(input),
      ...(bridge
        ? {
            bridge: this.dependencies.cipher.encrypt(
              `runner-turn:${binding.attemptId}`,
              bridge,
            ),
          }
        : {}),
    };
  }

  private cliExtras(
    input: AgentPlanExecutionInput,
    control: PlanTurnControl,
  ): Record<string, unknown> {
    return {
      resultPayloadVersion: 1,
      progressVersion: 1,
      ...this.account(input),
      continuation: {
        version: 1,
        ...(control.resume ? { resumeSessionId: control.resume } : {}),
      },
      ...(control.session?.options.browser ? { browser: 1 } : {}),
    };
  }

  private async commandProgram(
    input: AgentPlanExecutionInput,
    control: PlanTurnControl,
    binding: RunnerPlanBinding,
  ): Promise<RunnerExecution["program"]> {
    return input.runnerCommand
      ? {
          ...input.runnerCommand.program,
          ...("prompt" in input.runnerCommand.program
            ? { prompt: input.prompt }
            : {}),
        }
      : await this.program(input, {
          session: control.session,
          planId: binding.planId,
        });
  }

  private async fileBasis(
    input: AgentPlanExecutionInput,
  ): Promise<string | undefined> {
    const context = input.resourceContext;
    if (!context || (!input.ticketInputs?.length && !input.runnerParameters))
      return undefined;
    const snapshot = readPlanSnapshot(
      await this.dependencies.runs.snapshot(context.runId),
    );
    const basis = {
      ...snapshot,
      steps: snapshot.steps.map((step) =>
        step.step.id === context.stepId
          ? {
              ...step,
              prepared: {
                ...step.prepared,
                parameters: {
                  ...step.prepared.parameters,
                  assetInputs:
                    input.ticketInputs ?? step.prepared.parameters.assetInputs,
                },
              },
            }
          : step,
      ),
      remoteSteps: snapshot.remoteSteps?.map((step) =>
        step.step.id === context.stepId
          ? { ...step, parameters: input.runnerParameters ?? step.parameters }
          : step,
      ),
    };
    return this.dependencies.saveBody(snapshot.plan.id, JSON.stringify(basis));
  }

  private account(
    input: AgentPlanExecutionInput,
  ): Pick<RunnerExecution, "agentAccount"> {
    if (input.runnerCommand?.agentAccount)
      return { agentAccount: input.runnerCommand.agentAccount };
    if (input.runnerTarget || isBoundAntigravity(input)) return {};
    return { agentAccount: { version: 1, id: input.agent.connection.id } };
  }

  private async binding(
    input: AgentPlanExecutionInput,
  ): Promise<RunnerPlanBinding> {
    const context = input.resourceContext;
    if (!context) throw new AgentError("plan_context_changed");
    const run = await this.dependencies.runs.find(context.runId);
    if (!run || run.userId !== input.userId)
      throw new AgentError("plan_access_denied");
    const owner = run.steps.find(
      (step) =>
        step.id === context.stepId ||
        run.loops?.some(
          (loop) =>
            loop.id === step.id &&
            loop.iterations.some((iteration) =>
              iteration.nodes.some((node) => node.id === context.stepId),
            ),
        ),
    );
    return {
      planId: run.planId,
      runId: run.id,
      planRevision: run.planRevision,
      stepId: context.stepId,
      attemptId: randomUUID(),
      managed: true,
      ...(context.isLocalInstruction ? { isInstruction: true as const } : {}),
      ownerStepId: owner?.id ?? context.stepId.split("::")[0],
      sharedWorkspaceId: context.sharedWorkspaceScopeId,
    };
  }

  private async program(
    input: AgentPlanExecutionInput,
    control: {
      readonly session?: AgentPlanSessionInput;
      readonly planId: string;
    },
  ): Promise<RunnerExecution["program"]> {
    const provider = input.agent.connection.provider;
    if (isApiProvider(provider) && !control.session)
      return this.apiProgram(input, provider, control.planId);
    const linkedProvider = linkedCliProvider(provider);
    const tool = linkedProvider ? "opencode" : runnerToolFor(provider);
    const inventory = await this.modelInventory(input, control, tool);
    if (!tool || (!linkedProvider && !inventory?.catalogRevision))
      throw new AgentError("plan_model_unavailable");
    const access = requireCliAccess(control.session?.options.access);
    return {
      kind: "cli",
      route: this.cliRoute(input, control.planId, tool, inventory),
      model: linkedProvider
        ? `${linkedProvider}/${input.agent.model}`
        : input.agent.model,
      linkedProvider,
      purpose: control.session?.purpose,
      reasoningEffort: input.agent.reasoningEffort,
      access,
      prompt: input.prompt,
    };
  }

  private cliRoute(
    input: AgentPlanExecutionInput,
    planId: string,
    tool: "opencode" | NonNullable<ReturnType<typeof runnerToolFor>>,
    inventory: ToolInventory | undefined,
  ): Extract<RunnerExecution["program"], { kind: "cli" }>["route"] {
    return {
      connectionId: LOCAL_RUNNER_CONNECTION_ID,
      workspaceId:
        input.runnerWorkspaceId ?? input.recording?.key.planId ?? planId,
      accountId: isBoundAntigravity(input)
        ? undefined
        : input.agent.connection.id,
      tool,
      catalogRevision: inventory?.catalogRevision ?? "managed-provider",
    };
  }

  private async modelInventory(
    input: AgentPlanExecutionInput,
    control: { readonly session?: AgentPlanSessionInput },
    tool: ReturnType<typeof runnerToolFor> | "opencode" | undefined,
  ): Promise<ToolInventory | undefined> {
    const catalog = await this.dependencies.runners.catalog(
      LOCAL_RUNNER_CONNECTION_ID,
    );
    const tools =
      control.session?.options.access === "full_environment" ||
      isBoundAntigravity(input)
        ? catalog?.tools
        : catalog?.accounts?.find(
            (account) => account.id === input.agent.connection.id,
          )?.tools;
    return tools?.find((entry) => entry.tool === tool);
  }

  private async apiProgram(
    input: AgentPlanExecutionInput,
    provider: ApiProviderId,
    planId: string,
  ): Promise<RunnerExecution["program"]> {
    const request = createTextProviderRequest(
      provider,
      input,
      await readTicketAssetInput(input),
    );
    const body = JSON.stringify(request.body);
    const payload =
      Buffer.byteLength(body) > 200000
        ? { bodyFile: await this.dependencies.saveBody(planId, body) }
        : { body: request.body };
    return {
      kind: "api",
      provider,
      connectionId: input.agent.connection.id,
      model: input.agent.model,
      path: request.path,
      ...payload,
      webSearch: input.webSearch,
    };
  }
}

function nativePlanObserver(
  input: AgentPlanExecutionInput,
  session: AgentPlanSessionInput | undefined,
): (job: RunnerJob) => void {
  let previous: string | undefined;
  return (job) => {
    if (!job.nativePlan || !session?.journal) return;
    const next = JSON.stringify(job.nativePlan);
    if (next === previous) return;
    previous = next;
    session.journal.update({
      sessionUpdate: "plan",
      entries: job.nativePlan.map((entry) => ({
        ...entry,
        priority: "medium",
      })),
    });
  };
}

function isBoundAntigravity(input: AgentPlanExecutionInput): boolean {
  return (
    input.agent.connection.provider === "antigravity" &&
    input.agent.connection.id === process.env.PAGES_ANTIGRAVITY_CONNECTION_ID
  );
}

function linkedCliProvider(
  provider: AgentProviderId,
): "openrouter" | undefined {
  return provider === "openrouter" ? provider : undefined;
}

function turnTimeoutSeconds(
  input: AgentPlanExecutionInput,
  control: PlanTurnControl,
): number {
  return (
    input.runnerCommand?.timeoutSeconds ??
    input.runnerTimeoutSeconds ??
    (control.session?.options.timeoutMinutes ??
      input.agent.run?.timeoutMinutes ??
      0) * 60
  );
}

function requireCliAccess(
  access: AgentPlanSessionInput["options"]["access"] | undefined,
): "read_only" | "yolo" | "full_environment" {
  if (
    access !== "read_only" &&
    access !== "yolo" &&
    access !== "full_environment"
  )
    throw new AgentError("plan_context_changed");
  return access;
}

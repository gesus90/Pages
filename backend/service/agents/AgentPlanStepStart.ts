import { AgentError } from "@/backend/error/AgentErrors";
import {
  agentRunOptionsFor,
  isAcpProvider,
} from "@/definition/AgentConfiguration";

import { bindAgentParameters } from "./AgentParameterBinding";
import { planStepDirectory } from "./AgentPlanSnapshot";

import type { AgentTicketInput } from "@/definition/AgentTicketParameter";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentPlanNode, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";
import type {
  AgentPlanStepSnapshot,
  AgentPlanSnapshot,
  AgentPlanTemplate,
} from "./AgentPlanSnapshot";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type {
  AgentPlanGitHubAccess,
  AgentPlanGitHubCredentials,
} from "./AgentPlanGitHubCredentials";

/** A working directory is a separate process contract, never a prompt convention. */
export interface AgentPlanExecutionInput extends TextExecutionInput {
  readonly directory: string | null;
  /** Rechecks live access immediately before the adapter's provider request or spawn. */
  readonly beforeStart?: () => Promise<void>;
  /** Resolves live project credentials only for a YOLO spawn; never serialized or bound to a prompt. */
  readonly github?: () => Promise<AgentPlanGitHubAccess>;
}

/** A node ready to start: its resolved input, the definition it read and its run options. */
export interface PreparedPlanStep {
  readonly input: AgentPlanExecutionInput;
  /** The `AGENT.md` the prompt was resolved from. */
  readonly definition: {
    readonly path: string;
    readonly revision: number;
  } | null;
  readonly options: AgentRunOptions;
}

interface StartDependencies {
  readonly profiles: Pick<AgentProfileService, "resolveDefinition">;
  readonly parameters: Pick<AgentParameterService, "prepare"> &
    Partial<Pick<AgentParameterService, "readTicketAssets">>;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
  /** Reads `AGENT.md`; without it the frozen template is used. */
  readonly files?: Pick<AgentDefinitionFiles, "read">;
  readonly github?: Pick<AgentPlanGitHubCredentials, "resolve">;
}

interface StartContext {
  readonly connectionId: string;
  readonly values: Readonly<Record<string, unknown>>;
}

function ticketAssetDelivery(
  service: StartDependencies["parameters"],
  userId: string,
  inputs: readonly AgentTicketInput[],
  beforeStart: () => Promise<void>,
): Pick<TextExecutionInput, "ticketInputs" | "readTicketAssets"> {
  if (inputs.length === 0) return {};
  return {
    ticketInputs: inputs,
    readTicketAssets: async () => {
      await beforeStart();
      if (!service.readTicketAssets)
        throw new AgentError("parameter_asset_transfer_unsupported");
      return service.readTicketAssets(userId, inputs);
    },
  };
}

/** Reauthorizes the executor just before each step, without replacing its frozen template or input. */
export class AgentPlanStepStart {
  private readonly dependencies: StartDependencies;

  public constructor(dependencies: StartDependencies) {
    this.dependencies = dependencies;
  }

  /** Start and end are authorized checkpoints; they do not call a model. */
  public async control(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    node: AgentPlanNode,
  ): Promise<void> {
    await this.dependencies.access.require(run.userId, snapshot.plan.id);
    if (node.type !== "start" && node.type !== "end")
      throw new AgentError("plan_invalid");
  }

  /**
   * Resolves credentials for the current executor and rejects a redirected model or working copy.
   *
   * @remarks
   * Nodes use their frozen content. Only historical runs without an independent
   * node copy retain the former AGENT.md compatibility check.
   */
  public async prepare(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    step: AgentPlanStepSnapshot,
  ): Promise<PreparedPlanStep> {
    await this.dependencies.access.require(run.userId, snapshot.plan.id);
    const selection = {
      agentId: step.step.agentId,
      personalAgentId: step.step.personalAgentId,
      projectId: snapshot.plan.projectId,
      configuration: step.step.configuration,
    };
    const resolved = await this.dependencies.profiles.resolveDefinition(
      run.userId,
      selection,
    );
    if (
      resolved.assignment.connection.provider !== step.provider ||
      resolved.assignment.model !== step.model ||
      resolved.assignment.reasoningEffort !== step.reasoningEffort
    )
      throw new AgentError("plan_context_changed");
    for (const taskId of step.taskIds)
      await this.dependencies.tasks.snapshot(
        run.userId,
        snapshot.plan.projectId,
        taskId,
      );
    const values = resultValues(step, run, snapshot);
    const live = await this.dependencies.parameters.prepare(
      run.userId,
      {
        agentId: selection.agentId,
        personalAgentId: selection.personalAgentId,
        workspaceId: snapshot.plan.workspaceId,
        configuration: step.step.configuration,
      },
      values,
      step.template,
    );
    validateContext(step, live);
    const { template, definition } = await this.readDefinition(step);
    const parameters = await bindAgentParameters(template, values, {
      ticket: async (id) => {
        const ticket = live.tickets?.[id];
        if (!ticket) throw new AgentError("parameter_ticket_unavailable");
        return ticket;
      },
      workspace: async (id) => {
        const reference = step.prepared.references.find(
          (entry) => entry.id === id,
        );
        if (!reference) throw new AgentError("plan_context_changed");
        return reference;
      },
      wiki: async (id) => {
        const page = step.prepared.wiki[id];
        if (!page) throw new AgentError("plan_binding_invalid");
        return page;
      },
    });
    const options = agentRunOptionsFor(
      resolved.assignment.connection.provider,
      template.run,
    );
    const directory = planStepDirectory(step);
    const github = this.dependencies.github;
    const beforeStart = (): Promise<void> =>
      this.reauthorize(run, snapshot, step, {
        values,
        connectionId: resolved.assignment.connection.id,
      });
    return {
      input: {
        agent: resolved.assignment,
        userId: run.userId,
        directory: directory?.path ?? null,
        ...(github &&
        directory &&
        isAcpProvider(step.provider) &&
        options.access === "yolo"
          ? { github: () => github.resolve(run.userId, directory) }
          : {}),
        prompt: `${parameters.markdown}\n\n${step.step.instruction}`,
        ...ticketAssetDelivery(
          this.dependencies.parameters,
          run.userId,
          parameters.assetInputs,
          beforeStart,
        ),
        beforeStart,
      },
      definition,
      options,
    };
  }

  private async readDefinition(step: AgentPlanStepSnapshot): Promise<{
    readonly template: AgentPlanTemplate;
    readonly definition: PreparedPlanStep["definition"];
  }> {
    if (step.step.configuration || !this.dependencies.files)
      return { template: step.template, definition: null };
    const document = await this.dependencies.files.read(step.step.agentId);
    const { configuration } = document;
    if (
      document.revision !== step.revision ||
      JSON.stringify(configuration.parameters) !==
        JSON.stringify(step.template.parameters) ||
      configuration.directoryParameter !== step.template.directoryParameter ||
      JSON.stringify(configuration.run ?? null) !==
        JSON.stringify(step.template.run ?? null)
    )
      throw new AgentError("plan_definition_changed");
    return {
      template: {
        markdown: configuration.markdown,
        parameters: configuration.parameters,
        directoryParameter: configuration.directoryParameter,
        ...(configuration.run === undefined ? {} : { run: configuration.run }),
      },
      definition: { path: document.path, revision: document.revision },
    };
  }

  private async reauthorize(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    step: AgentPlanStepSnapshot,
    context: StartContext,
  ): Promise<void> {
    await this.dependencies.access.require(run.userId, snapshot.plan.id);
    const current = await this.dependencies.profiles.resolveDefinition(
      run.userId,
      {
        agentId: step.step.agentId,
        personalAgentId: step.step.personalAgentId,
        projectId: snapshot.plan.projectId,
        configuration: step.step.configuration,
      },
    );
    if (
      current.assignment.connection.id !== context.connectionId ||
      current.assignment.model !== step.model ||
      current.assignment.reasoningEffort !== step.reasoningEffort ||
      current.assignment.connection.provider !== step.provider
    )
      throw new AgentError("plan_context_changed");
    const authorized = await this.dependencies.parameters.prepare(
      run.userId,
      {
        agentId: step.step.agentId,
        personalAgentId: step.step.personalAgentId,
        workspaceId: snapshot.plan.workspaceId,
        configuration: step.step.configuration,
      },
      context.values,
      step.template,
    );
    validateContext(step, authorized);
    for (const taskId of step.taskIds)
      await this.dependencies.tasks.snapshot(
        run.userId,
        snapshot.plan.projectId,
        taskId,
      );
  }
}

function resultValues(
  step: AgentPlanStepSnapshot,
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
): Readonly<Record<string, unknown>> {
  const values: Record<string, unknown> = {
    ...step.prepared.parameters.values,
  };
  for (const [name, binding] of Object.entries(step.step.bindings)) {
    if (binding.kind !== "result") continue;
    requireTicketHandoff(
      step,
      snapshot.steps.find((source) => source.step.id === binding.stepId),
    );
    const result = run.steps.find((entry) => entry.id === binding.stepId);
    if (result?.status !== "succeeded" || result.output === null)
      throw new AgentError("plan_binding_invalid");
    values[name] = { type: "text", text: result.output };
  }
  return values;
}

function requireTicketHandoff(
  target: AgentPlanStepSnapshot,
  source: AgentPlanStepSnapshot | undefined,
): void {
  for (const input of source?.prepared.parameters.assetInputs ?? []) {
    if (input.ticket.assets.length === 0) continue;
    const receiver = target.prepared.parameters.assetInputs?.find(
      (entry) => entry.ticket.id === input.ticket.id,
    );
    if (
      !receiver ||
      JSON.stringify(receiver.ticket.assets) !==
        JSON.stringify(input.ticket.assets)
    )
      throw new AgentError("parameter_asset_transfer_unsupported");
  }
}

function validateContext(
  step: AgentPlanStepSnapshot,
  live: Awaited<ReturnType<AgentParameterService["prepare"]>>,
): void {
  for (const input of step.prepared.parameters.assetInputs ?? []) {
    const current = live.parameters.tickets[input.parameter];
    if (
      !current ||
      JSON.stringify(current.assets) !== JSON.stringify(input.ticket.assets)
    )
      throw new AgentError("parameter_ticket_changed");
  }
  for (const previous of [
    step.prepared.workspace,
    ...step.prepared.references,
  ]) {
    const current = [live.workspace, ...live.references].find(
      (entry) => entry.id === previous.id,
    );
    if (
      !current ||
      current.projectId !== previous.projectId ||
      current.path !== previous.path ||
      current.directoryIdentity !== previous.directoryIdentity ||
      JSON.stringify(current.github) !== JSON.stringify(previous.github)
    )
      throw new AgentError("plan_context_changed");
  }
}

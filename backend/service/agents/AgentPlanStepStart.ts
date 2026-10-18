import { AgentError } from "@/backend/error/AgentErrors";
import {
  agentRunOptionsFor,
  isAcpProvider,
} from "@/definition/AgentConfiguration";

import {
  placeholderNames,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";

import { bindAgentParameters } from "./AgentParameterBinding";
import { prepareGroupParameters } from "./AgentPlanGroupParameters";
import { validatePlanParameterContext } from "./AgentPlanParameterContext";
import { planStepDirectory } from "./AgentPlanSnapshot";

import type { AgentTicketInput } from "@/definition/AgentTicketParameter";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { AcpPromptContent } from "@/backend/agents/acp/AcpChat";
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
import type { PreparedAgentParameters } from "./AgentParameterService";
import type { AgentReferenceResolvers } from "./AgentParameterBinding";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type {
  AgentPlanGitHubAccess,
  AgentPlanGitHubCredentials,
} from "./AgentPlanGitHubCredentials";

/** A working directory is a separate process contract, never a prompt convention. */
export interface AgentPlanExecutionInput extends TextExecutionInput {
  /** Ownership retained across queued starts and group turns; contains no credentials. */
  readonly resourceContext?: {
    readonly runId: string;
    readonly stepId: string;
  };
  readonly directory: string | null;
  /** Rechecks live access immediately before the adapter's provider request or spawn. */
  readonly beforeStart?: () => Promise<void>;
  /** Resolves live project credentials only for a YOLO spawn; never serialized or bound to a prompt. */
  readonly github?: () => Promise<AgentPlanGitHubAccess>;
  /** ACP blocks after the prompt text, such as the attachments of a chat message. */
  readonly promptContent?: AcpPromptContent;
}

/** A node ready to start: its resolved input, the definition it read and its run options. */
export interface PreparedPlanStep {
  readonly input: AgentPlanExecutionInput;
  /** Resolved node instruction for contract extraction; absent in older preparations. */
  readonly instruction?: string;
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

  /** Freezes shared resource content at group entry; each turn still rechecks live authorization. */
  public async prepareGroup(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    groupId: string,
  ): Promise<AgentPlanSnapshot> {
    await this.dependencies.access.require(run.userId, snapshot.plan.id);
    return prepareGroupParameters(this.dependencies, run, snapshot, groupId);
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
    if (scanAgentPlaceholders(step.step.instruction).hasUnsupportedRunNotes)
      throw new AgentError("run_notes_unsupported");
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
      (step.connectionId !== undefined &&
        resolved.assignment.connection.id !== step.connectionId) ||
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
    const { template, definition } = await this.readDefinition(step);
    const values = resultValues(
      step,
      { run, snapshot },
      promptParameters(template, step),
    );
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
    validatePlanParameterContext(step, live);
    const parameters = await bindStepParameters(template, step, values, live);
    const options = agentRunOptionsFor(
      resolved.assignment.connection.provider,
      template.run,
    );
    const directory = planStepDirectory(step);
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
        ...stepGitHubAccess({
          github: this.dependencies.github,
          step,
          options,
          userId: run.userId,
        }),
        prompt: parameters.prompt,
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
      instruction: parameters.instruction,
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
    validatePlanParameterContext(step, authorized);
    for (const taskId of step.taskIds)
      await this.dependencies.tasks.snapshot(
        run.userId,
        snapshot.plan.projectId,
        taskId,
      );
  }
}

async function bindStepParameters(
  template: AgentPlanTemplate,
  step: AgentPlanStepSnapshot,
  values: Readonly<Record<string, unknown>>,
  live: PreparedAgentParameters,
): Promise<{
  readonly prompt: string;
  readonly instruction: string;
  readonly assetInputs: readonly AgentTicketInput[];
}> {
  const references = stepReferences(step, live);
  const isOpenCode = step.provider === "opencode";
  const parameters = await bindAgentParameters(
    isOpenCode
      ? {
          ...template,
          markdown: `# Pages plan assignment\n\n${template.markdown}\n\n${step.step.instruction}`,
        }
      : template,
    values,
    references,
  );
  const instruction = isOpenCode
    ? (
        await bindAgentParameters(
          { ...template, markdown: step.step.instruction },
          values,
          references,
        )
      ).markdown
    : step.step.instruction;
  const prompt = isOpenCode
    ? parameters.markdown
    : `${parameters.markdown}\n\n${instruction}`;
  if (isOpenCode && scanAgentPlaceholders(prompt).placeholders.length > 0)
    throw new AgentError("plan_placeholder_unresolved");
  return { prompt, instruction, assetInputs: parameters.assetInputs };
}

function stepReferences(
  step: AgentPlanStepSnapshot,
  live: PreparedAgentParameters,
): AgentReferenceResolvers {
  return {
    ticket: async (id) => {
      const ticket = step.groupId
        ? step.prepared.tickets?.[id]
        : live.tickets?.[id];
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
  };
}

function stepGitHubAccess(input: {
  readonly github: StartDependencies["github"];
  readonly step: AgentPlanStepSnapshot;
  readonly options: AgentRunOptions;
  readonly userId: string;
}): Pick<AgentPlanExecutionInput, "github"> {
  const { github, step, options, userId } = input;
  const directory = planStepDirectory(step);
  return github &&
    directory &&
    isAcpProvider(step.provider) &&
    options.access === "yolo"
    ? { github: () => github.resolve(userId, directory) }
    : {};
}

/**
 * The parameters the node's prompt names: its `AGENT.md`, and on OpenCode
 * also its instruction, which is bound there as well.
 */
function promptParameters(
  template: AgentPlanTemplate,
  step: AgentPlanStepSnapshot,
): ReadonlySet<string> {
  const names = new Set(placeholderNames(template.markdown));
  if (step.provider === "opencode")
    for (const name of placeholderNames(step.step.instruction)) names.add(name);
  return names;
}

/**
 * Fills each result binding the prompt uses with the predecessor's answer.
 *
 * @remarks
 * A result reaches the receiver only as the value of a declared parameter
 * that its prompt names, such as `{{ergebnis}}`, and only once: the answer
 * is data, so placeholders in it stay text. A binding the prompt does not
 * name passes nothing and does not wait for the result's content.
 */
function resultValues(
  step: AgentPlanStepSnapshot,
  state: { readonly run: AgentPlanRun; readonly snapshot: AgentPlanSnapshot },
  used: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  const { run, snapshot } = state;
  const values: Record<string, unknown> = {
    ...step.prepared.parameters.values,
  };
  for (const [name, binding] of Object.entries(step.step.bindings)) {
    if (binding.kind !== "result" || !used.has(name)) continue;
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

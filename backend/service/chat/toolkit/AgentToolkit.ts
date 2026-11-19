import { logEvent } from "@/backend/logging/Logger";

import {
  isChatDeleteOperation,
  isChatOperation,
  isChatWriteOperation,
} from "../ChatToolCatalog";
import { isTicketArchiveOperation } from "../PicaArchiveConfirmation";
import { PicaPlanConfirmation } from "../PicaPlanConfirmation";
import { PICA_TOOL_OUTCOME } from "../PicaToolSchemas";

import { registerAgentChatHistoryTools } from "./AgentChatHistoryTools";
import { registerAgentChatInteractionTools } from "./AgentChatInteractionTools";
import { registerAgentChatTaskTools } from "./AgentChatTaskTools";
import { AgentShellJobs } from "./AgentShellJobs";
import { createAgentShellLauncher } from "./AgentShellLauncher";
import {
  AGENT_TOOLKIT_TOOLS,
  isBridgeToolAllowed,
} from "./AgentToolkitCatalog";
import { toolkitRefusal } from "./AgentToolkitOutcome";
import { readPublicWebPage } from "./AgentWebTools";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type {
  RuntimeToolCall,
  RuntimeToolRegistry,
} from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { AgentChatHistory } from "@/definition/AgentChatHistory";
import type { AgentChatInteractions } from "@/definition/AgentChatQuestion";
import type { AgentChatTasks } from "@/definition/AgentChatTask";
import type { AgentToolPolicy } from "@/definition/AgentToolGroups";
import type { PicaArchiveConfirmation } from "../PicaArchiveConfirmation";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type {
  AgentToolkitJob,
  AgentToolkitParameters,
  AgentToolkitTool,
} from "./AgentToolkitContracts";
import type { AgentShellLauncher } from "./AgentShellLauncher";
import type { AgentWebPageReader } from "./AgentWebTools";

/**
 * The approvals of consequential steps, shared by every job of the process:
 * the person approves in a later message, which a later job answers.
 */
const CONSEQUENTIAL_APPROVALS = new PicaPlanConfirmation();

/** The human message of the turn a call belongs to; never model input. */
export interface AgentToolkitTurn {
  readonly id?: string;
  readonly message: string;
}

/** What the toolkit of one job adds to the bridge and how it guards calls. */
export interface AgentToolkitBinding {
  readonly job: AgentToolkitJob;
  /** The approvals of consequential steps; the shared store of the process by default. */
  readonly approvals?: PicaPlanConfirmation;
}

/** What a job of an agent employee needs to create its toolkit. */
export interface AgentToolkitJobInput {
  readonly agentId: string;
  readonly root: string;
  readonly policy: AgentToolPolicy;
  /** Folders the file tools never reach in "Lesend", such as the data folder; YOLO passes none. */
  readonly protectedDirectories?: readonly string[];
  readonly launcher?: AgentShellLauncher;
  readonly readPage?: AgentWebPageReader;
  /** The interim messages and questions bound to the job's chat. */
  readonly interactions?: AgentChatInteractions;
  /** The scheduled tasks bound to the job's chat. */
  readonly chatTasks?: AgentChatTasks;
  /** The history search bound to the job's agent and chat. */
  readonly history?: AgentChatHistory;
}

/**
 * Creates the toolkit of one chat job of an agent employee.
 * @returns The job; its background runs end with {@link closeAgentToolkitJob}.
 */
export function createAgentToolkitJob(
  input: AgentToolkitJobInput,
): AgentToolkitJob {
  return {
    agentId: input.agentId,
    root: input.root,
    policy: input.policy,
    launcher: input.launcher ?? createAgentShellLauncher(),
    ...(input.protectedDirectories
      ? { protectedDirectories: input.protectedDirectories }
      : {}),
    shellJobs: new AgentShellJobs(),
    readPage: input.readPage ?? readPublicWebPage,
    ...(input.interactions ? { interactions: input.interactions } : {}),
    ...(input.chatTasks ? { chatTasks: input.chatTasks } : {}),
    ...(input.history ? { history: input.history } : {}),
  };
}

/** Ends the background runs of a job whose chat job ended. */
export async function closeAgentToolkitJob(
  job: AgentToolkitJob,
): Promise<void> {
  await job.shellJobs.close();
}

/** The answer that holds a consequential step back until the person approved it. */
function approvalPrompt(
  tool: string,
  parameters: AgentToolkitParameters,
): PicaToolOutcome {
  return toolkitRefusal("CONFIRMATION_REQUIRED", {
    tool,
    parameters,
    scope:
      "This is a consequential step. Ask the person in the chat: name this exact step and its effect and ask them to approve it, with the tool `rueckfrage` and this tool and these parameters unchanged as `confirms` where it is offered, otherwise explicitly in a new message. Only that approval allows it; repeat the identical call afterwards. Nothing was done.",
  });
}

/**
 * Whether a Pages operation is a consequential step: deleting or archiving.
 * @remarks
 * Archiving tickets, alone or as a selection, and deleting a calendar event
 * preview without `confirmed`; only the call that acts needs the approval,
 * which Pages binds to the person's reply, whatever the model sets.
 */
export function isConsequentialOperation(
  operation: string,
  parameters: AgentToolkitParameters,
): boolean {
  if (
    operation === "calendar.event.delete" ||
    isTicketArchiveOperation(operation)
  )
    return parameters.confirmed === true;
  return isChatOperation(operation) && isChatDeleteOperation(operation);
}

/**
 * Checks a call against the approvals: `null` lets it run, otherwise the
 * answer that asks for the approval.
 */
export function requireApproval(
  binding: AgentToolkitBinding,
  call: {
    readonly tool: string;
    readonly parameters: AgentToolkitParameters;
    readonly context: RuntimeExecutionContext;
    readonly turn: AgentToolkitTurn;
  },
): PicaToolOutcome | null {
  const approvals = binding.approvals ?? CONSEQUENTIAL_APPROVALS;
  const isApproved = approvals.consume(
    { operation: call.tool, parameters: call.parameters },
    call.context,
    { id: call.turn.id, message: call.turn.message, confirmation: null },
  );
  return isApproved ? null : approvalPrompt(call.tool, call.parameters);
}

/**
 * Guards one Pages operation of an agent employee's job.
 * @returns `null` to run it, or the refusal: `TOOL_GROUP_DISABLED` without
 * the Pages group, `READ_ONLY_ACCESS` for a write in `read` mode without
 * administrator rights, or the request for approval of a consequential step.
 */
export function guardPagesOperation(
  binding: AgentToolkitBinding,
  call: {
    readonly operation: string;
    readonly parameters: AgentToolkitParameters;
    readonly context: RuntimeExecutionContext;
    readonly turn: AgentToolkitTurn;
    readonly canWritePages?: boolean;
    readonly archiveConfirmations?: PicaArchiveConfirmation | undefined;
  },
): PicaToolOutcome | null {
  const mode = binding.job.policy.pages;
  if (mode === "off") return toolkitRefusal("TOOL_GROUP_DISABLED");
  const isWrite =
    !isChatOperation(call.operation) || isChatWriteOperation(call.operation);
  if (mode === "read" && isWrite && !call.canWritePages)
    return toolkitRefusal("READ_ONLY_ACCESS");
  if (!isConsequentialOperation(call.operation, call.parameters)) return null;
  if (call.archiveConfirmations && isTicketArchiveOperation(call.operation))
    return call.archiveConfirmations.guardExecution(call, call.context);
  return requireApproval(binding, {
    tool: call.operation,
    parameters: call.parameters,
    context: call.context,
    turn: call.turn,
  });
}

/**
 * Guards one call of the own-account browser: a writing browser
 * tool in `read` mode is refused, and a form the call submits is a
 * consequential step, since it may send, order or pay something.
 * @returns `null` to run it, or the refusal or approval request.
 */
export function guardBrowserCall(
  binding: AgentToolkitBinding,
  call: {
    readonly tool: string;
    readonly parameters: AgentToolkitParameters;
    readonly context: RuntimeExecutionContext;
    readonly turn: AgentToolkitTurn;
  },
): Promise<PicaToolOutcome | null> {
  if (!isBridgeToolAllowed(binding.job.policy, call.tool))
    return Promise.resolve(
      toolkitRefusal(
        binding.job.policy.browser === "off"
          ? "TOOL_GROUP_DISABLED"
          : "READ_ONLY_ACCESS",
      ),
    );
  const submits =
    (call.tool === "browser_form" && call.parameters.submit !== undefined) ||
    (call.tool === "browser_type" && call.parameters.submit === true);
  return Promise.resolve(submits ? requireApproval(binding, call) : null);
}

/** Runs one toolkit tool after the policy and the approval admitted it. */
async function runToolkitTool(
  tool: AgentToolkitTool,
  call: {
    readonly binding: AgentToolkitBinding;
    readonly parameters: AgentToolkitParameters;
    readonly context: RuntimeExecutionContext;
    readonly turn: AgentToolkitTurn;
  },
): Promise<PicaToolOutcome> {
  const { binding, parameters, context, turn } = call;
  if (!isBridgeToolAllowed(binding.job.policy, tool.id))
    return toolkitRefusal(
      binding.job.policy[tool.group] === "off"
        ? "TOOL_GROUP_DISABLED"
        : "READ_ONLY_ACCESS",
    );
  if (tool.isConsequential?.(parameters) === true) {
    const prompt = requireApproval(binding, {
      tool: tool.id,
      parameters,
      context,
      turn,
    });
    if (prompt) return prompt;
  }
  context.signal.throwIfAborted();
  return await tool.execute(parameters, binding.job, context);
}

/**
 * Registers the shell, file and web tools of the toolkit on the registry of
 * one turn.
 * @param registry - The registry of the turn.
 * @param parts - The toolkit of the job, the turn's human message, the
 * reauthorization and the budget of the turn.
 */
export function registerAgentToolkitTools(
  registry: RuntimeToolRegistry,
  parts: {
    readonly binding: AgentToolkitBinding;
    readonly turn: AgentToolkitTurn;
    readonly admit: (context: RuntimeExecutionContext) => Promise<boolean>;
    readonly archiveConfirmations?: PicaArchiveConfirmation | undefined;
  },
): void {
  const { binding, turn, admit } = parts;
  const { interactions } = binding.job;
  if (interactions && binding.job.policy.chat !== "off")
    registerAgentChatInteractionTools(registry, {
      interactions,
      approvals: binding.approvals ?? CONSEQUENTIAL_APPROVALS,
      archiveConfirmations: parts.archiveConfirmations,
      turnId: turn.id,
      admit,
    });
  const { history } = binding.job;
  // The history search reads chats: the chat group decides.
  if (history && binding.job.policy.chat !== "off")
    registerAgentChatHistoryTools(registry, { history, admit });
  const { chatTasks } = binding.job;
  if (chatTasks)
    registerAgentChatTaskTools(registry, {
      tasks: chatTasks,
      mode: binding.job.policy.pages,
      admit,
      requireApproval: (call) => requireApproval(binding, { ...call, turn }),
    });
  for (const tool of AGENT_TOOLKIT_TOOLS) {
    if (!isBridgeToolAllowed(binding.job.policy, tool.id)) continue;
    registry.register<AgentToolkitParameters, PicaToolOutcome>({
      id: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: PICA_TOOL_OUTCOME,
      execute: async (parameters, context) => {
        if (!(await admit(context))) return toolkitRefusal("STEP_LIMIT");
        return await runToolkitTool(tool, {
          binding,
          parameters,
          context,
          turn,
        });
      },
    });
  }
}

/**
 * Applies the policy of the job to the whole registry of a turn: every tool
 * of a group that is off, and every writing tool of a group in `read` mode,
 * is neither listed nor callable.
 */
export function applyAgentToolPolicy(
  registry: RuntimeToolRegistry,
  policy: AgentToolPolicy,
  canWritePages = false,
): void {
  const effectivePolicy =
    canWritePages && policy.pages === "read"
      ? { ...policy, pages: "full" as const }
      : policy;
  registry.retain((id) => isBridgeToolAllowed(effectivePolicy, id));
}

/** The result of a call as the audit names it: `ok` or the error code. */
function callResult(call: RuntimeToolCall): string {
  if (!call.invocation.isValid) return "INVALID_ARGUMENTS";
  const outcome = PICA_TOOL_OUTCOME.safeParse(call.invocation.output);
  if (!outcome.success || outcome.data.ok) return "ok";
  return outcome.data.error ?? "FAILED";
}

/**
 * Records every call of the bridge of an agent employee's job in the server
 * log: agent, chat, tool, time, duration and result, never the arguments or
 * the output.
 */
export function auditAgentToolCalls(
  registry: RuntimeToolRegistry,
  agentId: string,
): void {
  registry.observe((call: RuntimeToolCall) => {
    logEvent({
      level: "info",
      event: "agent.tool.call",
      component: "AgentToolkit",
      message: "Agent tool call",
      metadata: {
        agentId,
        sessionId: call.sessionId ?? null,
        tool: call.id,
        at: new Date().toISOString(),
        durationMs: call.durationMs ?? null,
        result: callResult(call),
      },
    });
  });
}

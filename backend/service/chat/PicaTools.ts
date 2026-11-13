import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { registerPicaRepositoryTools } from "./PicaRepositoryTools";
import { ChatResultBudget } from "./ChatResultBudget";
import { registerPicaChatTools } from "./PicaChatTools";
import { registerPicaEmployeeTools } from "./PicaEmployeeTools";
import { registerPicaAgentDeletionTools } from "./PicaAgentDeletionTools";
import { registerPicaHostFileTools } from "./PicaHostFileTools";
import { registerPicaPlanTools } from "./PicaPlanTools";
import { observePicaToolUse, registerPicaRecipeTool } from "./PicaRecipeTool";
import { registerPicaAutomationTools } from "./PicaAutomationTools";
import { registerPicaAdminTools } from "./admin/PicaAdminTools";
import { registerPicaOperatorTools } from "./admin/PicaOperatorTools";
import { registerPicaStorageTools } from "./admin/PicaStorageTools";
import {
  registerAgentBrowserTools,
  registerPicaBrowserTools,
} from "./browser/PicaBrowserTools";
import { CHAT_MAXIMUM_ACTIONS } from "./ChatExecutionLimits";
import { ChatAnswerFileError } from "./ChatAnswerFileService";
import {
  READ_TOOLS,
  type PicaToolBinding,
  type ToolParameters,
} from "./PicaToolBindings";
import {
  PICA_FILE_EXTENSIONS,
  PICA_FILE_SCHEMA,
  PICA_FILE_TOOL,
  PICA_READ_SCHEMAS,
  PICA_TOOL_OUTCOME,
  PICA_WRITE_SCHEMAS,
  isPicaWriteTool,
} from "./PicaToolSchemas";

import type { AgentBrowserService } from "./browser/AgentBrowserService";
import type { z } from "zod";
import type { PicaAdminService } from "./admin/PicaAdminService";
import type { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentChatTools } from "@/definition/AgentChat";
import type { AgentLogbookTools } from "@/definition/AgentLogbook";
import type { AgentRecipeTools } from "@/definition/AgentDreaming";
import type { ChatAnswerFileService } from "./ChatAnswerFileService";
import type { PicaHostFileAttach } from "./PicaHostFileTools";
import type { ChatSessionService } from "./ChatSessionService";
import type { ChatActionOutcome } from "./ChatPrompt";
import type { ChatToolExecutor } from "./ChatToolExecutor";
import type {
  PicaReadTool,
  PicaToolOutcome,
  PicaWriteTool,
} from "./PicaToolSchemas";

/** Services captured by the server for the native tool catalog of one turn. */
export interface PicaToolsInput {
  readonly tools: Pick<ChatToolExecutor, "run"> &
    Partial<Pick<ChatToolExecutor, "runPlan" | "runAdmin" | "repositoryReads">>;
  /** Raw current human message only; never a model prompt, history or attachment text. */
  readonly message?: string;
  readonly planTurnId?: string;
  /** The answer-specific staging run, when an ACP job contains several turns. */
  readonly answerRunId?: string;
  /** The server-owned legacy administrative confirmation; never supplied by the model. */
  readonly sessions: Pick<ChatSessionService, "confirmationWord">;
  readonly authorize: () => Promise<void>;
  readonly adminTools?: PicaAdminService | undefined;
  /** Present only for an employee whose stored access allows a browser. */
  readonly agentBrowsers?: AgentBrowserService | undefined;
  readonly agentDeletions?: AgentDeletionService | undefined;
  /** Ends or marks the run when a call would exceed the actual execution budget. */
  readonly onLimit?: () => void;
  /** Stores the files Pica writes for its answer; without it the file tool is not offered. */
  readonly answerFiles?: Pick<ChatAnswerFileService, "stage"> | undefined;
  /**
   * Searches the memory archive of the agent employee whose job runs
   * (PAGE-266); without it the memory tool is not offered.
   */
  readonly searchMemory?: ((query: string) => Promise<unknown>) | undefined;
  /**
   * Reads the stored context of a group the agent employee whose job runs is
   * a member of (PAGE-296); without it the tool is not offered.
   */
  readonly readConversationContext?:
    ((input: unknown) => Promise<unknown>) | undefined;
  /**
   * Reads the messages of the chat this session belongs to, after a position
   * (PAGE-376); without it `chat_lesen` is not offered.
   */
  readonly readOwnChat?: ((input: unknown) => Promise<unknown>) | undefined;
  /**
   * Keeps and reads the Lagebuch of the agent employee whose job runs
   * (PAGE-377); without it `lagebuch_merken`, `lagebuch_suchen` and
   * `lagebuch_lesen` are not offered.
   */
  readonly logbook?: AgentLogbookTools | undefined;
  /**
   * The recipes of the agent employee whose job runs (PAGE-378): the tool
   * `rezept(name, parameter)` and the record of its tool calls for the dream
   * run; without it neither exists.
   */
  readonly recipes?: AgentRecipeTools | undefined;
  /**
   * Attaches a file of the chat's working folder to a ticket or a wiki page,
   * for an agent employee with host tools (PAGE-303); without it the tools
   * are not offered.
   */
  readonly attachHostFile?: PicaHostFileAttach | undefined;
  /**
   * Reads chats and sends messages as the agent employee whose job runs
   * (PAGE-311); without it the chat tools are not offered.
   */
  readonly agentChat?: AgentChatTools | undefined;
}

type PicaFileParameters = z.infer<typeof PICA_FILE_SCHEMA>;

const FILE_TOOL_DESCRIPTION =
  "Attach a file you write to your answer: Markdown (.md), text (.txt), CSV (.csv), JSON (.json) or an SVG image (.svg) without scripts or external references. Give the complete content. The person sees and downloads the file with your answer once it is stored. Use it only when the person asks for a file; never invent download links or paths.";

const WRITE_TOOLS: Readonly<Record<PicaWriteTool, PicaToolBinding>> = {
  tickets_create: {
    description:
      "Create a ticket in a project. statusId null takes the default status, parentId null creates no parent; without assignee the person works on it. departmentIds (any number of IDs from departments_list, an empty list for none) sets the departments that see the ticket; a ticket without department is visible to everyone with project access; leaving departmentIds out takes the selectable departments of the parent.",
    operation: "ticket.create",
  },
  tickets_set_title: {
    description: "Change only a ticket title with its expected old title.",
    operation: "ticket.setTitle",
  },
  tickets_set_status: {
    description: "Change only a ticket status with its expected old status ID.",
    operation: "ticket.setStatus",
  },
  tickets_set_description: {
    description:
      "Replace a ticket description with its expected old description.",
    operation: "ticket.setDescription",
  },
  tickets_set_assignee: {
    description:
      "Assign a ticket to a person or group, or to nobody with targetType none and targetId null, with the expected old assignee and group IDs.",
    operation: "ticket.setAssignee",
  },
  tickets_set_tags: {
    description:
      "Set the tags of a ticket from the catalog, with the expected old tag IDs.",
    operation: "ticket.setTags",
  },
  tickets_set_departments: {
    description:
      "Replace the departments of a ticket with departmentIds (any number from departments_list; an empty list makes the ticket visible to everyone with project access), with the expected old department IDs from tickets_read departments.",
    operation: "ticket.setDepartments",
  },
  tickets_set_parent: {
    description:
      "Move a ticket under another parent ticket, or to none with parentId null, with the expected old parent ID.",
    operation: "ticket.setParent",
  },
  tickets_set_milestone: {
    description:
      "Assign a ticket to a milestone of its project, or to none with milestoneId null, with the expected old milestone ID.",
    operation: "ticket.assignMilestone",
  },
  tickets_delete: {
    description:
      "Move a ticket with all its descendants to the trash; the result names how many were moved.",
    operation: "ticket.delete",
  },
  tickets_archive: {
    description:
      "Archive a visible ticket with the project's archive right. First call without confirmed to get the keys and titles of all affected tickets without changing anything; show that list and ask the person to confirm, then call with confirmed: true to execute and receive archived: the number changed. children defaults to include; keep leaves children without a parent and is refused for a task, whose subtasks always go along.",
    operation: "ticket.archive",
  },
  tickets_restore: {
    description:
      "Restore an archived ticket and its descendants with the project's archive right; keeps the workflow status and records the acting account in history. Returns restored: the number changed and the ticket. To archive again, first call tickets_archive without confirmed, ask the person to confirm its affected list, then call with confirmed: true.",
    operation: "ticket.restore",
  },
  projects_create: {
    description:
      "Create a project with status planned, active, paused or completed; departmentIds from departments_list are required when the instance has departments.",
    operation: "projects.create",
  },
  projects_set_name: {
    description: "Rename a project.",
    operation: "projects.setName",
  },
  projects_set_description: {
    description: "Replace the description of a project.",
    operation: "projects.setDescription",
  },
  projects_set_status: {
    description: "Set the status of a project.",
    operation: "projects.setStatus",
  },
  projects_set_dates: {
    description:
      "Set the start and target date of a project as YYYY-MM-DD, or remove them with null.",
    operation: "projects.setDates",
  },
  milestones_create: {
    description:
      "Create a milestone in a project; start and due date are YYYY-MM-DD or null.",
    operation: "milestone.create",
  },
  milestones_set_name: {
    description: "Rename a milestone with its expected old name.",
    operation: "milestone.setName",
  },
  milestones_set_description: {
    description:
      "Replace a milestone description with its expected old description.",
    operation: "milestone.setDescription",
  },
  milestones_set_status: {
    description: "Set the status of a milestone with its expected old status.",
    operation: "milestone.setStatus",
  },
  milestones_set_start_at: {
    description:
      "Set or remove the start date of a milestone with its expected old start date.",
    operation: "milestone.setStartAt",
  },
  milestones_set_due_at: {
    description:
      "Set or remove the due date of a milestone with its expected old due date.",
    operation: "milestone.setDueAt",
  },
  milestones_delete: {
    description:
      "Move a milestone of a project to the trash; its dependencies are removed, its tickets stay as they are.",
    operation: "milestone.delete",
  },
  wiki_page_create: {
    description:
      "Create a wiki page with Markdown content of at most 50,000 characters in a project, or with projectId null in the instance or private wiki named by scope; parentId null puts it on the top level. Longer content returns INVALID_REQUEST with details.reason content_too_long and details.maxLength 50000.",
    operation: "wiki.page.create",
    // Pica uploads nothing, so a page it creates references no new files.
    parameters: ({ icon, ...input }) => ({
      ...input,
      icon: icon ?? null,
      assetIds: [],
    }),
  },
  wiki_page_set_title: {
    description: "Change the title of a wiki page with the revision read last.",
    operation: "wiki.page.setTitle",
  },
  wiki_page_set_content: {
    description:
      "Replace the whole Markdown content of a wiki page with the revision read last. Content accepts at most 50,000 characters; longer content returns INVALID_REQUEST with details.reason content_too_long and details.maxLength 50000.",
    operation: "wiki.page.setContent",
  },
  wiki_page_move: {
    description:
      "Move a wiki page to a project or wiki, under a parent and before a sibling, with the revision read last; parentId null is the top level, beforeId null the end.",
    operation: "wiki.page.move",
  },
  wiki_page_delete: {
    description:
      "Move a wiki page with its subpages to the trash, with the revision read last.",
    operation: "wiki.page.delete",
  },
  wiki_comment_add: {
    description:
      "Add a comment to a visible wiki page; parentId answers a comment, quote names a passage, both null otherwise.",
    operation: "wiki.comment.add",
  },
  wiki_comment_edit: {
    description: "Replace the text of a wiki comment.",
    operation: "wiki.comment.edit",
  },
  wiki_comment_resolve: {
    description: "Resolve a wiki comment thread, or open it again.",
    operation: "wiki.comment.resolve",
  },
  wiki_comment_delete: {
    description: "Delete a wiki comment.",
    operation: "wiki.comment.delete",
  },
};

/** The operations every person's native tools cover; the administrator catalog adds the rest. */
export const PICA_NATIVE_OPERATIONS: ReadonlySet<string> = new Set(
  [...Object.values(READ_TOOLS), ...Object.values(WRITE_TOOLS)].map(
    ({ operation }) => operation,
  ),
);

function isPicaReadTool(name: string): name is PicaReadTool {
  return Object.hasOwn(PICA_READ_SCHEMAS, name);
}

function refused(error: string): PicaToolOutcome {
  return { ok: false, result: null, error };
}

/** The same value with the keys of every object sorted, so field order never matters. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

/** The tool calls of one turn so far; reads, writes and files share the budget. */
interface ToolBudget {
  calls: number;
}

/** The shared limits and retry history of one human turn. */
export interface PicaToolState {
  readonly budget: ToolBudget;
  readonly failedWrites: Set<string>;
  readonly results: ChatResultBudget;
}

/** Creates fresh limits for a new turn. */
export function createPicaToolState(): PicaToolState {
  return {
    budget: { calls: 0 },
    failedWrites: new Set<string>(),
    results: new ChatResultBudget(),
  };
}

/** Counts one call, or marks the limit when the budget is spent. */
function spend(input: PicaToolsInput, budget: ToolBudget): boolean {
  if (budget.calls >= CHAT_MAXIMUM_ACTIONS) {
    input.onLimit?.();
    return false;
  }
  budget.calls += 1;
  return true;
}

/** Stores a file Pica wrote for the answer of the run of this call. */
async function createAnswerFile(
  input: PicaToolsInput,
  budget: ToolBudget,
  call: {
    readonly parameters: PicaFileParameters;
    readonly context: RuntimeExecutionContext;
  },
): Promise<PicaToolOutcome> {
  const { parameters, context } = call;
  await input.authorize();
  context.signal.throwIfAborted();
  if (!spend(input, budget)) return refused("STEP_LIMIT");
  if (!input.answerFiles) return refused("FAILED");
  try {
    const file = await input.answerFiles.stage(
      {
        userId: context.userId,
        sessionId: context.sessionId,
        runId: input.answerRunId ?? context.runId,
      },
      {
        fileName: parameters.fileName,
        bytes: Buffer.from(redactCredentials(parameters.content), "utf8"),
        extensions: PICA_FILE_EXTENSIONS,
      },
    );
    return {
      ok: true,
      result: JSON.stringify({
        fileName: file.fileName,
        contentType: file.contentType,
        size: file.size,
        delivery: "attached to your answer when it is stored",
      }),
      error: null,
    };
  } catch (error: unknown) {
    if (error instanceof ChatAnswerFileError) return refused(error.code);
    throw error;
  }
}

/** An administrator operation: the executor binds its consent to the exact call and the human's later reply. */
async function dispatchPrivileged(
  input: PicaToolsInput,
  binding: PicaToolBinding,
  parameters: ToolParameters,
  context: RuntimeExecutionContext,
): Promise<ChatActionOutcome> {
  if (!input.tools.runAdmin) return { ok: false, error: "FORBIDDEN" };
  return await input.tools.runAdmin(
    { operation: binding.operation, parameters },
    context,
    {
      message: input.message ?? "",
      id: input.planTurnId,
      confirmation: await input.sessions.confirmationWord(context.userId),
    },
  );
}

async function dispatchAction(
  input: PicaToolsInput,
  binding: PicaToolBinding,
  parameters: ToolParameters,
  context: RuntimeExecutionContext,
): Promise<ChatActionOutcome> {
  if (binding.isPrivileged)
    return await dispatchPrivileged(input, binding, parameters, context);
  const action = {
    operation: binding.operation,
    parameters: binding.parameters?.(parameters, context) ?? parameters,
  };
  return binding.operation.startsWith("plans.") && input.tools.runPlan
    ? await input.tools.runPlan(action, context, {
        message: input.message ?? "",
        id: input.planTurnId,
        confirmation: await input.sessions.confirmationWord(context.userId),
      })
    : await input.tools.run(context.userId, action, null);
}

type PicaExecute = (
  binding: PicaToolBinding,
  parameters: ToolParameters,
  context: RuntimeExecutionContext,
) => Promise<PicaToolOutcome>;

/** What the administrator tools are registered from. */
interface AdministratorToolParts {
  readonly input: PicaToolsInput;
  readonly service: PicaAdminService;
  readonly budget: ToolBudget;
  readonly execute: PicaExecute;
}

/**
 * Registers host files, the restricted browser, the visual operator browser
 * (PAGE-181), the administrator catalog of Pages operations and the Storage
 * tools (PAGE-271).
 *
 * @remarks
 * Every call runs in the administrator scope of its job: the right is
 * resolved afresh before and after it, and its withdrawal aborts the job.
 */
function registerAdministratorTools(
  registry: RuntimeToolRegistry,
  parts: AdministratorToolParts,
): void {
  const { input, service, budget, execute } = parts;
  registerPicaAdminTools(registry, service, () => spend(input, budget));
  if (!input.agentBrowsers)
    registerPicaBrowserTools(registry, service, () => spend(input, budget));
  registerPicaOperatorTools(registry, {
    native: PICA_NATIVE_OPERATIONS,
    run: (entry, parameters, context) =>
      service.runPrivileged(
        { operation: entry.operation, input: parameters },
        context,
        (guarded) =>
          execute(
            { operation: entry.operation, description: "", isPrivileged: true },
            parameters,
            guarded,
          ),
      ),
  });
  if (service.hasStorage())
    registerPicaStorageTools(registry, {
      service,
      spend: () => spend(input, budget),
      turn: async (context) => ({
        message: input.message ?? "",
        id: input.planTurnId,
        confirmation: await input.sessions.confirmationWord(context.userId),
      }),
    });
}

/**
 * Registers the tools a job of an agent employee offers beside the Pages
 * tools, and the deletion of agents; each is offered only when the job
 * provides it.
 */
function registerAgentEmployeeTools(
  registry: RuntimeToolRegistry,
  input: PicaToolsInput,
  budget: ToolBudget,
): void {
  registerPicaEmployeeTools(registry, input, () => spend(input, budget));
  const { attachHostFile } = input;
  if (attachHostFile)
    registerPicaHostFileTools(registry, {
      attach: attachHostFile,
      admit: async (context) => {
        await input.authorize();
        context.signal.throwIfAborted();
        return spend(input, budget);
      },
    });
  const agentChat = input.agentChat;
  if (agentChat)
    registerPicaChatTools(registry, {
      chat: agentChat,
      searchTargets: (userId, parameters) =>
        input.tools.run(
          userId,
          { operation: "assignment.targets.search", parameters },
          null,
        ),
      authorize: input.authorize,
      spend: () => spend(input, budget),
    });
  if (input.agentDeletions)
    registerPicaAgentDeletionTools(registry, input.agentDeletions, () =>
      spend(input, budget),
    );
}

/** Registers the read tools; each one reaches its operation through `execute`. */
function registerReadTools(
  registry: RuntimeToolRegistry,
  execute: PicaExecute,
): void {
  for (const tool of Object.keys(PICA_READ_SCHEMAS).filter(isPicaReadTool))
    registry.register<ToolParameters, PicaToolOutcome>({
      id: tool,
      description: READ_TOOLS[tool].description,
      inputSchema: PICA_READ_SCHEMAS[tool],
      outputSchema: PICA_TOOL_OUTCOME,
      execute: (parameters, context) =>
        execute(READ_TOOLS[tool], parameters, context),
    });
}

/**
 * Creates the native tools with fixed service dispatch and fresh rights.
 *
 * @remarks
 * Reads find and read projects, tickets, milestones and the wiki. Writes
 * create and change them on user level when the person asks for it. Deletion
 * follows the explicit request in the current human message. The services
 * check the person's rights on every call. A write that failed is not sent
 * again unchanged in the same turn.
 */
export function createPicaTools(
  input: PicaToolsInput,
  state: PicaToolState = createPicaToolState(),
): RuntimeToolRegistry {
  const registry = new RuntimeToolRegistry(input.adminTools?.gate());
  const { budget, failedWrites, results } = state;
  const execute: PicaExecute = async (binding, parameters, context) => {
    await input.authorize();
    context.signal.throwIfAborted();
    if (!spend(input, budget)) return refused("STEP_LIMIT");
    const outcome = results.consume(
      await dispatchAction(input, binding, parameters, context),
    );
    context.signal.throwIfAborted();
    if (!outcome.ok)
      return {
        ...refused(outcome.error ?? "FAILED"),
        result:
          outcome.result === undefined && outcome.details === undefined
            ? null
            : redactCredentials(
                JSON.stringify({
                  result: outcome.result ?? null,
                  details: outcome.details ?? null,
                }),
              ),
      };
    const result = redactCredentials(JSON.stringify(outcome.result ?? null));
    return { ok: true, result, error: null };
  };
  const write = async (
    tool: PicaWriteTool,
    parameters: ToolParameters,
    context: RuntimeExecutionContext,
  ): Promise<PicaToolOutcome> => {
    const attempt = JSON.stringify([tool, canonical(parameters)]);
    if (failedWrites.has(attempt)) return refused("RETRY_REFUSED");
    const outcome = await execute(WRITE_TOOLS[tool], parameters, context);
    // A write the step limit held back never reached a service.
    if (!outcome.ok && outcome.error !== "STEP_LIMIT")
      failedWrites.add(attempt);
    return outcome;
  };
  registerReadTools(registry, execute);
  for (const tool of Object.keys(PICA_WRITE_SCHEMAS).filter(isPicaWriteTool))
    registry.register<ToolParameters, PicaToolOutcome>({
      id: tool,
      description: WRITE_TOOLS[tool].description,
      inputSchema: PICA_WRITE_SCHEMAS[tool],
      outputSchema: PICA_TOOL_OUTCOME,
      execute: (parameters, context) => write(tool, parameters, context),
    });
  const repositoryReads = input.tools.repositoryReads?.();
  if (repositoryReads)
    registerPicaRepositoryTools(registry, {
      service: repositoryReads,
      spend: () => spend(input, budget),
    });
  registerPicaPlanTools(registry, {
    execute: (operation, parameters, context) =>
      execute({ operation, description: "" }, parameters, context),
  });
  registerPicaAutomationTools(registry, {
    execute: (operation, parameters, context) =>
      execute({ operation, description: "" }, parameters, context),
  });
  if (input.answerFiles)
    registry.register<PicaFileParameters, PicaToolOutcome>({
      id: PICA_FILE_TOOL,
      description: FILE_TOOL_DESCRIPTION,
      inputSchema: PICA_FILE_SCHEMA,
      outputSchema: PICA_TOOL_OUTCOME,
      execute: (parameters, context) =>
        createAnswerFile(input, budget, { parameters, context }),
    });
  registerAgentEmployeeTools(registry, input, budget);
  if (input.recipes) {
    registerPicaRecipeTool(
      registry,
      { authorize: input.authorize, recipes: input.recipes },
      () => spend(input, budget),
    );
    observePicaToolUse(registry, input.recipes);
  }
  if (input.agentBrowsers)
    registerAgentBrowserTools(registry, input.agentBrowsers, () =>
      spend(input, budget),
    );
  if (input.adminTools)
    registerAdministratorTools(registry, {
      input,
      service: input.adminTools,
      budget,
      execute,
    });
  return registry;
}

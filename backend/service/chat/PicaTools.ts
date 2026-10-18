import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { CHAT_MAXIMUM_ACTIONS } from "./ChatExecutionLimits";
import { isChatDeleteOperation } from "./ChatToolCatalog";
import { ChatAnswerFileError } from "./ChatAnswerFileService";
import {
  PICA_FILE_EXTENSIONS,
  PICA_FILE_SCHEMA,
  PICA_FILE_TOOL,
  PICA_READ_SCHEMAS,
  PICA_TOOL_OUTCOME,
  PICA_WRITE_SCHEMAS,
  isPicaWriteTool,
} from "./PicaToolSchemas";

import type { z } from "zod";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatAnswerFileService } from "./ChatAnswerFileService";
import type { ChatSessionService } from "./ChatSessionService";
import type { ChatOperation } from "./ChatToolCatalog";
import type { ChatToolExecutor } from "./ChatToolExecutor";
import type {
  PicaReadTool,
  PicaToolOutcome,
  PicaWriteTool,
} from "./PicaToolSchemas";

/** Services captured by the server for the native tool catalog of one turn. */
export interface PicaToolsInput {
  readonly tools: Pick<ChatToolExecutor, "run">;
  /** The word the deletions of the person's interface language take; Pages passes it, never the model. */
  readonly sessions: Pick<ChatSessionService, "confirmationWord">;
  readonly authorize: () => Promise<void>;
  /** Ends or marks the run when a call would exceed the actual execution budget. */
  readonly onLimit?: () => void;
  /** Stores the files Pica writes for its answer; without it the file tool is not offered. */
  readonly answerFiles?: Pick<ChatAnswerFileService, "stage"> | undefined;
}

type PicaFileParameters = z.infer<typeof PICA_FILE_SCHEMA>;

const FILE_TOOL_DESCRIPTION =
  "Attach a file you write to your answer: Markdown (.md), text (.txt), CSV (.csv), JSON (.json) or an SVG image (.svg) without scripts or external references. Give the complete content. The person sees and downloads the file with your answer once it is stored. Use it only when the person asks for a file; never invent download links or paths.";

type ToolParameters = Readonly<Record<string, unknown>>;

/** How one native tool reaches the operation catalog of the chat. */
interface PicaToolBinding {
  readonly description: string;
  readonly operation: ChatOperation;
  /** Turns the checked input into the operation parameters; without it they are the input. */
  readonly parameters?: (
    input: ToolParameters,
    context: RuntimeExecutionContext,
  ) => ToolParameters;
}

const READ_TOOLS: Readonly<Record<PicaReadTool, PicaToolBinding>> = {
  projects_list: {
    description:
      "List the visible projects with ID, name and status, ordered by name. Use it to find a project the person names.",
    operation: "projects.list",
  },
  projects_read: {
    description: "Read the core fields of a visible project by ID.",
    operation: "projects.read",
  },
  departments_list: {
    description:
      "List the visible departments with ID and name, for example for a new project.",
    operation: "departments.list",
  },
  tickets_search: {
    description:
      "Search visible tickets of a known project by key, title or description; assignedToMe keeps the person's own tickets, statusId and type filter further. Returns at most 20 tickets with status and isDone, and a paging cursor.",
    operation: "tickets.search",
    // The person is the one of the conversation; a model never names an account.
    parameters: ({ assignedToMe, ...input }, context) => ({
      ...input,
      limit: input.limit ?? 20,
      ...(assignedToMe === true ? { assigneeId: context.userId } : {}),
    }),
  },
  tickets_read: {
    description:
      "Read a visible ticket by ID or key, including the current title, description, status ID, parent, milestone, assignee, tags and descendantCount before a change.",
    operation: "ticket.read",
  },
  assignment_targets_search: {
    description:
      "Find visible people and groups a ticket can be assigned to, by name; ambiguous names are never resolved automatically.",
    operation: "assignment.targets.search",
  },
  tags_list: {
    description:
      "List the tag catalog; only these tags can be set on a ticket.",
    operation: "tags.list",
  },
  milestones_read: {
    description:
      "Read the milestones of a visible project with ID, name, description, status, start and due date.",
    operation: "milestones.read",
  },
  wiki_search: {
    description:
      "Search visible wiki pages by text, optionally within one project; returns titles, page IDs and snippets.",
    operation: "wiki.search",
  },
  wiki_tree_read: {
    description:
      "Read the page tree of a project wiki, or of the instance wiki without projectId.",
    operation: "wiki.tree.read",
  },
  wiki_page_read: {
    description:
      "Read a visible wiki page with its Markdown content and revision by page ID.",
    operation: "wiki.page.read",
  },
  wiki_comments_read: {
    description: "Read the comments of a visible wiki page.",
    operation: "wiki.comments.read",
  },
};

const WRITE_TOOLS: Readonly<Record<PicaWriteTool, PicaToolBinding>> = {
  tickets_create: {
    description:
      "Create a ticket in a project. statusId null takes the default status, parentId null creates no parent; without assignee the person works on it.",
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
      "Create a wiki page with Markdown content in a project, or with projectId null in the instance or private wiki named by scope; parentId null puts it on the top level.",
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
      "Replace the whole Markdown content of a wiki page with the revision read last.",
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
        runId: context.runId,
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

/**
 * Creates the native tools with fixed service dispatch and fresh rights.
 *
 * @remarks
 * Reads find and read projects, tickets, milestones and the wiki. Writes
 * create, change and delete them on user level when the person asks for it,
 * without a confirmation line: the services check the rights of the person on
 * every call. Pages adds the confirmation word a deletion needs itself. A
 * write that failed is not sent again unchanged in the same turn.
 */
export function createPicaTools(input: PicaToolsInput): RuntimeToolRegistry {
  const registry = new RuntimeToolRegistry();
  const failedWrites = new Set<string>();
  const budget: ToolBudget = { calls: 0 };
  const execute = async (
    binding: PicaToolBinding,
    parameters: ToolParameters,
    context: RuntimeExecutionContext,
  ): Promise<PicaToolOutcome> => {
    await input.authorize();
    context.signal.throwIfAborted();
    if (!spend(input, budget)) return refused("STEP_LIMIT");
    const confirmation = isChatDeleteOperation(binding.operation)
      ? await input.sessions.confirmationWord(context.userId)
      : null;
    const outcome = await input.tools.run(
      context.userId,
      {
        operation: binding.operation,
        parameters: binding.parameters?.(parameters, context) ?? parameters,
      },
      confirmation,
    );
    context.signal.throwIfAborted();
    if (!outcome.ok) return refused(outcome.error ?? "FAILED");
    const result = redactCredentials(JSON.stringify(outcome.result ?? null));
    if (result.length > 20_000) return refused("RESULT_TOO_LARGE");
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
  for (const tool of Object.keys(PICA_READ_SCHEMAS).filter(isPicaReadTool))
    registry.register<ToolParameters, PicaToolOutcome>({
      id: tool,
      description: READ_TOOLS[tool].description,
      inputSchema: PICA_READ_SCHEMAS[tool],
      outputSchema: PICA_TOOL_OUTCOME,
      execute: (parameters, context) =>
        execute(READ_TOOLS[tool], parameters, context),
    });
  for (const tool of Object.keys(PICA_WRITE_SCHEMAS).filter(isPicaWriteTool))
    registry.register<ToolParameters, PicaToolOutcome>({
      id: tool,
      description: WRITE_TOOLS[tool].description,
      inputSchema: PICA_WRITE_SCHEMAS[tool],
      outputSchema: PICA_TOOL_OUTCOME,
      execute: (parameters, context) => write(tool, parameters, context),
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
  return registry;
}

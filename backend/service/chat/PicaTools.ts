import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { redactAssistantCredentials } from "@/backend/service/assistant/TextAssistantValidation";

import { CHAT_MAXIMUM_ACTIONS } from "./ChatService";
import {
  PICA_READ_SCHEMAS,
  PICA_TOOL_OUTCOME,
  PICA_WRITE_SCHEMAS,
  isPicaWriteTool,
} from "./PicaToolSchemas";
import { PicaWriteConfirmation } from "./PicaWriteConfirmation";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatOperation } from "./ChatToolCatalog";
import type { ChatToolExecutor } from "./ChatToolExecutor";
import type {
  PicaReadTool,
  PicaToolOutcome,
  PicaWriteTool,
} from "./PicaToolSchemas";

/** Services and current input captured by the server for one native tool catalog. */
export interface PicaToolsInput {
  readonly tools: Pick<ChatToolExecutor, "run">;
  readonly message: string;
  readonly authorize: () => Promise<void>;
  /** Write confirmations of the turn; a steer adds its lines to them. Defaults to the message's own. */
  readonly confirmations?: PicaWriteConfirmation;
}

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

const CONFIRMED =
  "Requires an exact BESTÄTIGEN/CONFIRM line with exactly these arguments in the current human message. Never retry a write automatically.";

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
      "Read a visible ticket by ID or key, including the current title, description, status ID, assignee and tags before proposing a change.",
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
    description: `Create a ticket in a project. statusId null takes the default status, parentId null creates no parent; without assignee the person works on it. ${CONFIRMED}`,
    operation: "ticket.create",
  },
  tickets_set_title: {
    description: `Change only a ticket title with its expected old title. ${CONFIRMED}`,
    operation: "ticket.setTitle",
  },
  tickets_set_status: {
    description: `Change only a ticket status with its expected old status ID. ${CONFIRMED}`,
    operation: "ticket.setStatus",
  },
  tickets_set_description: {
    description: `Replace a ticket description with its expected old description. ${CONFIRMED}`,
    operation: "ticket.setDescription",
  },
  tickets_set_assignee: {
    description: `Assign a ticket to a person or group, or to nobody with targetType none and targetId null, with the expected old assignee and group IDs. ${CONFIRMED}`,
    operation: "ticket.setAssignee",
  },
  tickets_set_tags: {
    description: `Set the tags of a ticket from the catalog, with the expected old tag IDs. ${CONFIRMED}`,
    operation: "ticket.setTags",
  },
  wiki_comment_add: {
    description: `Add a comment to a visible wiki page; parentId answers a comment, quote names a passage, both null otherwise. ${CONFIRMED}`,
    operation: "wiki.comment.add",
  },
};

function isPicaReadTool(name: string): name is PicaReadTool {
  return Object.hasOwn(PICA_READ_SCHEMAS, name);
}

/**
 * Creates the native tools with fixed service dispatch, fresh rights and exact write confirmations.
 *
 * @remarks
 * Reads find and read projects, tickets and wiki pages. Every write runs once
 * per exact confirmation line of the person. No tool deletes: a deletion
 * still needs the confirmation word, which the tools never pass on.
 */
export function createPicaTools(input: PicaToolsInput): RuntimeToolRegistry {
  const registry = new RuntimeToolRegistry();
  const confirmations =
    input.confirmations ?? new PicaWriteConfirmation(input.message);
  let calls = 0;
  const execute = async (
    binding: PicaToolBinding,
    parameters: ToolParameters,
    context: RuntimeExecutionContext,
  ): Promise<PicaToolOutcome> => {
    await input.authorize();
    context.signal.throwIfAborted();
    if (calls >= CHAT_MAXIMUM_ACTIONS)
      return { ok: false, result: null, error: "STEP_LIMIT" };
    calls += 1;
    const outcome = await input.tools.run(
      context.userId,
      {
        operation: binding.operation,
        parameters: binding.parameters?.(parameters, context) ?? parameters,
      },
      null,
    );
    context.signal.throwIfAborted();
    if (!outcome.ok)
      return { ok: false, result: null, error: outcome.error ?? "FAILED" };
    const result = redactAssistantCredentials(
      JSON.stringify(outcome.result ?? null),
    );
    if (result.length > 20_000)
      return { ok: false, result: null, error: "RESULT_TOO_LARGE" };
    return { ok: true, result, error: null };
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
      execute: async (parameters, context) =>
        confirmations.consume(tool, parameters)
          ? execute(WRITE_TOOLS[tool], parameters, context)
          : { ok: false, result: null, error: "CONFIRMATION_REQUIRED" },
    });
  return registry;
}

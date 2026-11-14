import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

import type { ChatOperation } from "./ChatToolCatalog";
import type { PicaReadTool } from "./PicaToolSchemas";

export type ToolParameters = Readonly<Record<string, unknown>>;

/** How one native tool reaches the operation catalog of the chat. */
export interface PicaToolBinding {
  readonly description: string;
  readonly operation: ChatOperation;
  /** Runs with the administrator rules: fresh administrator check, consent for critical changes. */
  readonly isPrivileged?: boolean;
  /** Turns the checked input into the operation parameters; without it they are the input. */
  readonly parameters?: (
    input: ToolParameters,
    context: RuntimeExecutionContext,
  ) => ToolParameters;
}

export const READ_TOOLS: Readonly<Record<PicaReadTool, PicaToolBinding>> = {
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
      "Search visible tickets of a known project by key, title or description; assignedToMe keeps the person's own tickets, statusId and type filter further. archived defaults to false (active tickets); true finds only archived tickets, subject to the project's archive right. Returns at most 20 tickets with status and isDone, and a paging cursor.",
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
      "Read a visible ticket by ID or key, including isArchived, the current title, description, status ID, parent, milestone, assignee, departments (a list; empty means visible to the whole project), tags and descendantCount before a change.",
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

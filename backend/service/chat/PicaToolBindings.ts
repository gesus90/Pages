import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ChatOperation } from "./ChatToolCatalog";
import type { PicaReadTool, PicaWriteTool } from "./PicaToolSchemas";

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

export const WRITE_TOOLS: Readonly<Record<PicaWriteTool, PicaToolBinding>> = {
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

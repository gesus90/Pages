import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentExtensionReadOperation,
  AgentExtensionWriteOperation,
} from "../../../definition/AgentExtensions.js";

type Properties = NonNullable<Tool["inputSchema"]["properties"]>;
type FieldSchema = Properties[string];

const IDENTIFIER: FieldSchema = {
  type: "string",
  minLength: 1,
  maxLength: 200,
};
const NULLABLE_IDENTIFIER: FieldSchema = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: 200,
};
const WINDOW: Properties = {
  cursor: { type: ["string", "null"], maxLength: 2048 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
};
const CONFIRMATION: FieldSchema = {
  type: "string",
  enum: ["LÖSCHEN", "DELETE"],
};
const TARGET: Properties = {
  projectId: IDENTIFIER,
  targetType: { type: "string", enum: ["person", "group", "department"] },
  targetId: IDENTIFIER,
};
const IDENTIFIER_LIST: FieldSchema = {
  type: "array",
  items: IDENTIFIER,
  maxItems: 50,
  uniqueItems: true,
};
const ANCHOR_LIST: FieldSchema = {
  type: "array",
  maxItems: 50,
  items: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["department", "milestone", "epic"] },
      targetId: IDENTIFIER,
    },
    required: ["kind", "targetId"],
    additionalProperties: false,
  },
};
const READ_DESCRIPTION =
  "Reads only currently visible entries with cursor paging. Pass nextCursor to continue the same query. Hidden records, identities, placeholders and counts are omitted; people expose only displayName, departments and groups. Pages checks the account rights on every call.";
const WRITE_DESCRIPTION =
  "Pages checks the same account rights as the UI. Reuse operationId with identical parameters after response loss. Refused changes leave no activity. Changes in a project are marked source=mcp.";
const DELETE_DESCRIPTION =
  "Ask the user to type LÖSCHEN for German or DELETE for English and pass the exact reply as confirmation. Without it Pages returns CONFIRMATION_REQUIRED. The operation uses the existing trash/archive, returns affectedCount, and recursively includes descendants where applicable. Never infer confirmation.";
const ARCHIVE_DESCRIPTION =
  "Soft archiving preserves the record and its workflow status. Requires current milestone management rights and project responsibility, or Pages administrator eligibility. Ordinary ticket writing or assignment rights do not suffice. tools/list grants no target permission; every tools/call, including an operationId replay, rechecks current identity, visibility and archive rights.";

function readTool(
  name: string,
  properties: Properties,
  required: string[],
): Tool {
  return {
    name,
    description: READ_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: { ...properties, ...WINDOW },
      required,
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

function writeTool(
  name: string,
  properties: Properties,
  isDeletion = false,
  optionalKeys: readonly string[] = [],
): Tool & { readonly description: string } {
  return {
    name,
    description: `${WRITE_DESCRIPTION} ${isDeletion ? DELETE_DESCRIPTION : ""}`,
    inputSchema: {
      type: "object",
      properties: { operationId: IDENTIFIER, ...properties },
      required: [
        "operationId",
        ...Object.keys(properties).filter((key) => !optionalKeys.includes(key)),
      ],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: isDeletion,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

/** A write tool with a sentence about what it changes ahead of the common rules. */
function describedWriteTool(
  name: string,
  summary: string,
  properties: Properties,
): Tool {
  const tool = writeTool(name, properties);
  return { ...tool, description: `${summary} ${tool.description}` };
}

/** Additional read contracts; all filtering belongs to Pages. */
export const EXTENSION_READ_TOOLS: readonly {
  readonly operation: AgentExtensionReadOperation;
  readonly tool: Tool;
}[] = [
  { operation: "departments.list", tool: readTool("list_departments", {}, []) },
  { operation: "groups.list", tool: readTool("list_groups", {}, []) },
  {
    operation: "people.visible.list",
    tool: readTool("list_visible_people", {}, []),
  },
  {
    operation: "wiki.outline.read",
    tool: readTool("read_wiki_outline", { pageId: IDENTIFIER }, ["pageId"]),
  },
  {
    operation: "wiki.links.read",
    tool: readTool("read_wiki_links", { pageId: IDENTIFIER }, ["pageId"]),
  },
  {
    operation: "projects.members.read",
    tool: readTool("read_project_members", { projectId: IDENTIFIER }, [
      "projectId",
    ]),
  },
  {
    operation: "projects.activity.read",
    tool: readTool("read_project_activity", { projectId: IDENTIFIER }, [
      "projectId",
    ]),
  },
  {
    operation: "projects.tickets.list",
    tool: readTool("list_project_tickets", { projectId: IDENTIFIER }, [
      "projectId",
    ]),
  },
  {
    operation: "tags.list",
    tool: readTool("list_ticket_tags", {}, []),
  },
];

/** Basic project, wiki and planning write contracts; deleting a project is `delete_admin_project`. */
export const EXTENSION_WRITE_TOOLS: readonly {
  readonly operation: AgentExtensionWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "wiki.page.delete",
    tool: writeTool(
      "delete_wiki_page",
      {
        pageId: IDENTIFIER,
        expected_revision: { type: "integer", minimum: 1 },
        confirmation: CONFIRMATION,
      },
      true,
    ),
  },
  {
    operation: "projects.create",
    tool: writeTool("create_project", {
      name: IDENTIFIER,
      description: { type: "string", maxLength: 10000 },
      status: {
        type: "string",
        enum: ["planned", "active", "paused", "completed"],
      },
      departmentIds: {
        type: "array",
        items: IDENTIFIER,
        maxItems: 100,
        uniqueItems: true,
      },
    }),
  },
  {
    operation: "projects.setName",
    tool: writeTool("set_project_name", {
      projectId: IDENTIFIER,
      name: IDENTIFIER,
    }),
  },
  {
    operation: "projects.setDescription",
    tool: writeTool("set_project_description", {
      projectId: IDENTIFIER,
      description: { type: "string", maxLength: 10000 },
    }),
  },
  {
    operation: "projects.setStatus",
    tool: writeTool("set_project_status", {
      projectId: IDENTIFIER,
      status: {
        type: "string",
        enum: ["planned", "active", "paused", "completed"],
      },
    }),
  },
  {
    operation: "projects.setDates",
    tool: writeTool("set_project_dates", {
      projectId: IDENTIFIER,
      startDate: { type: ["string", "null"] },
      targetDate: { type: ["string", "null"] },
    }),
  },
  {
    operation: "projects.member.assign",
    tool: writeTool("assign_project_member", {
      ...TARGET,
      role: { type: "string", enum: ["manager", "member", "viewer"] },
    }),
  },
  {
    operation: "projects.member.remove",
    tool: writeTool("remove_project_member", TARGET),
  },
  {
    operation: "ticket.setAssignee",
    tool: writeTool(
      "set_ticket_assignee",
      {
        ticketId: IDENTIFIER,
        targetType: {
          type: "string",
          enum: ["person", "group", "department", "none"],
        },
        targetId: NULLABLE_IDENTIFIER,
        expectedAssigneeId: NULLABLE_IDENTIFIER,
        expectedAssigneeGroupId: NULLABLE_IDENTIFIER,
        expectedDepartmentId: {
          ...NULLABLE_IDENTIFIER,
          description:
            "Required for targetType=department: the currently read department id, or null. Other targets preserve the department. A null targetId clears the department.",
        },
      },
      false,
      ["expectedDepartmentId"],
    ),
  },
  {
    operation: "ticket.assignMilestone",
    tool: writeTool("assign_ticket_to_milestone", {
      ticketId: IDENTIFIER,
      milestoneId: NULLABLE_IDENTIFIER,
      expectedMilestoneId: NULLABLE_IDENTIFIER,
    }),
  },
  {
    operation: "ticket.delete",
    tool: {
      ...writeTool(
        "delete_ticket",
        { ticketId: IDENTIFIER, confirmation: CONFIRMATION },
        true,
      ),
      description: `${WRITE_DESCRIPTION} ${ARCHIVE_DESCRIPTION} Archives the ticket and its active descendants; affectedCount counts newly archived tickets. ${DELETE_DESCRIPTION}`,
    },
  },
  {
    operation: "ticket.setTags",
    tool: describedWriteTool(
      "set_ticket_tags",
      "Replaces the tags of a ticket with tags of the catalog from list_ticket_tags; a tag outside the catalog is refused and no tag is created. Pass the tag ids read last as expectedTagIds.",
      {
        ticketId: IDENTIFIER,
        tagIds: IDENTIFIER_LIST,
        expectedTagIds: IDENTIFIER_LIST,
      },
    ),
  },
  {
    operation: "milestone.initiative.add",
    tool: describedWriteTool(
      "add_milestone_initiative",
      "Links an initiative with a milestone of its project. One initiative can span several milestones. Assigning a task to a milestone already links its epic and initiative.",
      {
        projectId: IDENTIFIER,
        milestoneId: IDENTIFIER,
        initiativeId: IDENTIFIER,
      },
    ),
  },
  {
    operation: "milestone.initiative.remove",
    tool: describedWriteTool(
      "remove_milestone_initiative",
      "Removes the link between an initiative and a milestone. It is refused with CONFLICT while an epic, task or subtask below the initiative still carries the milestone.",
      {
        projectId: IDENTIFIER,
        milestoneId: IDENTIFIER,
        initiativeId: IDENTIFIER,
      },
    ),
  },
  {
    operation: "wiki.page.setAnchors",
    tool: describedWriteTool(
      "set_wiki_page_anchors",
      "Replaces the departments, milestones and epics a wiki page is tied to. A tied page is visible only to people who see every target. Pass the anchors read last (read_wiki_page) as expectedAnchors.",
      {
        pageId: IDENTIFIER,
        anchors: ANCHOR_LIST,
        expectedAnchors: ANCHOR_LIST,
      },
    ),
  },
  {
    operation: "milestone.delete",
    tool: {
      ...writeTool(
        "delete_milestone",
        {
          projectId: IDENTIFIER,
          milestoneId: IDENTIFIER,
          confirmation: CONFIRMATION,
        },
        true,
      ),
      description: `${WRITE_DESCRIPTION} ${ARCHIVE_DESCRIPTION} Archives only the milestone (affectedCount=1), removes its dependencies and preserves its tickets and their assignments. ${DELETE_DESCRIPTION}`,
    },
  },
];

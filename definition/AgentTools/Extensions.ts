import {
  CONFIRMATION_SCHEMA,
  IDENTIFIER_SCHEMA,
  NULLABLE_IDENTIFIER_SCHEMA,
  PAGING_PROPERTIES,
  REVISION_SCHEMA,
  buildReadTool,
  buildWriteTool,
} from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentExtensionReadOperation,
  AgentExtensionWriteOperation,
} from "../AgentExtensions.js";
import type { PropertySchema, ToolProperties } from "./ToolDefinition.js";

const TARGET: ToolProperties = {
  projectId: IDENTIFIER_SCHEMA,
  targetType: { type: "string", enum: ["person", "group", "department"] },
  targetId: IDENTIFIER_SCHEMA,
};
const IDENTIFIER_LIST: PropertySchema = {
  type: "array",
  items: IDENTIFIER_SCHEMA,
  maxItems: 50,
  uniqueItems: true,
};
const ANCHOR_LIST: PropertySchema = {
  type: "array",
  maxItems: 50,
  items: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["department", "milestone", "epic"] },
      targetId: IDENTIFIER_SCHEMA,
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

/** Additional read contracts; all filtering belongs to Pages. */
export const EXTENSION_READ_TOOLS: readonly {
  readonly operation: AgentExtensionReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "departments.list",
    tool: buildReadTool({
      name: "list_departments",
      title: "List departments",
      description: `Lists the departments visible to the connected account. ${READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "groups.list",
    tool: buildReadTool({
      name: "list_groups",
      title: "List groups",
      description: `Lists visible groups and their current members. ${READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "people.visible.list",
    tool: buildReadTool({
      name: "list_visible_people",
      title: "List visible people",
      description: `Lists visible people by display name, department and group. ${READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
  {
    operation: "wiki.outline.read",
    tool: buildReadTool({
      name: "read_wiki_outline",
      title: "Read wiki outline",
      description: `Reads the heading outline of the visible wiki page named by pageId. ${READ_DESCRIPTION}`,
      properties: { pageId: IDENTIFIER_SCHEMA, ...PAGING_PROPERTIES },
      required: ["pageId"],
    }),
  },
  {
    operation: "wiki.links.read",
    tool: buildReadTool({
      name: "read_wiki_links",
      title: "Read wiki links",
      description: `Reads visible forward and back links of the wiki page named by pageId. ${READ_DESCRIPTION}`,
      properties: { pageId: IDENTIFIER_SCHEMA, ...PAGING_PROPERTIES },
      required: ["pageId"],
    }),
  },
  {
    operation: "projects.members.read",
    tool: buildReadTool({
      name: "read_project_members",
      title: "Read project members",
      description: `Reads the visible members and roles of the project named by projectId. ${READ_DESCRIPTION}`,
      properties: { projectId: IDENTIFIER_SCHEMA, ...PAGING_PROPERTIES },
      required: ["projectId"],
    }),
  },
  {
    operation: "projects.activity.read",
    tool: buildReadTool({
      name: "read_project_activity",
      title: "Read project activity",
      description: `Reads the visible activity of the project named by projectId. ${READ_DESCRIPTION}`,
      properties: { projectId: IDENTIFIER_SCHEMA, ...PAGING_PROPERTIES },
      required: ["projectId"],
    }),
  },
  {
    operation: "projects.tickets.list",
    tool: buildReadTool({
      name: "list_project_tickets",
      title: "List project tickets",
      description: `Lists the visible active tickets of the project named by projectId. ${READ_DESCRIPTION}`,
      properties: { projectId: IDENTIFIER_SCHEMA, ...PAGING_PROPERTIES },
      required: ["projectId"],
    }),
  },
  {
    operation: "tags.list",
    tool: buildReadTool({
      name: "list_ticket_tags",
      title: "List ticket tags",
      description: `Lists the existing ticket tags available to the connected account. ${READ_DESCRIPTION}`,
      properties: { ...PAGING_PROPERTIES },
      required: [],
    }),
  },
];

/** Basic project, wiki and planning write contracts; deleting a project is `delete_admin_project`. */
export const EXTENSION_WRITE_TOOLS: readonly {
  readonly operation: AgentExtensionWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "wiki.page.delete",
    tool: buildWriteTool({
      name: "delete_wiki_page",
      title: "Delete wiki page",
      description: `Moves the wiki page named by pageId and its descendants to the trash; expected_revision is the revision read last. ${WRITE_DESCRIPTION} ${DELETE_DESCRIPTION}`,
      properties: {
        pageId: IDENTIFIER_SCHEMA,
        expected_revision: REVISION_SCHEMA,
        confirmation: CONFIRMATION_SCHEMA,
      },
      isDestructive: true,
    }),
  },
  {
    operation: "projects.create",
    tool: buildWriteTool({
      name: "create_project",
      title: "Create project",
      description: `Creates a project with the supplied name, description, status and departmentIds. ${WRITE_DESCRIPTION}`,
      properties: {
        name: IDENTIFIER_SCHEMA,
        description: { type: "string", maxLength: 10000 },
        status: {
          type: "string",
          enum: ["planned", "active", "paused", "completed"],
        },
        departmentIds: {
          type: "array",
          items: IDENTIFIER_SCHEMA,
          maxItems: 100,
          uniqueItems: true,
        },
      },
      isDestructive: false,
    }),
  },
  {
    operation: "projects.setName",
    tool: buildWriteTool({
      name: "set_project_name",
      title: "Set project name",
      description: `Replaces the name of the project named by projectId. ${WRITE_DESCRIPTION}`,
      properties: {
        projectId: IDENTIFIER_SCHEMA,
        name: IDENTIFIER_SCHEMA,
      },
      isDestructive: true,
    }),
  },
  {
    operation: "projects.setDescription",
    tool: buildWriteTool({
      name: "set_project_description",
      title: "Set project description",
      description: `Replaces the description of the project named by projectId, up to 10000 characters. ${WRITE_DESCRIPTION}`,
      properties: {
        projectId: IDENTIFIER_SCHEMA,
        description: { type: "string", maxLength: 10000 },
      },
      isDestructive: true,
    }),
  },
  {
    operation: "projects.setStatus",
    tool: buildWriteTool({
      name: "set_project_status",
      title: "Set project status",
      description: `Sets the project named by projectId to planned, active, paused or completed. ${WRITE_DESCRIPTION}`,
      properties: {
        projectId: IDENTIFIER_SCHEMA,
        status: {
          type: "string",
          enum: ["planned", "active", "paused", "completed"],
        },
      },
      isDestructive: true,
    }),
  },
  {
    operation: "projects.setDates",
    tool: buildWriteTool({
      name: "set_project_dates",
      title: "Set project dates",
      description: `Replaces the startDate and targetDate of the project named by projectId; null clears a date. ${WRITE_DESCRIPTION}`,
      properties: {
        projectId: IDENTIFIER_SCHEMA,
        startDate: { type: ["string", "null"] },
        targetDate: { type: ["string", "null"] },
      },
      isDestructive: true,
    }),
  },
  {
    operation: "projects.member.assign",
    tool: buildWriteTool({
      name: "assign_project_member",
      title: "Assign project member",
      description: `Assigns the person, group or department named by targetType and targetId to the project, replacing existing member roles where applicable. ${WRITE_DESCRIPTION}`,
      properties: {
        ...TARGET,
        role: { type: "string", enum: ["manager", "member", "viewer"] },
      },
      isDestructive: true,
    }),
  },
  {
    operation: "projects.member.remove",
    tool: buildWriteTool({
      name: "remove_project_member",
      title: "Remove project member",
      description: `Removes the person, group or department named by targetType and targetId from the project. ${WRITE_DESCRIPTION}`,
      properties: TARGET,
      isDestructive: true,
    }),
  },
  {
    operation: "ticket.setAssignee",
    tool: buildWriteTool({
      name: "set_ticket_assignee",
      title: "Set ticket assignee",
      description: `Replaces the assignee of ticketId with the person, group, department or none named by targetType and targetId. Pass the last-read expectedAssigneeId and expectedAssigneeGroupId; department changes also require expectedDepartmentId. ${WRITE_DESCRIPTION}`,
      properties: {
        ticketId: IDENTIFIER_SCHEMA,
        targetType: {
          type: "string",
          enum: ["person", "group", "department", "none"],
        },
        targetId: NULLABLE_IDENTIFIER_SCHEMA,
        expectedAssigneeId: NULLABLE_IDENTIFIER_SCHEMA,
        expectedAssigneeGroupId: NULLABLE_IDENTIFIER_SCHEMA,
        expectedDepartmentId: {
          ...NULLABLE_IDENTIFIER_SCHEMA,
          description:
            "Required for targetType=department: the currently read department id, or null. Other targets preserve the department. A null targetId clears the department.",
        },
      },
      optionalKeys: ["expectedDepartmentId"],
      isDestructive: true,
    }),
  },
  {
    operation: "ticket.assignMilestone",
    tool: buildWriteTool({
      name: "assign_ticket_to_milestone",
      title: "Assign ticket to milestone",
      description: `Assigns ticketId to milestoneId, or clears it with null; expectedMilestoneId is the value read last. ${WRITE_DESCRIPTION}`,
      properties: {
        ticketId: IDENTIFIER_SCHEMA,
        milestoneId: NULLABLE_IDENTIFIER_SCHEMA,
        expectedMilestoneId: NULLABLE_IDENTIFIER_SCHEMA,
      },
      isDestructive: true,
    }),
  },
  {
    operation: "ticket.delete",
    tool: buildWriteTool({
      name: "delete_ticket",
      title: "Delete ticket",
      description: `${WRITE_DESCRIPTION} ${ARCHIVE_DESCRIPTION} Archives the ticket and its active descendants; affectedCount counts newly archived tickets. ${DELETE_DESCRIPTION}`,
      properties: {
        ticketId: IDENTIFIER_SCHEMA,
        confirmation: CONFIRMATION_SCHEMA,
      },
      isDestructive: true,
    }),
  },
  {
    operation: "ticket.setTags",
    tool: buildWriteTool({
      name: "set_ticket_tags",
      title: "Set ticket tags",
      description: `Replaces the tags of a ticket with tags of the catalog from list_ticket_tags; a tag outside the catalog is refused and no tag is created. Pass the tag ids read last as expectedTagIds. ${WRITE_DESCRIPTION}`,
      properties: {
        ticketId: IDENTIFIER_SCHEMA,
        tagIds: IDENTIFIER_LIST,
        expectedTagIds: IDENTIFIER_LIST,
      },
      isDestructive: true,
    }),
  },
  {
    operation: "milestone.initiative.add",
    tool: buildWriteTool({
      name: "add_milestone_initiative",
      title: "Add milestone initiative",
      description: `Links an initiative with a milestone of its project. One initiative can span several milestones. Assigning a task to a milestone already links its epic and initiative. ${WRITE_DESCRIPTION}`,
      properties: {
        projectId: IDENTIFIER_SCHEMA,
        milestoneId: IDENTIFIER_SCHEMA,
        initiativeId: IDENTIFIER_SCHEMA,
      },
      isDestructive: false,
    }),
  },
  {
    operation: "milestone.initiative.remove",
    tool: buildWriteTool({
      name: "remove_milestone_initiative",
      title: "Remove milestone initiative",
      description: `Removes the link between an initiative and a milestone. It is refused with CONFLICT while an epic, task or subtask below the initiative still carries the milestone. ${WRITE_DESCRIPTION}`,
      properties: {
        projectId: IDENTIFIER_SCHEMA,
        milestoneId: IDENTIFIER_SCHEMA,
        initiativeId: IDENTIFIER_SCHEMA,
      },
      isDestructive: true,
    }),
  },
  {
    operation: "wiki.page.setAnchors",
    tool: buildWriteTool({
      name: "set_wiki_page_anchors",
      title: "Set wiki page anchors",
      description: `Replaces the departments, milestones and epics a wiki page is tied to. A tied page is visible only to people who see every target. Pass the anchors read last (read_wiki_page) as expectedAnchors. ${WRITE_DESCRIPTION}`,
      properties: {
        pageId: IDENTIFIER_SCHEMA,
        anchors: ANCHOR_LIST,
        expectedAnchors: ANCHOR_LIST,
      },
      isDestructive: true,
    }),
  },
  {
    operation: "milestone.delete",
    tool: buildWriteTool({
      name: "delete_milestone",
      title: "Delete milestone",
      description: `${WRITE_DESCRIPTION} ${ARCHIVE_DESCRIPTION} Archives only the milestone (affectedCount=1), removes its dependencies and preserves its tickets and their assignments. ${DELETE_DESCRIPTION}`,
      properties: {
        projectId: IDENTIFIER_SCHEMA,
        milestoneId: IDENTIFIER_SCHEMA,
        confirmation: CONFIRMATION_SCHEMA,
      },
      isDestructive: true,
    }),
  },
];

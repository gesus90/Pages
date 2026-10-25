import {
  IDENTIFIER_SCHEMA,
  PAGING_PROPERTIES,
  READ_ANNOTATIONS,
} from "./ToolDefinition.js";

import type { Tool } from "@modelcontextprotocol/server";

const PAGING =
  "Up to 100 entries per cursor page (default 100), with the visible total and nextCursor; pass nextCursor with the same query to continue, so that no entry repeats and none is skipped. A cursor of another query returns INVALID_REQUEST.";
const REFERENCE =
  "a ticket ID, a key such as PAGE-12, or a Pages address such as /tasks/PAGE-12";
const HIDDEN =
  "Hidden tickets, people, groups and departments are neither listed nor counted; a missing and a hidden one return NOT_FOUND alike.";
const LIMIT = "Responses are limited to 1 MiB UTF-8 JSON.";

/** Finds the tickets of one project by text and filters. */
export const TICKET_SEARCH_TOOL: Tool = {
  name: "search_tickets",
  title: "Search tickets",
  description: `Searches and lists the visible active tickets of one project, ordered by ticket number. text (1 to 200 characters) matches key, title and description without regard to case; type, statusId, parentId (${REFERENCE}; only its direct children), milestoneId, departmentId, assigneeId or assigneeGroupId (not both) and tagIds (tickets that carry at least one of them) narrow the result, and every filter you give applies. Without any filter it lists the project. A hit has key, type, title, status, priority, parentId, milestone, assignee, assigneeGroup, department, tags and a snippet of the description around the match (null when the match is elsewhere), but no description: call read_ticket for that. ${PAGING} ${HIDDEN} A hidden project, or a status, milestone, department, person, group or tag of another project or that does not exist, returns NOT_FOUND; a parent of another project returns INVALID_REQUEST. ${LIMIT}`,
  inputSchema: {
    type: "object",
    properties: {
      projectId: IDENTIFIER_SCHEMA,
      text: IDENTIFIER_SCHEMA,
      type: {
        type: "string",
        enum: ["initiative", "epic", "task", "subtask"],
      },
      statusId: IDENTIFIER_SCHEMA,
      parentId: IDENTIFIER_SCHEMA,
      milestoneId: IDENTIFIER_SCHEMA,
      departmentId: IDENTIFIER_SCHEMA,
      assigneeId: IDENTIFIER_SCHEMA,
      assigneeGroupId: IDENTIFIER_SCHEMA,
      tagIds: {
        type: "array",
        items: IDENTIFIER_SCHEMA,
        maxItems: 50,
        uniqueItems: true,
      },
      ...PAGING_PROPERTIES,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
};

/** Reads the hierarchy of a project, or the path and subtree of one ticket. */
export const TICKET_TREE_READ_TOOL: Tool = {
  name: "read_ticket_tree",
  title: "Read ticket tree",
  description: `Reads the hierarchy initiative > epic > task > subtask. With projectId it lists every visible active ticket of the project; with ticketId (${REFERENCE}) it returns that ticket as root, its visible ancestors as path (outermost first) and its visible descendants as nodes; projectId may be left out then. Every node has key, type, title, status, parentId, parentKey, childCount (visible direct children) and depth (visible ancestors; 0 without a visible parent), so the tree is rebuilt from parentId; a parent on another page keeps its ID. A parent you cannot see reads as null and ends the path. Nodes are ordered by ticket number. ${PAGING} Archived tickets are not listed. ${HIDDEN} A project and a ticket that disagree return INVALID_REQUEST. ${LIMIT}`,
  inputSchema: {
    type: "object",
    properties: {
      projectId: IDENTIFIER_SCHEMA,
      ticketId: IDENTIFIER_SCHEMA,
      ...PAGING_PROPERTIES,
    },
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
};

/** Reads the typed links of one ticket. */
export const TICKET_LINKS_READ_TOOL: Tool = {
  name: "read_ticket_links",
  title: "Read ticket links",
  description: `Lists the typed links of one ticket (ticketId is ${REFERENCE}): blocks, relates_to and duplicates. direction is seen from this ticket: outgoing when it is the source ("this blocks the other"), incoming when the other ticket is. The same link has the same id on both tickets, with the opposite direction. Each link names the other ticket by id, key, title, statusKey and isDone. ${PAGING} Links to tickets you cannot see are neither listed nor counted. A missing and a hidden ticket return NOT_FOUND. ${LIMIT}`,
  inputSchema: {
    type: "object",
    properties: { ticketId: IDENTIFIER_SCHEMA, ...PAGING_PROPERTIES },
    required: ["ticketId"],
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
};

/** Names the visible persons, groups and departments a ticket can be assigned to. */
export const ASSIGNMENT_TARGETS_SEARCH_TOOL: Tool = {
  name: "search_assignment_targets",
  title: "Search assignment targets",
  description: `Lists the persons, groups and departments you may assign tickets to, matching text (1 to 200 characters, part of the name, without regard to case) and targetType (person, group or department; all three when left out). Never picks one: every match is listed with targetType, id and name, a person also with the departments and groups that tell equal names apart, and isExactMatch is true when the name equals text; several exact matches are ambiguous, so ask rather than choose. projectId limits persons to those who may be assigned in that project. Pass the id to set_ticket_assignee or create_ticket. Only visible directory entries appear; departments you may not select are left out. ${PAGING} A hidden or missing projectId returns NOT_FOUND; an unknown or malformed parameter returns INVALID_REQUEST. ${LIMIT}`,
  inputSchema: {
    type: "object",
    properties: {
      text: IDENTIFIER_SCHEMA,
      targetType: { type: "string", enum: ["person", "group", "department"] },
      projectId: IDENTIFIER_SCHEMA,
      ...PAGING_PROPERTIES,
    },
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
};

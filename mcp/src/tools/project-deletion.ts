import {
  CONFIRMATION_SCHEMA,
  DESTRUCTIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
  READ_ANNOTATIONS,
} from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentProjectDeletionReadOperation,
  AgentProjectDeletionWriteOperation,
} from "../../../definition/AgentProjectDeletion.js";

const RIGHTS =
  "Pages requires current personal administrator eligibility on every call, regardless of UI role mode and of any project role or the right to manage all projects; anyone else gets FORBIDDEN and nothing is read or changed. Only administrators see this tool in tools/list at all.";

/** The extent of a deletion, read before the deletion is requested. */
export const PROJECT_DELETION_SCOPE_TOOL: {
  readonly operation: AgentProjectDeletionReadOperation;
  readonly tool: Tool;
} = {
  operation: "admin.projects.deletionScope",
  tool: {
    name: "read_admin_project_deletion_scope",
    title: "Read project deletion scope",
    description: `Reads the concrete project that delete_admin_project would target and the extent of the data its permanent deletion removes: the project (name, status, archived or active, departments), counts of tickets and subtickets with their attachments, checklist items, links and history, milestones and dependencies, wiki pages with comments and attachments, agent plans, plan runs and registered workspaces, imports, members, department assignments, goals, events, activity, GitHub and Discord records and project templates, and the number of references elsewhere that the deletion clears (template assignments, wiki anchors and links, saved board filters). Changes nothing. Show the project and the counts to the user before asking for the confirmation. projectId is a project ID from resolve_project or read_project; an unknown project returns NOT_FOUND. ${RIGHTS} Responses are limited to 1 MiB UTF-8 JSON.`,
    inputSchema: {
      type: "object",
      properties: { projectId: IDENTIFIER_SCHEMA },
      required: ["projectId"],
      additionalProperties: false,
    },
    annotations: READ_ANNOTATIONS,
  },
};

/** The permanent deletion of one project. */
export const PROJECT_DELETE_TOOL: {
  readonly operation: AgentProjectDeletionWriteOperation;
  readonly tool: Tool;
} = {
  operation: "admin.projects.delete",
  tool: {
    name: "delete_admin_project",
    title: "Delete project permanently",
    description: `Permanently and irreversibly deletes ONE project together with everything that belongs only to it: there is no archive and no trash. Removed are its tickets including all subtickets with their attachments, checklists, history and links, its milestones and dependencies, its wiki pages (the wiki trash included) with comments, versions and attachments, its agent plans with their runs and run records, its registered workspaces (the directories on disk stay untouched), import records, member and department assignments, goals, events, activity, GitHub and Discord records, project templates and the stored attachment and run record files. Shared objects stay: people, groups, departments, agents, labels, ticket templates and wiki pages of the instance; only their references to the project are removed (template assignments, wiki anchors and links, saved board filters), and projects below the deleted one lose their parent. Data of other projects is not touched. Workflow: call read_admin_project_deletion_scope, show the user the project and the extent, ask the user to type LÖSCHEN or DELETE (both words are valid, whatever the language) and pass that exact reply as confirmation. Never infer confirmation; without exactly one of the two words Pages returns CONFIRMATION_REQUIRED and changes nothing. ${RIGHTS} Running plan runs of the project are stopped first; if they do not close in time the call returns CONFLICT and nothing is deleted. The deletion is atomic: on any failure nothing is changed and the call can be repeated. Reuse operationId with an identical projectId after response loss: the stored result is returned and nothing else changes; the same operationId for another project returns CONFLICT. A project that no longer exists returns NOT_FOUND. The result lists the removed extent and the affected members; every successful deletion is audited with source=mcp (read_admin_activity).`,
    inputSchema: {
      type: "object",
      properties: {
        operationId: IDENTIFIER_SCHEMA,
        projectId: IDENTIFIER_SCHEMA,
        confirmation: CONFIRMATION_SCHEMA,
      },
      required: ["operationId", "projectId", "confirmation"],
      additionalProperties: false,
    },
    annotations: DESTRUCTIVE_ANNOTATIONS,
  },
};

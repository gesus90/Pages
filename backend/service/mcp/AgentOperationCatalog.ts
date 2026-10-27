import { AGENT_ADMIN_READ_OPERATIONS } from "@/definition/AgentAdministration";
import { AGENT_EXTENSION_READ_OPERATIONS } from "@/definition/AgentExtensions";
import {
  AGENT_PROJECT_DELETION_READ_OPERATIONS,
  AGENT_PROJECT_DELETION_WRITE_OPERATIONS,
} from "@/definition/AgentProjectDeletion";
import {
  AGENT_PLAN_COMMAND_OPERATIONS,
  AGENT_PLAN_READ_OPERATIONS,
  AGENT_PLAN_RESOURCE_READ_OPERATIONS,
} from "@/definition/AgentPlanOperations";
import { AGENT_TEXT_RANGE_READ_OPERATIONS } from "@/definition/AgentTextRange";
import { AGENT_WORKSPACE_READ_OPERATIONS } from "@/definition/AgentWorkspaceOperations";
import { PAGE_AGENT_READ_OPERATIONS } from "@/definition/PageAgentOperations";
import { PAGES_AGENT_WRITE_OPERATIONS } from "@/definition/PagesAgentWrites";
import {
  PAGES_AGENT_COMMENT_OPERATIONS,
  PAGES_AGENT_READ_OPERATIONS,
  PAGES_AGENT_STRUCTURED_READ_OPERATIONS,
  PAGES_AGENT_TICKET_READ_OPERATIONS,
} from "@/definition/PagesAgentOperations";

import type { AgentRunScope } from "@/definition/McpAuthorization";
import type { PagesAgentApiBusinessOperation } from "@/definition/PagesAgentApi";

/** Reading the project names; it needs no capability and is answered without the router. */
export const PROJECT_NAMES_OPERATION = "projects.names.list" as const;

/** Every reading operation besides the administrator reads. */
const READING_OPERATIONS: readonly PagesAgentApiBusinessOperation[] = [
  "assets.download.prepare",
  PROJECT_NAMES_OPERATION,
  ...PAGES_AGENT_READ_OPERATIONS,
  ...PAGES_AGENT_TICKET_READ_OPERATIONS,
  ...PAGES_AGENT_STRUCTURED_READ_OPERATIONS,
  "wiki.comments.read",
  ...AGENT_TEXT_RANGE_READ_OPERATIONS,
  ...AGENT_EXTENSION_READ_OPERATIONS,
  ...AGENT_WORKSPACE_READ_OPERATIONS,
  ...AGENT_PLAN_READ_OPERATIONS,
  ...AGENT_PLAN_RESOURCE_READ_OPERATIONS,
  ...PAGE_AGENT_READ_OPERATIONS,
  "chat.sessions.list",
];

/**
 * Every operation a personal credential offers its owner.
 *
 * @param isAdmin - Whether the owner is an administrator now.
 * @returns Reads, comments and writes; the administrator operations only for administrators.
 */
export function ownerOperations(
  isAdmin: boolean,
): readonly PagesAgentApiBusinessOperation[] {
  return [
    "assets.download.prepare",
    PROJECT_NAMES_OPERATION,
    ...PAGES_AGENT_READ_OPERATIONS,
    ...PAGES_AGENT_TICKET_READ_OPERATIONS,
    ...PAGES_AGENT_STRUCTURED_READ_OPERATIONS,
    ...PAGES_AGENT_COMMENT_OPERATIONS,
    ...AGENT_TEXT_RANGE_READ_OPERATIONS,
    ...AGENT_EXTENSION_READ_OPERATIONS,
    ...AGENT_WORKSPACE_READ_OPERATIONS,
    ...AGENT_PLAN_READ_OPERATIONS,
    ...AGENT_PLAN_RESOURCE_READ_OPERATIONS,
    ...PAGE_AGENT_READ_OPERATIONS,
    "chat.sessions.list",
    ...PAGES_AGENT_WRITE_OPERATIONS.filter(
      (operation) =>
        !operation.startsWith("agents.") &&
        (isAdmin || !operation.startsWith("admin.")),
    ),
    ...(isAdmin ? AGENT_ADMIN_READ_OPERATIONS : []),
    ...(isAdmin ? AGENT_PROJECT_DELETION_READ_OPERATIONS : []),
  ];
}

/**
 * The operations that change nothing.
 *
 * @param isAdmin - Whether the executor is an administrator now.
 * @returns Every read and preview; the administrator reads only for administrators.
 *
 * @remarks
 * Comment changes are not part of the write operations, so the comment
 * operations are filtered here explicitly.
 */
export function readingOperations(
  isAdmin: boolean,
): readonly PagesAgentApiBusinessOperation[] {
  return [
    ...READING_OPERATIONS,
    ...(isAdmin ? AGENT_ADMIN_READ_OPERATIONS : []),
    ...(isAdmin ? AGENT_PROJECT_DELETION_READ_OPERATIONS : []),
  ];
}

/** The operations of a session before the deletion of a project is taken away. */
function forSession(
  scope: AgentRunScope,
  isAdmin: boolean,
): readonly PagesAgentApiBusinessOperation[] {
  switch (scope.reach) {
    case "tickets":
      return [
        ...PAGES_AGENT_TICKET_READ_OPERATIONS,
        ...PAGES_AGENT_WRITE_OPERATIONS,
        "ticket.work.read" as const,
        "ticket.work.save" as const,
      ].filter(
        (operation) =>
          operation !== "chat.sessions.delete" &&
          scope.operations.includes(operation),
      );
    case "read":
      return [...readingOperations(isAdmin), "ticket.work.read"];
    case "full":
      return [
        ...ownerOperations(isAdmin),
        "ticket.work.read",
        "ticket.work.save",
      ];
  }
}

/**
 * The operations the credential of an agent plan session may call.
 *
 * @param scope - The stored scope of the session.
 * @param isAdmin - Whether the executor is an administrator now.
 * @returns For the `tickets` reach the listed ticket operations; for `read`
 * every reading operation; for `full` every operation of the executor except
 * the upload, which only a personal credential completes. Whatever the reach,
 * never the deletion of a project, which needs a person at a keyboard.
 */
export function sessionOperations(
  scope: AgentRunScope,
  isAdmin: boolean,
): readonly PagesAgentApiBusinessOperation[] {
  return forSession(scope, isAdmin).filter(
    (operation) =>
      !AGENT_PLAN_COMMAND_OPERATIONS.some((command) => command === operation) &&
      operation !== "plans.templates.list" &&
      operation !== "plans.templates.read" &&
      operation !== "plans.control.read" &&
      operation !== "plans.capabilities.read" &&
      operation !== "plans.run.recovery.read" &&
      !AGENT_PROJECT_DELETION_WRITE_OPERATIONS.some(
        (deletion) => deletion === operation,
      ),
  );
}

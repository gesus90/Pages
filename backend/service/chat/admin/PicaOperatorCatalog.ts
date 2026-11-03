import { CHAT_ADMINISTRATION_TOOLS } from "@/definition/AgentTools/ChatAdministration";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";

import { requiresChatAdminConfirmation } from "../ChatAdministrationCatalog";
import { isChatOperation } from "../ChatToolCatalog";

import type { Tool } from "@modelcontextprotocol/server";
import type { ChatOperation } from "../ChatToolCatalog";

/** One operation of the administrator catalog with the contract the model sees. */
export interface PicaOperatorEntry {
  readonly operation: ChatOperation;
  readonly tool: Tool;
  /** The operation changes something; it needs an operation ID and the retry guard. */
  readonly isWrite: boolean;
}

/**
 * Operations of the chat catalog that no native tool offers, each with its reason.
 *
 * @remarks
 * Everything else in the chat catalog is reachable natively: the tools of
 * every person, the plan tools and the administrator catalog below.
 */
export const PICA_UNOFFERED_OPERATIONS: Readonly<Record<string, string>> = {
  "admin.users.create":
    "The one-time password reaches only the person in the interface; a tool result would carry it to the model.",
  "admin.users.resetPassword":
    "The one-time password reaches only the person in the interface; a tool result would carry it to the model.",
  "agents.create":
    "Retired: nodes of a plan carry their model and instruction.",
  "agents.update":
    "Retired: nodes of a plan carry their model and instruction.",
  "agents.clone": "Retired: copy a node or a plan template instead.",
  "agents.delete": "Retired: old definitions stay readable and kept.",
};

/** Changes that withdraw access besides the administration operations that always need a confirmation. */
const CRITICAL_OPERATIONS: ReadonlySet<string> = new Set([
  "projects.member.remove",
]);

/**
 * Tells whether an operation always needs the person's typed confirmation in a later message.
 *
 * @remarks
 * Besides these, a service may still answer `CONFIRMATION_REQUIRED` for a
 * change that withdraws rights or memberships; Pages then asks the same way.
 */
export function isPicaCriticalOperation(operation: string): boolean {
  return (
    requiresChatAdminConfirmation(operation) ||
    CRITICAL_OPERATIONS.has(operation)
  );
}

/**
 * Lists the operations only an administrator can use as native tools.
 *
 * @param native - The operations that already have a native tool for every person.
 * @returns The administration operations first, then every other operation of
 * the shared tool catalog that the chat knows and no native tool covers.
 *
 * @remarks
 * Plan operations have their own native tools. The list is derived from the
 * static contracts that MCP clients use, so a new operation of the agent API
 * reaches administrators without a second description.
 */
export function picaOperatorEntries(
  native: ReadonlySet<string>,
): readonly PicaOperatorEntry[] {
  const seen = new Set<string>();
  const entries: PicaOperatorEntry[] = [];
  for (const { operation, tool } of [
    ...CHAT_ADMINISTRATION_TOOLS,
    ...TOOL_ENTRIES,
  ]) {
    if (
      !isChatOperation(operation) ||
      native.has(operation) ||
      operation.startsWith("plans.") ||
      seen.has(operation)
    )
      continue;
    seen.add(operation);
    entries.push({
      operation,
      tool,
      isWrite: tool.annotations?.readOnlyHint !== true,
    });
  }
  return entries;
}

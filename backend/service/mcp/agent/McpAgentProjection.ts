import { databaseTimeToIso } from "@/backend/service/employee/AgentEmployeeText";
import { AGENT_EMPLOYEE_ACCESS_MODES } from "@/definition/AgentEmployee";

import type { StoredAgentUsages } from "@/backend/database/repositories/employee/AgentEmployeeRemovalRepository";
import type {
  AgentActivityEntry,
  AgentArchiveEntry,
  AgentEmployee,
  AgentMemoryVersion,
} from "@/definition/AgentEmployee";
import type { AgentInstructionTemplate } from "@/definition/AgentInstructionTemplate";
import type { PageAgentModel } from "@/definition/PageAgent";
import type {
  McpAgentActivityResponse,
  McpAgentArchiveEntryResponse,
  McpAgentMemoryVersionResponse,
  McpAgentModelOption,
  McpAgentPage,
  McpAgentResponse,
  McpAgentSummary,
  McpAgentTemplate,
  McpAgentUsagesResponse,
} from "./McpAgentContract";

/** Reads one text field of a stored detail; anything else counts as absent. */
function detailText(detail: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value: unknown = Reflect.get(parsed, field);
    return typeof value === "string" && value !== "" ? value : null;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** The title of a session or learning run, from the detail the activity stores. */
function sessionTitle(entry: AgentActivityEntry): string {
  const state = detailText(entry.detail, "state");
  const person = detailText(entry.detail, "person");
  const subject = person === null ? "Lernlauf" : `Sitzung mit ${person}`;
  return state === null ? subject : `${subject} (${state})`;
}

/** The title of a ticket or wiki change: the ticket key and the message of the project activity. */
function changeTitle(entry: AgentActivityEntry): string {
  const message = detailText(entry.detail, "message") ?? "";
  const key = detailText(entry.detail, "key");
  return key === null ? message : `${key}: ${message}`;
}

function activityTitle(entry: AgentActivityEntry): string {
  if (entry.id.startsWith("session:")) return sessionTitle(entry);
  if (entry.kind === "learning") {
    const status = detailText(entry.detail, "status");
    return status === null ? "Lernlauf" : `Lernlauf (${status})`;
  }
  return changeTitle(entry);
}

/**
 * The agent without its documents, as `GET /agents` lists it.
 *
 * @param agent - The agent as the user administration reads it.
 */
export function projectAgentSummary(agent: AgentEmployee): McpAgentSummary {
  const hasOnlyUnknownCosts =
    agent.cost.spent === 0 && agent.cost.unknownSessions > 0;
  return {
    id: agent.id,
    username: agent.username,
    name: agent.displayName,
    position: agent.position,
    color: agent.avatarColor,
    imageUrl: agent.avatarImageUrl,
    model: {
      connectionId: agent.settings.connectionId,
      modelId: agent.settings.model,
    },
    reasoning: agent.settings.reasoningEffort,
    access: agent.settings.access,
    costUsdThisMonth: hasOnlyUnknownCosts ? null : agent.cost.spent,
    roleId: agent.roleId,
    departmentIds: agent.departmentIds,
    memoryArchiveWords: agent.memoryUsage.archiveWords,
    isLearningEnabled: agent.learning.isEnabled,
    isActive: agent.isActive,
    revision: agent.revision,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

/**
 * The agent with `SOUL.md`, `AGENT.md` and `MEMORY.md`.
 *
 * @param agent - The agent as the user administration reads it.
 */
export function projectAgent(agent: AgentEmployee): McpAgentResponse {
  return {
    ...projectAgentSummary(agent),
    soul: agent.documents.soul,
    agentInstructions: agent.documents.instructions,
    memory: agent.memory,
  };
}

/**
 * A model of the choice of the interface; a model without a connection is no choice.
 *
 * @param model - A model the employee rule admits for the person.
 */
export function projectModelOption(
  model: PageAgentModel,
): McpAgentModelOption | null {
  if (model.connectionId === undefined) return null;
  return {
    connectionId: model.connectionId,
    modelId: model.model,
    name: model.modelName ?? model.name,
    provider: model.provider,
    connectionName: model.connectionName ?? null,
    reasoningEfforts: model.reasoningEfforts,
    accessModes: AGENT_EMPLOYEE_ACCESS_MODES,
  };
}

/**
 * What refers to an agent, as the removal question names it.
 *
 * @param usages - The stored references.
 */
export function projectUsages(
  usages: StoredAgentUsages,
): McpAgentUsagesResponse {
  return {
    chatLists: usages.chatLists,
    groups: usages.groups,
    tickets: { count: usages.ticketCount, items: usages.tickets },
    projects: usages.projects,
    plans: usages.plans,
  };
}

/**
 * A version of `MEMORY.md`.
 *
 * @param version - The stored version.
 */
export function projectMemoryVersion(
  version: AgentMemoryVersion,
): McpAgentMemoryVersionResponse {
  return {
    id: version.id,
    createdAt: databaseTimeToIso(version.createdAt) ?? version.createdAt,
    source: version.reason,
    words: version.coreWords,
  };
}

/**
 * An archive entry; its title leads the text.
 *
 * @param entry - The stored entry.
 */
export function projectArchiveEntry(
  entry: AgentArchiveEntry,
): McpAgentArchiveEntryResponse {
  return {
    id: entry.id,
    createdAt: databaseTimeToIso(entry.createdAt) ?? entry.createdAt,
    text:
      entry.title === "" ? entry.content : `${entry.title}\n\n${entry.content}`,
  };
}

/**
 * One line of the activity, never with a credential: the detail holds none.
 *
 * @param entry - The line as the activity of the interface lists it.
 */
export function projectActivity(
  entry: AgentActivityEntry,
): McpAgentActivityResponse {
  return {
    id: entry.id,
    at: entry.at,
    kind: entry.kind,
    title: activityTitle(entry),
    costUsd: entry.cost.state === "known" ? entry.cost.amount : null,
  };
}

/**
 * Cuts one page out of a list that is already in its order.
 *
 * @param items - The whole list.
 * @param page - The cursor of the request (the position of the first item) and the page size.
 */
export function pageOf<Item>(
  items: readonly Item[],
  page: { readonly cursor: string | undefined; readonly size: number },
): McpAgentPage<Item> {
  const start = page.cursor === undefined ? 0 : Number(page.cursor);
  const end = start + page.size;
  return {
    items: items.slice(start, end),
    nextCursor: end < items.length ? String(end) : null,
  };
}

/**
 * A stored template of `AGENT.md` as the interface answers it (PAGE-283).
 *
 * @param template - A template of the instance.
 */
export function projectTemplate(
  template: AgentInstructionTemplate,
): McpAgentTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    content: template.content,
    isDefault: template.isDefault,
  };
}

import { createHash } from "node:crypto";

import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";
import { validateMilestoneInput } from "@/backend/service/MilestoneValidation";
import { logCaughtError } from "@/backend/logging/Logger";

import type { StoredAgentImportSource } from "@/backend/database/repositories/agents/AgentImportRepository";
import type {
  AgentStructuredAction,
  AgentStructuredMilestone,
  AgentStructuredReason,
  AgentStructuredTicket,
} from "@/definition/AgentStructuredImportManifest";
import type { Milestone, WorkItemDetail } from "@/definition/Task";
import type { StructuredImportEnvironment } from "./StructuredImportEnvironment";
import type {
  StructuredDependencyStep,
  StructuredImportGraph,
  StructuredObjectStep,
  StructuredStep,
} from "./StructuredImportPlanner";

/** How a source relates to the target a repeated import finds for it. */
export interface StructuredTargetState {
  readonly action: Extract<AgentStructuredAction, "unchanged" | "conflict">;
  readonly reason: Extract<
    AgentStructuredReason,
    "source_changed" | "target_changed" | "target_removed"
  > | null;
  /** Whether the stored baseline has to move to the source, because the target shows it already. */
  readonly shouldRefresh: boolean;
}

/** Targets a step resolved earlier in the same run, by plan key. */
export interface StructuredResolvedIds {
  readonly parentId: string | null;
  readonly milestoneId: string | null;
}

function dateOrNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/**
 * Hashes everything a source imports, bound to the keys of its links.
 *
 * @param step - The ticket, milestone or dependency step.
 * @param graph - The planned graph of the manifest.
 * @param projectIds - Project IDs by project key.
 * @returns The hash a repeated import compares against its stored baseline.
 */
export function structuredStepHash(
  step: StructuredStep,
  graph: StructuredImportGraph,
  projectIds: ReadonlyMap<string, string>,
): string {
  const projectId = projectIds.get(step.project) ?? "";
  let fields: unknown = null;
  if (step.kind === "ticket") {
    const ticket = graph.sources.tickets.get(step.name);
    fields = ticket && {
      type: ticket.type,
      title: ticket.title.trim(),
      description: ticket.description.trim(),
      parent: graph.parents.get(step.name) ?? null,
      milestone: graph.milestones.get(step.name) ?? null,
    };
  } else if (step.kind === "milestone") {
    const milestone = graph.sources.milestones.get(step.name);
    fields = milestone && {
      name: milestone.name.trim(),
      description: milestone.description.trim(),
      startAt: dateOrNull(milestone.startAt),
      dueAt: dateOrNull(milestone.dueAt),
    };
  } else fields = { from: step.from, to: step.to, linkType: step.linkType };
  return createHash("sha256")
    .update(JSON.stringify({ key: step.key, projectId, fields }))
    .digest("hex");
}

function compare(
  mapping: StoredAgentImportSource,
  hash: string,
  showsSource: boolean,
): StructuredTargetState {
  if (showsSource)
    return {
      action: "unchanged",
      reason: null,
      shouldRefresh: mapping.contentHash !== hash,
    };
  return {
    action: "conflict",
    // The target equalled the source at its creation, so a source that did not move means the target did.
    reason: mapping.contentHash === hash ? "target_changed" : "source_changed",
    shouldRefresh: false,
  };
}

const REMOVED: StructuredTargetState = {
  action: "conflict",
  reason: "target_removed",
  shouldRefresh: false,
};

/** Tells whether the fields a ticket import writes are the ones of the ticket now. */
function ticketShows(
  ticket: WorkItemDetail,
  source: AgentStructuredTicket,
  resolved: StructuredResolvedIds,
): boolean {
  return (
    ticket.type === source.type &&
    ticket.title === source.title.trim() &&
    ticket.description === source.description.trim() &&
    ticket.parentId === resolved.parentId &&
    ticket.milestoneId === resolved.milestoneId
  );
}

/**
 * Compares a mapped ticket with its source.
 *
 * @param environment - Reads of the call.
 * @param mapping - The stored mapping of the source.
 * @param input - The step, the graph, the source hash and the targets resolved in this run.
 * @returns Unchanged when the ticket shows the source, otherwise the kind of conflict.
 */
export async function compareTicketTarget(
  environment: StructuredImportEnvironment,
  mapping: StoredAgentImportSource,
  input: {
    readonly step: StructuredObjectStep;
    readonly graph: StructuredImportGraph;
    readonly hash: string;
    readonly resolved: StructuredResolvedIds;
  },
): Promise<StructuredTargetState> {
  const source = input.graph.sources.tickets.get(input.step.name);
  if (!source || mapping.targetKind !== "ticket") return REMOVED;
  let ticket: WorkItemDetail;
  try {
    ticket = await environment.tasks.tasks.getById(
      environment.actor,
      mapping.targetId,
    );
  } catch (error: unknown) {
    logCaughtError("StructuredImportDecision", error);

    if (error instanceof WorkItemNotFoundError) return REMOVED;
    throw error;
  }
  return compare(
    mapping,
    input.hash,
    ticketShows(ticket, source, input.resolved),
  );
}

function milestoneShows(
  milestone: Milestone,
  source: AgentStructuredMilestone,
): boolean {
  const fields = validateMilestoneInput({
    name: source.name,
    startAt: source.startAt,
    dueAt: source.dueAt,
  });
  return (
    milestone.name === fields.name &&
    milestone.description === source.description.trim() &&
    milestone.startAt === fields.startAt &&
    milestone.dueAt === fields.dueAt
  );
}

/**
 * Compares a mapped milestone with its source.
 *
 * @param environment - Reads of the call.
 * @param mapping - The stored mapping of the source.
 * @param input - The step, the graph, the source hash and the project the milestone is in.
 * @returns Unchanged when the milestone shows the source, otherwise the kind of conflict.
 */
export async function compareMilestoneTarget(
  environment: StructuredImportEnvironment,
  mapping: StoredAgentImportSource,
  input: {
    readonly step: StructuredObjectStep;
    readonly graph: StructuredImportGraph;
    readonly hash: string;
    readonly projectId: string;
  },
): Promise<StructuredTargetState> {
  const source = input.graph.sources.milestones.get(input.step.name);
  if (!source || mapping.targetKind !== "milestone") return REMOVED;
  const milestones = await environment.tasks.tasks.findMilestones(
    environment.actor,
    [input.projectId],
  );
  const milestone = milestones.find(({ id }) => id === mapping.targetId);
  if (!milestone) return REMOVED;
  return compare(mapping, input.hash, milestoneShows(milestone, source));
}

/**
 * Compares a mapped dependency with the links of its project.
 *
 * @param environment - Reads of the call.
 * @param mapping - The stored mapping of the dependency.
 * @param input - The step, its hash and the project.
 * @returns Unchanged while the dependency exists, `target_removed` otherwise.
 */
export async function compareDependencyTarget(
  environment: StructuredImportEnvironment,
  mapping: StoredAgentImportSource,
  input: {
    readonly step: StructuredDependencyStep;
    readonly hash: string;
    readonly projectId: string;
  },
): Promise<StructuredTargetState> {
  if (mapping.targetKind !== "dependency") return REMOVED;
  const dependencies = await environment.tasks.tasks.findDependencies(
    environment.actor,
    [input.projectId],
  );
  return dependencies.some(({ id }) => id === mapping.targetId)
    ? compare(mapping, input.hash, true)
    : REMOVED;
}

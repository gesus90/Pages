import { structuredStepHash } from "./StructuredImportDecision";
import {
  compareDependencyTarget,
  compareMilestoneTarget,
  compareTicketTarget,
} from "./StructuredImportDecision";
import { structuredKey } from "./StructuredImportPlanner";

import type { StoredAgentImportSource } from "@/backend/database/repositories/agents/AgentImportRepository";
import type {
  AgentStructuredAction,
  AgentStructuredEdge,
  AgentStructuredIssue,
  AgentStructuredObject,
  AgentStructuredReason,
} from "@/definition/AgentStructuredImportManifest";
import type { StructuredImportEnvironment } from "./StructuredImportEnvironment";
import type {
  StructuredImportGraph,
  StructuredStep,
} from "./StructuredImportPlanner";

/** The part of the plan one stage contributes. */
export interface PreviewContribution {
  readonly objects: AgentStructuredObject[];
  readonly edges: AgentStructuredEdge[];
  readonly errors: AgentStructuredIssue[];
  readonly conflicts: AgentStructuredIssue[];
}

/** An empty contribution to fill. */
export function emptyContribution(): PreviewContribution {
  return { objects: [], edges: [], errors: [], conflicts: [] };
}

/** The first issue that names each key. */
export function firstIssueByKey(
  issues: readonly AgentStructuredIssue[],
): Map<string, AgentStructuredIssue> {
  const keys = new Map<string, AgentStructuredIssue>();
  for (const found of issues)
    for (const key of found.keys) if (!keys.has(key)) keys.set(key, found);
  return keys;
}

/** The plan keys a step builds on: its parent and milestone, or the two milestones of a dependency. */
function dependenciesOf(
  step: StructuredStep,
  graph: StructuredImportGraph,
): string[] {
  if (step.kind === "dependency")
    return [
      structuredKey("milestone", step.from),
      structuredKey("milestone", step.to),
    ];
  if (step.kind !== "ticket") return [];
  const parent = graph.parents.get(step.name);
  const milestone = graph.milestones.get(step.name);
  return [
    ...(parent === undefined ? [] : [structuredKey("ticket", parent)]),
    ...(milestone === undefined ? [] : [structuredKey("milestone", milestone)]),
  ];
}

/** Whether another object can build on this one: it exists, or the import will create it. */
function isUsable(planned: AgentStructuredObject | undefined): boolean {
  if (!planned) return false;
  return (
    planned.action === "create" ||
    planned.action === "unchanged" ||
    (planned.action === "conflict" && planned.targetId !== null)
  );
}

function plannedObject(
  step: StructuredStep,
  action: AgentStructuredAction,
  extra: {
    readonly reason?: AgentStructuredReason | null;
    readonly targetId?: string | null;
  } = {},
): AgentStructuredObject {
  return {
    kind: step.kind,
    key: step.key,
    sourceKey: step.key,
    label: step.label,
    project: step.project,
    action,
    reason: extra.reason ?? null,
    targetId: extra.targetId ?? null,
  };
}

interface StepContext {
  readonly projectId: string;
  readonly graph: StructuredImportGraph;
  readonly projectIds: ReadonlyMap<string, string>;
  readonly known: ReadonlyMap<string, AgentStructuredObject>;
}

async function compareStep(
  environment: StructuredImportEnvironment,
  step: StructuredStep,
  context: StepContext & { readonly mapping: StoredAgentImportSource },
): Promise<AgentStructuredObject> {
  const { mapping, graph, projectIds, projectId, known } = context;
  const hash = structuredStepHash(step, graph, projectIds);
  const targetOf = (
    kind: "ticket" | "milestone",
    key: string | undefined,
  ): string | null =>
    key === undefined
      ? null
      : (known.get(structuredKey(kind, key))?.targetId ?? null);
  let state;
  if (step.kind === "ticket")
    state = await compareTicketTarget(environment, mapping, {
      step,
      graph,
      hash,
      resolved: {
        parentId: targetOf("ticket", graph.parents.get(step.name)),
        milestoneId: targetOf("milestone", graph.milestones.get(step.name)),
      },
    });
  else if (step.kind === "milestone")
    state = await compareMilestoneTarget(environment, mapping, {
      step,
      graph,
      hash,
      projectId,
    });
  else
    state = await compareDependencyTarget(environment, mapping, {
      step,
      hash,
      projectId,
    });
  return plannedObject(step, state.action, {
    reason: state.reason,
    targetId: state.reason === "target_removed" ? null : mapping.targetId,
  });
}

/**
 * Plans the milestones, tickets and dependencies in application order.
 *
 * @param environment - Account, rights and repositories of the call.
 * @param context - The graph, the project IDs and the errors found so far.
 * @returns One object per step, and a conflict for each mapped source that differs.
 */
export async function previewSteps(
  environment: StructuredImportEnvironment,
  context: {
    readonly graph: StructuredImportGraph;
    readonly projectIds: ReadonlyMap<string, string>;
    readonly errors: readonly AgentStructuredIssue[];
  },
): Promise<PreviewContribution> {
  const result = emptyContribution();
  const flagged = firstIssueByKey(context.errors);
  const known = new Map<string, AgentStructuredObject>();
  for (const step of context.graph.steps) {
    const found = flagged.get(step.key);
    const projectId = context.projectIds.get(step.project);
    let planned: AgentStructuredObject;
    if (found || projectId === undefined)
      planned = plannedObject(step, "invalid", {
        reason: found?.reason ?? null,
      });
    else {
      const mapping = await environment.imports.findSource(projectId, step.key);
      planned = mapping
        ? await compareStep(environment, step, {
            mapping,
            projectId,
            graph: context.graph,
            projectIds: context.projectIds,
            known,
          })
        : plannedObject(step, "create");
    }
    if (
      planned.action === "create" &&
      dependenciesOf(step, context.graph).some(
        (key) => !isUsable(known.get(key)),
      )
    )
      planned = plannedObject(step, "blocked", { reason: "blocked" });
    known.set(step.key, planned);
    result.objects.push(planned);
    if (planned.action === "conflict")
      result.conflicts.push({
        code: "CONFLICT",
        reason: planned.reason ?? "source_changed",
        keys: [step.key],
      });
  }
  return result;
}

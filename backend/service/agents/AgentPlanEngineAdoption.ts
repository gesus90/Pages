import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { readPlanSnapshot } from "./AgentPlanSnapshot";
import { bindPlanBranchState } from "./branching/AgentPlanBranchPersistence";
import { restorePlanInstruction } from "./AgentPlanInstructionControl";
import {
  adoptedPlanView,
  withAdoptedSession,
  reconcileAdoptedRun,
} from "./AgentPlanAdoptedView";

import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRun, AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { PlanInstructionWork } from "./AgentPlanInstructionControl";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";

interface AdoptionContext {
  readonly dependencies: EngineDependencies;
  readonly active: Map<string, ActivePlanRun>;
  readonly writes: SerialQueue;
  readonly start: (
    active: ActivePlanRun,
    node: AgentPlanNode,
    controller: AbortController,
  ) => void;
  readonly track: (active: ActivePlanRun, pending: Promise<void>) => void;
  readonly pump: () => Promise<void>;
  readonly instruction: (
    active: ActivePlanRun,
    work: PlanInstructionWork,
  ) => Promise<PlanSessionTurn>;
}

/** Restores one same-identity run around its proven, already running native owners. */
export async function adoptLocalPlanRun(
  previous: AgentPlanRun,
  context: AdoptionContext,
): Promise<boolean> {
  if (context.active.has(previous.id)) return true;
  if (!canAdoptFrontier(previous, context)) return false;
  const snapshot = readPlanSnapshot(
    await context.dependencies.runs.snapshot?.(previous.id),
  );
  const { view, uncertain } = await adoptionView(previous, snapshot, context);
  const active: ActivePlanRun = {
    view,
    snapshot,
    groupCloseout: "open",
    hasPersistenceFailure: uncertain,
    dispatched: new Set(),
    controllers: new Map(),
    executions: new Set(),
    releaseDefinition: await context.dependencies.files?.hold(
      snapshot.steps.map((step) => step.step.agentId),
    ),
    branching: await context.dependencies.runs.engineState?.(view.id),
  };
  bindPlanBranchState(active);
  context.active.set(view.id, active);
  await context.dependencies.steps.restore?.(
    view,
    snapshot,
    (record) => saveRestoredSession(active, record, context),
    {
      instruction: (work) => context.instruction(active, work),
      trackInstruction: (instanceId, pending) =>
        context.track(
          active,
          restorePlanInstruction(
            active,
            {
              writes: context.writes,
              runs: context.dependencies.runs,
              settled: context.pump,
            },
            { instanceId, pending },
          ),
        ),
    },
  );
  for (const result of active.view.steps.filter(
    (step) => step.status === "running",
  )) {
    const node = snapshot.plan.nodes.find(
      (candidate) => candidate.id === result.id,
    );
    if (!node) continue;
    const controller = new AbortController();
    active.controllers.set(node.id, controller);
    active.dispatched.add(node.id);
    context.start(active, node, controller);
    if (view.stopRequested) controller.abort();
  }
  await context.dependencies.runs.update(active.view);
  if (view.status === "paused" || view.status === "pausing")
    context.dependencies.resources?.pauseRun(view.id);
  return true;
}

async function saveRestoredSession(
  active: ActivePlanRun,
  record: AgentPlanSessionRecord,
  context: AdoptionContext,
): Promise<void> {
  await context.writes.run(async () => {
    active.view = withAdoptedSession(active.view, record);
    bindPlanBranchState(active);
    await context.dependencies.runs.update(active.view);
  });
}

function canAdoptFrontier(
  run: AgentPlanRun,
  context: AdoptionContext,
): boolean {
  return (
    Boolean(context.dependencies.runs.snapshot) &&
    (context.dependencies.localSessions?.hasRun(run.id) === true ||
      allPlanRunResults(run).every(
        (step) => step.status !== "running" || step.remote !== undefined,
      ))
  );
}

async function adoptionView(
  previous: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
  context: AdoptionContext,
): Promise<{ readonly view: AgentPlanRun; readonly uncertain: boolean }> {
  const local = context.dependencies.localSessions;
  const unresolved = local?.unverified() ?? new Set<string>();
  return {
    uncertain: allPlanRunResults(previous).some(
      (step) => step.session != null && unresolved.has(step.session.instanceId),
    ),
    view: local
      ? adoptedPlanView(
          await reconcileAdoptedRun(previous, local),
          snapshot,
          local,
        )
      : previous,
  };
}

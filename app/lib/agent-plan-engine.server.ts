import { AgentPlanWorkGate } from "@/backend/service/agents/AgentPlanWorkGate";
import { AgentPlanScriptRunner } from "@/backend/service/agents/AgentPlanScriptRunner";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { QueuedPlanRunEngine } from "@/backend/service/agents/runs/QueuedPlanRunEngine";
import { runsSocketPath } from "@/backend/service/agents/runs/RunsSocket";
import { AgentPlanStepReportService } from "@/backend/service/agents/AgentPlanStepReportService";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { canProcessRuns } from "@/backend/runtime/RunsMode";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { AgentPlanStartResources } from "@/backend/service/agents/AgentPlanStartResources";
import { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";

import { createModelNodeRunners } from "./agent-plan-swarm.server";
import { createPlanTodoProgress } from "./agent-plan-todo-progress.server";

import type { RunnerPlanExecution } from "@/backend/service/runner/RunnerPlanExecution";
import type { RunnerPlanScripts } from "@/backend/service/runner/RunnerPlanScripts";
import type { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
import type { AgentPlanInvocations } from "@/backend/service/agents/invocation/AgentPlanInvocations";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import type { AgentPlanSessionGrants } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import type { PlanRunEnginePort } from "@/backend/service/agents/runs/PlanRunEnginePort";
import type { AgentApplicationServices } from "./agent-services.server";
import type { createAgentPlanService } from "./agent-plan-services.server";

/** The runner facts learn which runs an engine of this process still drives. */
export function attachRunOwnership(
  runners: AgentApplicationServices["runnerService"],
  engine: PlanRunEnginePort,
): void {
  const localEngine: AgentPlanRunEngine | null =
    engine instanceof AgentPlanRunEngine ? engine : null;
  runners.attachRunOwnership((id) => localEngine?.isActive(id) ?? true);
}

/** Builds the plan engine with one runner execution boundary for every node kind. */
export async function createAttachedPlanEngine(
  input: Parameters<typeof createAgentPlanService>[0],
  parts: Parameters<typeof createPlanEngine>[1],
): Promise<PlanRunEnginePort> {
  const engine = await createPlanEngine(input, parts);
  attachRunOwnership(input.agents.runnerService, engine);
  return engine;
}

async function createPlanEngine(
  input: Parameters<typeof createAgentPlanService>[0],
  parts: {
    readonly remoteExecution: AgentPlanRemoteExecution;
    readonly execution: RunnerPlanExecution;
    readonly runnerScripts: RunnerPlanScripts;
    readonly scripts: AgentPlanScriptPreparation;
    readonly runs: AgentPlanRunRepository;
    readonly start: AgentPlanStepStart;
    readonly tasks: AgentPlanTasks;
    readonly sessions: AgentPlanSessionGrants;
    readonly pageAgentSessions: AgentSessionService;
    readonly invocations?: AgentPlanInvocations;
  },
): Promise<PlanRunEnginePort> {
  const runtime = await getPagesRuntime();
  if (!canProcessRuns()) {
    const engine = new QueuedPlanRunEngine(
      input.database,
      runsSocketPath(runtime.getDatabasePath()),
    );
    attachRunOwnership(input.agents.runnerService, engine);
    return engine;
  }
  const engine = new AgentPlanRunEngine({
    startResources: new AgentPlanStartResources({
      repository: new AgentPlanStartResourceRepository(input.database),
      remote: parts.remoteExecution,
      localSessions: input.agents.localSessions ?? undefined,
      resources: input.agents.acpResourceScheduler,
    }),
    deferScheduling: true,
    localSessions: input.agents.localSessions ?? undefined,
    workGate: new AgentPlanWorkGate(input.database, input.users),
    remoteExecution: parts.remoteExecution,
    runnerExecution: {
      setRunPaused: async (runId, isPaused) => {
        await Promise.all([
          parts.execution.setRunPaused(runId, isPaused),
          parts.runnerScripts.setRunPaused(runId, isPaused),
        ]);
      },
    },
    scripts: new AgentPlanScriptRunner(parts.scripts, parts.runnerScripts),
    ...createModelNodeRunners(
      {
        ...input,
        agents: { ...input.agents, agentPlanExecution: parts.execution },
      },
      parts,
    ),
    runs: parts.runs,
    start: parts.start,
    invocations: parts.invocations,
    resources: input.agents.acpResourceScheduler,
    steps: new AgentPlanStepRunner({
      localSessions: input.agents.localSessions ?? undefined,
      start: {
        prepare: (run, snapshot, step) =>
          step.remoteTarget
            ? parts.remoteExecution.prepareSession(run, snapshot, step)
            : parts.start.prepare(run, snapshot, step),
        prepareGroup: (run, snapshot, groupId) =>
          snapshot.steps.some(
            (step) => step.groupId === groupId && step.remoteTarget,
          )
            ? parts.remoteExecution.prepareGroupSession(run, snapshot, groupId)
            : parts.start.prepareGroup(run, snapshot, groupId),
      },
      execution: parts.execution,
      tasks: parts.tasks,
      access: parts.sessions,
      stepReports: new AgentPlanStepReportService(
        new AgentPlanStepReportRepository(input.database),
        parts.tasks,
        createPlanTodoProgress(input.database),
      ),
      stepProgress: createPlanTodoProgress(input.database),
      archive: input.agents.agentRunArchive,
      sessions: parts.pageAgentSessions,
    }),
    archive: input.agents.agentRunArchive,
    files: input.agents.agentDefinitionFiles,
  });
  attachRunOwnership(input.agents.runnerService, engine);
  return engine;
}

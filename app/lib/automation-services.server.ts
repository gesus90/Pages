import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import { AutomationEventRepository } from "@/backend/database/repositories/automation/AutomationEventRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WorkflowStatusRepository } from "@/backend/database/repositories/task/WorkflowStatusRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { logCaughtError } from "@/backend/logging/Logger";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { canProcessRuns, isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { AgentPlanScripts } from "@/backend/service/agents/AgentPlanScripts";
import { sharedAgentPlanRunObservers } from "@/backend/service/agents/AgentPlanRunObservers";
import { AutomationAgentWorker } from "@/backend/service/automation/AutomationAgentWorker";
import { AutomationEventIntake } from "@/backend/service/automation/AutomationEventIntake";
import { AutomationPlanEvents } from "@/backend/service/automation/AutomationPlanEvents";
import { AutomationRunEnding } from "@/backend/service/automation/AutomationRunEnding";
import { AutomationRunExecutor } from "@/backend/service/automation/AutomationRunExecutor";
import { AutomationScheduler } from "@/backend/service/automation/AutomationScheduler";
import { executeAutomationScript } from "@/backend/service/automation/AutomationScriptProcess";
import { AutomationService } from "@/backend/service/automation/AutomationService";
import { AgentAutomationTurns } from "@/backend/service/employee/AgentAutomationTurns";

import { PagesAutomationDirectory } from "./automation-directory.server";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AutomationExecutionPorts } from "@/backend/service/automation/AutomationRunExecutor";
import type { AgentChatService } from "@/backend/service/conversation/AgentChatService";
import type { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import type { PicaMobileAutomationPush } from "@/backend/service/mobile/notifications/PicaMobileAutomationPush";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type { AgentPlanServices } from "./agent-plan-services.server";
import type { AgentApplicationServices } from "./agent-services.server";

declare global {
  var pagesAutomationPlanEvents: (() => void) | undefined;
  var pagesAutomationScheduler: AutomationScheduler | undefined;
  var pagesAutomationAgentWorker: AutomationAgentWorker | undefined;
}

/** The automation services of loaders, actions and the agent tools (PAGE-297). */
export interface AutomationApplicationServices {
  readonly automationService: AutomationService;
}

/** What the timer of automations runs plans, scripts and pushes with. */
interface AutomationSchedulerInput {
  readonly database: Database;
  readonly automationService: AutomationService;
  readonly plans: AgentPlanService;
  readonly workspaces: AgentWorkspaceService;
  readonly push: PicaMobileAutomationPush;
}

function executionPorts(
  input: AutomationSchedulerInput,
): AutomationExecutionPorts {
  const scripts = new AgentPlanScripts({
    snapshot: async () =>
      (await getPagesRuntime()).interpreterProfiles.snapshot(),
  });
  return {
    startPlan: async (userId, planId) => {
      const plan = await input.plans.view(userId, planId);
      return (await input.plans.play(userId, planId, plan.revision)).id;
    },
    planRunStatus: async (userId, runId) => {
      try {
        return (await input.plans.run(userId, runId)).status;
      } catch {
        return null;
      }
    },
    runScript: async (request) => {
      const [workspace, profile] = await Promise.all([
        input.workspaces.resolve(request.userId, request.workspaceId),
        scripts.executable(request.interpreterProfileId),
      ]);
      return executeAutomationScript({
        userId: request.userId,
        program: profile.path,
        directory: workspace.path,
        interpreterProfileId: profile.id,
        content: request.content,
        input: request.input,
        timeoutSeconds: request.timeoutSeconds,
        signal: request.signal,
      });
    },
  };
}

/**
 * Writes the events of plan runs of this process to the inbox of automations.
 *
 * @remarks
 * Every process observes the run writes it commits itself; a second call
 * replaces the first.
 */
function observePlanEvents(database: Database): void {
  globalThis.pagesAutomationPlanEvents?.();
  globalThis.pagesAutomationPlanEvents = sharedAgentPlanRunObservers().add(
    new AutomationPlanEvents(new AutomationEventRepository(database)),
  );
}

/**
 * Builds the business service of automations, observes plan events and
 * starts the timer where plans run (PAGE-297).
 *
 * @param database - The shared database.
 * @param input - The agent, project and ticket services the rules read from.
 * @param plans - The plan services that start plans and push to devices.
 */
export function createAutomationServices(
  database: Database,
  input: {
    readonly agents: Pick<AgentApplicationServices, "agentWorkspaceService">;
    readonly projects: ProjectService;
    readonly tasks: TaskService;
  },
  plans: Pick<
    AgentPlanServices,
    "agentPlanService" | "picaMobileAutomationPush"
  >,
): AutomationApplicationServices {
  observePlanEvents(database);
  const automationService = new AutomationService({
    database,
    directory: new PagesAutomationDirectory({
      database,
      plans: plans.agentPlanService,
      projects: input.projects,
      tasks: input.tasks,
      workspaces: input.agents.agentWorkspaceService,
    }),
    wake: () => globalThis.pagesAutomationScheduler?.wake(),
  });
  startAutomationScheduler({
    database,
    automationService,
    plans: plans.agentPlanService,
    workspaces: input.agents.agentWorkspaceService,
    push: plans.picaMobileAutomationPush,
  });
  return { automationService };
}

/** Starts the timer of automations where plans run. */
function startAutomationScheduler(input: AutomationSchedulerInput): void {
  if (!canProcessRuns() || isLocalSessionOwner()) return;
  const { database, automationService } = input;
  const projects = new ProjectRepository(database);
  const statuses = new WorkflowStatusRepository(database);
  const now = (): Date => new Date();
  const executor = new AutomationRunExecutor({
    database,
    rules: automationService.rules,
    ending: new AutomationRunEnding({
      database,
      rules: automationService.rules,
      now,
      notifyPerson: (userId, notice) => input.push.notify(userId, notice),
    }),
    ports: executionPorts(input),
    now,
  });
  const scheduler = new AutomationScheduler({
    database,
    executor,
    intake: new AutomationEventIntake({
      database,
      rules: automationService.rules,
      lookups: {
        projectName: async (projectId) =>
          (await projects.findById(projectId))?.name ?? null,
        statusNames: async () =>
          new Map(
            (await statuses.findAll()).map((status) => [
              status.id,
              status.name,
            ]),
          ),
      },
      now,
    }),
    now,
  });
  void globalThis.pagesAutomationScheduler?.stop();
  globalThis.pagesAutomationScheduler = scheduler;
  scheduler.start();
  registerShutdownTask(() => scheduler.stop(), { step: "automations" });
}

/**
 * Starts the delivery of automation work to agents where their sessions run (PAGE-297).
 *
 * @param input - The database, the automation rules and the agents' sessions.
 */
export function startAutomationAgentWorker(input: {
  readonly database: Database;
  readonly automationService: AutomationService;
  readonly sessions: AgentEmployeeSessions;
  /** Stores the result of a run in a group as the agent's message (PAGE-376). */
  readonly chatPoster?: Pick<AgentChatService, "postResult">;
}): void {
  if (isLocalSessionOwner() || isPagesRunsProcess()) return;
  const simulation = currentAgentSimulationMode();
  const worker = new AutomationAgentWorker({
    database: input.database,
    rules: input.automationService.rules,
    runner: new AgentAutomationTurns({
      store: new EmployeeStore(input.database),
      users: new UserRepository(input.database),
      sessions: input.sessions,
      messages: new ChatSessionRepository(input.database),
      ...(input.chatPoster ? { chatPoster: input.chatPoster } : {}),
      simulation: simulation.isActive
        ? new SimulatedConversationAgent(simulation)
        : null,
    }),
    now: () => new Date(),
  });
  globalThis.pagesAutomationAgentWorker?.stop();
  globalThis.pagesAutomationAgentWorker = worker;
  void worker.start().catch((error: unknown) => {
    logCaughtError("AutomationAgentWorker", error);
  });
  registerShutdownTask(
    () => {
      worker.stop();
      return Promise.resolve();
    },
    { step: "automation_agents" },
  );
}

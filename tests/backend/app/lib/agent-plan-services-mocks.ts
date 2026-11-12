import { vi } from "vitest";

const { fakeClasses, runRepositoryFake } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/app/lib/plan-access-services.server", () => ({
  createPlanWorkspaceAccess: vi.fn(),
  planAccessRecords: vi.fn(() => ({})),
}));
vi.mock("@/app/lib/pica-mobile-notification-services.server", () => ({
  createPicaMobileNotificationServices: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentPlanOwnerRunReader", () =>
  fakeClasses({ AgentPlanOwnerRunReader: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanConfigurationUpgrade", () => ({
  upgradePlanConfigurations: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentPlanLegacyShare", () => ({
  shareLegacyPlans: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({ getPagesRuntime: vi.fn() }));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));
vi.mock("@/backend/service/agents/runs/PlanRunCommandWorker", () =>
  fakeClasses({ PlanRunCommandWorker: ["start", "stop"] }),
);
vi.mock("@/backend/service/agents/AgentWorkspaceCleanupService", () =>
  fakeClasses({ AgentWorkspaceCleanupService: ["start"] }),
);
vi.mock("@/app/lib/agent-plan-one-shot-services.server", () => ({
  startOneShotPlanDeletion: vi.fn(),
}));
vi.mock("@/backend/runtime/RunsMode", () => ({
  canProcessRuns: () => true,
  isPagesRunsProcess: () => false,
}));
vi.mock("@/backend/service/agents/AgentPlanWorkGate", () =>
  fakeClasses({ AgentPlanWorkGate: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanRemoteExecution", () =>
  fakeClasses({ AgentPlanRemoteExecution: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanRemoteParameters", () =>
  fakeClasses({ AgentPlanRemoteParameters: [] }),
);
vi.mock("@/backend/service/runner/RunnerPagesAccessService", () =>
  fakeClasses({ RunnerPagesAccessService: ["recover"] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository",
  () => fakeClasses({ AgentPlanRemoteAccessRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanRemoteTargets", () =>
  fakeClasses({ AgentPlanRemoteTargets: [] }),
);
vi.mock(
  "@/backend/database/repositories/mcp/AgentRunCredentialRepository",
  () => fakeClasses({ AgentRunCredentialRepository: [] }),
);
vi.mock("@/backend/database/repositories/AgentConnectionRepository", () =>
  fakeClasses({ AgentConnectionRepository: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRepository", () =>
  fakeClasses({ AgentPlanRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanTemplateRepository",
  () => fakeClasses({ AgentPlanTemplateRepository: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentProfileRepository", () =>
  fakeClasses({ AgentProfileRepository: ["list"] }),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRunRepository", () =>
  runRepositoryFake(),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository",
  () => fakeClasses({ AgentPlanStartRejectionRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanCheckpointRepository",
  () => fakeClasses({ AgentPlanCheckpointRepository: ["find"] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository",
  () => fakeClasses({ AgentPlanCleanupFailureRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRecoveryRepository",
  () => fakeClasses({ AgentPlanRecoveryRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository",
  () => fakeClasses({ AgentPlanRecoveryExecutionRepository: [] }),
);
vi.mock("@/backend/service/agents/recovery/AgentPlanRecoveryService", () =>
  fakeClasses({ AgentPlanRecoveryService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanPreparation", () =>
  fakeClasses({ AgentPlanPreparation: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanScripts", () =>
  fakeClasses({ AgentPlanScripts: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanScriptPreparation", () =>
  fakeClasses({ AgentPlanScriptPreparation: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanScriptRunner", () =>
  fakeClasses({ AgentPlanScriptRunner: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanRunEngine", () =>
  fakeClasses({ AgentPlanRunEngine: ["isActive"] }),
);
vi.mock("@/backend/service/agents/AgentPlanService", () =>
  fakeClasses({ AgentPlanService: ["run", "stop", "recoverInterruptedRuns"] }),
);
vi.mock("@/backend/service/agents/AgentPlanManagement", () =>
  fakeClasses({ AgentPlanManagement: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanTemplateService", () =>
  fakeClasses({ AgentPlanTemplateService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanSessionAccess", () =>
  fakeClasses({ AgentPlanSessionAccess: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanStepRunner", () =>
  fakeClasses({ AgentPlanStepRunner: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanStepStart", () =>
  fakeClasses({ AgentPlanStepStart: [] }),
);
vi.mock("@/backend/service/mcp/AgentRunCredentialService", () =>
  fakeClasses({ AgentRunCredentialService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanPhases", () =>
  fakeClasses({ AgentPlanPhases: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanTasks", () =>
  fakeClasses({ AgentPlanTasks: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentSessionRepository", () =>
  fakeClasses({ AgentSessionRepository: [] }),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionInbox", () =>
  fakeClasses({ AgentSessionInbox: ["recover"] }),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionJournal", () =>
  fakeClasses({ AgentSessionJournal: [] }),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionService", () =>
  fakeClasses({ AgentSessionService: [] }),
);
vi.mock("@/backend/database/repositories/AuthorizationRepository", () =>
  fakeClasses({ AuthorizationRepository: [] }),
);

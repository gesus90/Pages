import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const SOURCE_FILE_PATTERN = "*.{ts,tsx,mts,cts,js,mjs,cjs}";
const TEST_FILE_PATTERN = "*.{test,spec}.ts";
export const BACKEND_TEST_GLOB = `backend/**/${TEST_FILE_PATTERN}`;
export const BACKEND_REPORTS_DIRECTORY = "coverage/backend";
export const BACKEND_TEST_RESULTS_FILE = "test-results.json";
export const BACKEND_COVERAGE_EXCLUDES = [
  "backend/**/*.d.{ts,mts,cts}",
  BACKEND_TEST_GLOB,
];
export const FIRST_SECTION_COVERAGE_GLOB = `backend/{discord,cache,concurrency}/**/${SOURCE_FILE_PATTERN}`;
export const SECOND_SECTION_COVERAGE_GLOB = `backend/{github,security,setup}/**/${SOURCE_FILE_PATTERN}`;
export const THIRD_SECTION_COVERAGE_GLOB = `backend/{storage,google,config,remote}/**/${SOURCE_FILE_PATTERN}`;
export const FOURTH_SECTION_COVERAGE_GLOB = `backend/{auth,logging}/**/${SOURCE_FILE_PATTERN}`;
export const FIFTH_SECTION_COVERAGE_GLOB = `backend/runtime/**/${SOURCE_FILE_PATTERN}`;

// These are required minimums, not claims about measured coverage.
export const BACKEND_COVERAGE_SECTIONS = [
  {
    name: "first-section",
    include: FIRST_SECTION_COVERAGE_GLOB,
    minimum: 100,
  },
  {
    name: "second-section",
    include: SECOND_SECTION_COVERAGE_GLOB,
    minimum: 100,
  },
  {
    name: "third-section",
    include: THIRD_SECTION_COVERAGE_GLOB,
    minimum: 100,
  },
  {
    name: "fourth-section",
    include: FOURTH_SECTION_COVERAGE_GLOB,
    minimum: 100,
  },
  {
    name: "fifth-section",
    include: FIFTH_SECTION_COVERAGE_GLOB,
    minimum: 100,
  },
  {
    name: "errors",
    include: `backend/error/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "agent-catalog-runtime-simulation",
    include: `backend/agents/{catalog,runtime,simulation}/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "agent-providers",
    include: `backend/agents/providers/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "local-agent-sessions",
    include: `backend/agents/local/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "agent-acp",
    include: `backend/agents/acp/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "agent-cli",
    include: `backend/agents/cli/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "agent-base",
    include: `backend/agents/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-core-executor-postgres",
    include: `backend/database/{,executor/,postgres/}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-project-task-wiki-repositories",
    include: `backend/database/repositories/{{project,task,wiki}/**/,{Project,Task,Wiki}Repository}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-chat-conversation-repositories",
    include: `backend/database/repositories/{{chat,conversation}/**/,LiveChangeNotificationRepository}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-agent-repositories",
    include: `backend/database/repositories/{agents/**/,AgentConnectionRepository,agent/!(AgentPlan|Plan)*}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-agent-plan-repositories",
    include: `backend/database/repositories/agent/{AgentPlan{AccessRepository,AuditRepository,ChangeNotification,DeletionGuard,OneShotRepository,RemoteAccessRepository,Repository,ScriptApprovalRepository,StoredReferences,TeamRepository,TemplateRepository,WorkspaceRepository},PlanBridgeGrantRepository}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-runner-plan-run-repositories",
    include: `backend/database/repositories/{runner/**/,agent/{AgentPlan!(AccessRepository|AuditRepository|ChangeNotification|DeletionGuard|OneShotRepository|RemoteAccessRepository|Repository|ScriptApprovalRepository|StoredReferences|TeamRepository|TemplateRepository|WorkspaceRepository),Plan!(BridgeGrantRepository)}}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-automation-repositories",
    include: `backend/database/repositories/automation/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-employee-repositories",
    include: `backend/database/repositories/employee/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-calendar-event-repositories",
    include: `backend/database/repositories/{calendar,events}/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-integration-repositories",
    include: `backend/database/repositories/{{mobile,remote,integrations,discord,google,mcp,speech}/**/,GitHubRepository}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-search-diagnosis-storage-repositories",
    include: `backend/database/repositories/{{search,diagnosis,storage}/**/,{StoredTextForm,SystemMetricsRepository}}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "database-remaining-repositories",
    include: `backend/database/repositories/{AdministrationActivityRepository,AuthorizationRepository,InstanceSettingsRepository,LegacyAccountProvisioning,ManagementAuditRepository,ManagementRepository,SessionRepository,User{,BoardPreferences,Group,Settings}Repository}${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "service-wiki",
    include: `backend/service/wiki/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "service-task",
    include: `backend/service/task/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "service-project",
    include: `backend/service/project/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "service-calendar-events",
    include: `backend/service/{calendar,events}/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "service-automation",
    include: `backend/service/automation/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "service-external-providers",
    include: `backend/service/{github,google,discord}/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "service-remote-integrations",
    include: `backend/service/{remote,integrations}/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
  {
    name: "service-management-system-search",
    include: `backend/service/{management,system,interpreters,search}/**/${SOURCE_FILE_PATTERN}`,
    minimum: 100,
  },
] as const;

// Service subdirectories that belong to another package: the agents area and
// the packages with their own directory.
const SERVICE_DIRECTORIES_WITH_OTHER_PACKAGES = [
  "agents",
  "automation",
  "calendar",
  "chat",
  "conversation",
  "design",
  "discord",
  "employee",
  "events",
  "github",
  "google",
  "integrations",
  "interpreters",
  "management",
  "mcp",
  "mobile",
  "project",
  "remote",
  "runner",
  "search",
  "speech",
  "system",
  "task",
  "wiki",
] as const;

// Registered packages select their tests and are counted in the section
// report. Their sources are not measured and carry no threshold until the
// package moves into BACKEND_COVERAGE_SECTIONS.
export const BACKEND_REGISTERED_PACKAGES = [
  {
    name: "service-chat",
    include: `backend/service/chat/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-conversation",
    include: `backend/service/conversation/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-employee",
    include: `backend/service/employee/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-mcp",
    include: `backend/service/mcp/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-mobile",
    include: `backend/service/mobile/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-runner",
    include: `backend/service/runner/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-design",
    include: `backend/service/design/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-speech",
    include: `backend/service/speech/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-root-before-m",
    include: `backend/service/[0-9A-L]${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-root-from-m-and-remaining-directories",
    include: `backend/service/{[!0-9A-L],!(${SERVICE_DIRECTORIES_WITH_OTHER_PACKAGES.join("|")})/**/}${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-agent-assets-branching-bridge",
    include: `backend/service/agents/{assets,branching,bridge}/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-agent-diagnosis-invocation",
    include: `backend/service/agents/{diagnosis,invocation}/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-agent-loop-recovery",
    include: `backend/service/agents/{loop,recovery}/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-agent-resources",
    include: `backend/service/agents/resources/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-agent-runs",
    include: `backend/service/agents/runs/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-agent-sessions",
    include: `backend/service/agents/sessions/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-agent-stack-swarm",
    include: `backend/service/agents/{stack,swarm}/**/${SOURCE_FILE_PATTERN}`,
  },
  {
    name: "service-agent-tools-usage",
    include: `backend/service/agents/{tools,usage}/**/${SOURCE_FILE_PATTERN}`,
  },
] as const;

function testGlob(include: string): string {
  return include.replace(SOURCE_FILE_PATTERN, TEST_FILE_PATTERN);
}

export const BACKEND_TEST_SECTIONS = [
  ...BACKEND_COVERAGE_SECTIONS.map(({ name, include }) => ({
    name,
    include: testGlob(include),
  })),
  ...BACKEND_REGISTERED_PACKAGES.map(({ name, include }) => ({
    name,
    include: testGlob(include),
  })),
] as const;

const thresholds = Object.fromEntries(
  BACKEND_COVERAGE_SECTIONS.map(
    (section) =>
      [
        section.include,
        {
          perFile: true,
          statements: section.minimum,
          branches: section.minimum,
          functions: section.minimum,
          lines: section.minimum,
        },
      ] as const,
  ),
);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    name: "backend",
    environment: "node",
    include: BACKEND_TEST_SECTIONS.map((section) => section.include),
    reporters: ["default", "json"],
    outputFile: {
      json: `${BACKEND_REPORTS_DIRECTORY}/${BACKEND_TEST_RESULTS_FILE}`,
    },
    pool: "forks",
    maxWorkers: 2,
    isolate: true,
    allowOnly: false,
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: BACKEND_COVERAGE_SECTIONS.map((section) => section.include),
      exclude: BACKEND_COVERAGE_EXCLUDES,
      reportsDirectory: BACKEND_REPORTS_DIRECTORY,
      reporter: ["json", "json-summary"],
      skipFull: false,
      clean: true,
      reportOnFailure: true,
      processingConcurrency: 2,
      thresholds,
    },
  },
});

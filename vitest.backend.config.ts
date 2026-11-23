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
] as const;

export const BACKEND_TEST_SECTIONS = BACKEND_COVERAGE_SECTIONS.map(
  ({ name, include }) => ({
    name,
    include: include.replace(SOURCE_FILE_PATTERN, TEST_FILE_PATTERN),
  }),
);

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

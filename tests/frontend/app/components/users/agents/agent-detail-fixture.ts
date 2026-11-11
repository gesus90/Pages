import type {
  AgentActivityEntry,
  AgentEmployee,
} from "@/definition/AgentEmployee";
import type { AgentEmployeeDetailData } from "@/definition/AgentEmployeePage";

/** A stored agent with a model, documents, a memory and a cost state. */
export function syntheticAgent(
  overrides: Partial<AgentEmployee> = {},
): AgentEmployee {
  return {
    id: "agent-1",
    username: "ada",
    displayName: "Ada Agent",
    position: "Coder",
    avatarColor: null,
    avatarImageUrl: null,
    isActive: true,
    modelName: "Model One",
    provider: "acp",
    roleId: "role-1",
    roleName: "Member",
    departmentIds: [],
    settings: {
      connectionId: "connection-1",
      model: "model-one",
      reasoningEffort: null,
      access: "read_only",
    },
    documents: { soul: "Calm soul", instructions: "" },
    memory: "Fact one",
    memoryUsage: { coreWords: 2, archiveWords: 0 },
    learning: {
      isEnabled: true,
      intervalHours: 12,
      lastRunAt: null,
      nextRunAt: null,
      lastResult: null,
    },
    cost: { spent: 1.5, unknownSessions: 0, month: "2026-11" },
    revision: 3,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
    ...overrides,
  };
}

/** The answer of the agent endpoint for the synthetic agent. */
export function syntheticDetail(
  overrides: Partial<AgentEmployeeDetailData> = {},
): AgentEmployeeDetailData {
  return {
    agent: syntheticAgent(),
    memoryDetails: { archive: [], versions: [] },
    activity: [],
    canEdit: true,
    canChangeAccess: false,
    accessEnvironment: { isIsolationAvailable: true, mcpServers: [] },
    ...overrides,
  };
}

/** One activity line without link and cost. */
export function activityEntry(
  overrides: Partial<AgentActivityEntry> = {},
): AgentActivityEntry {
  return {
    id: "entry-1",
    kind: "session",
    at: "2026-11-02T10:00:00.000Z",
    detail: "{}",
    link: null,
    cost: { state: "none", amount: null, isEstimated: false },
    ...overrides,
  };
}

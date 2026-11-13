import { vi } from "vitest";

import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import { AgentCheckRepository } from "@/backend/database/repositories/agent/AgentCheckRepository";
import { AgentConnectionScopeRepository } from "@/backend/database/repositories/agent/AgentConnectionScopeRepository";
import { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import { bareInstance } from "../tasks/bare-instance";
import { ASSIGNMENT } from "../chat/page48-chat-fixture";

import type { AccountAccess } from "@/definition/Authorization";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

export const ACTOR: AccountAccess = {
  userId: "admin",
  isActive: true,
  isAdmin: true,
  mode: "admin",
  firstName: "Admin",
  lastName: "",
  role: null,
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};
export const ZEN: AgentCatalogModel = {
  id: "opencode/free",
  name: "Free Zen",
  isFree: true,
  contextWindow: null,
  promptPrice: "0",
  completionPrice: "0",
  reasoning: "none",
  reasoningEfforts: [],
  defaultReasoningEffort: null,
  isToolCapable: true,
};

/** Repository boundaries only: model listing, resolution and consumer validation stay real. */
export function modelWorld(): {
  readonly connections: AgentConnectionRepository;
  readonly models: AgentEmployeeModels;
} {
  const connections = bareInstance(AgentConnectionRepository.prototype);
  const catalogs = bareInstance(AgentCatalogRepository.prototype);
  const checks = bareInstance(AgentCheckRepository.prototype);
  const scopes = bareInstance(AgentConnectionScopeRepository.prototype);
  const openCode = {
    ...ASSIGNMENT.connection,
    provider: "opencode" as const,
    cliLoggedInAt: "today",
    hasApiKey: false,
  };
  const api = { ...ASSIGNMENT.connection, id: "api" };
  vi.spyOn(connections, "list").mockResolvedValue([openCode, api]);
  vi.spyOn(connections, "find").mockImplementation(
    async (id) => [openCode, api].find((entry) => entry.id === id) ?? null,
  );
  vi.spyOn(connections, "catalogs").mockReturnValue(catalogs);
  vi.spyOn(connections, "checks").mockReturnValue(checks);
  vi.spyOn(connections, "scopes").mockReturnValue(scopes);
  vi.spyOn(catalogs, "find").mockResolvedValue({
    ...emptyModelCatalog(),
    models: [ZEN],
  });
  vi.spyOn(checks, "find").mockResolvedValue({
    status: "passed",
    checkedAt: "today",
    durationMs: 0,
    errorCode: null,
    detail: {},
  });
  vi.spyOn(scopes, "find").mockResolvedValue(GLOBAL_CONNECTION_SCOPE);
  const models = new AgentEmployeeModels({
    connections,
    authorization: {
      snapshot: async () => ({ accounts: [ACTOR], roles: [], departments: [] }),
    },
    groups: { findIdsByMember: async () => [] },
  });
  return { connections, models };
}

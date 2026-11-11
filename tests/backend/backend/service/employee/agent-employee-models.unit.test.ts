import { beforeEach, expect, it, vi } from "vitest";

import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";

import type { AgentEmployeeModelDependencies } from "@/backend/service/employee/AgentEmployeeModels";
import type { Mock } from "vitest";

vi.mock("@/backend/service/agents/AgentAssignmentResolution", () => ({
  resolveAgentAssignment: vi.fn(),
  resolveAgentAssignmentFor: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentConnectionModels", () => ({
  connectionModels: vi.fn(),
}));

import {
  resolveAgentAssignment,
  resolveAgentAssignmentFor,
} from "@/backend/service/agents/AgentAssignmentResolution";
import { connectionModels } from "@/backend/service/agents/AgentConnectionModels";

const settings = {
  connectionId: "connection",
  model: "model",
  reasoningEffort: null,
  access: "read_only",
} as const;

function fixture(): {
  service: AgentEmployeeModels;
  connections: { find: Mock };
  authorization: { snapshot: Mock };
  catalog: { models: { id: string; name: string; isToolCapable: boolean }[] };
} {
  const catalog = {
    models: [{ id: "model", name: "Model", isToolCapable: true }],
  };
  const connections = {
    find: vi
      .fn()
      .mockResolvedValue({ id: "connection", provider: "claude_code" }),
    catalogs: () => ({ find: vi.fn().mockResolvedValue(catalog) }),
  };
  const authorization = {
    snapshot: vi
      .fn()
      .mockResolvedValue({ accounts: [{ userId: "user", isActive: true }] }),
  };
  const groups = { findIdsByMember: vi.fn().mockResolvedValue(["group"]) };
  const dependencies = { connections, authorization, groups };
  return {
    service: new AgentEmployeeModels(
      dependencies as unknown as AgentEmployeeModelDependencies,
    ),
    connections,
    authorization,
    catalog,
  };
}

beforeEach(() => vi.resetAllMocks());

it("describes known and missing connections and catalog models", async () => {
  const { service, connections, catalog } = fixture();
  await expect(service.describe(settings)).resolves.toEqual({
    modelName: "Model",
    provider: "claude_code",
  });
  catalog.models.length = 0;
  await expect(service.describe(settings)).resolves.toEqual({
    modelName: "model",
    provider: "claude_code",
  });
  connections.find.mockResolvedValueOnce(null);
  await expect(service.describe(settings)).resolves.toEqual({
    modelName: "model",
    provider: null,
  });
});

it("translates assignment failures while preserving unexpected errors", async () => {
  const { service } = fixture();
  vi.mocked(resolveAgentAssignmentFor).mockRejectedValueOnce(
    new AgentExecutionError("accessDenied"),
  );
  await expect(service.requireAllowed("user", settings)).rejects.toMatchObject({
    code: "modelNotAllowed",
  });
  vi.mocked(resolveAgentAssignment).mockRejectedValueOnce(
    new AgentExecutionError("modelUnavailable"),
  );
  await expect(service.resolve(settings)).rejects.toMatchObject({
    code: "unavailable",
  });
  const failure = new Error("unexpected");
  vi.mocked(resolveAgentAssignment).mockRejectedValueOnce(failure);
  await expect(service.resolve(settings)).rejects.toBe(failure);
});

it("rejects inactive viewers before requesting their model choices", async () => {
  const { service, authorization } = fixture();
  authorization.snapshot.mockResolvedValueOnce({ accounts: [] });
  await expect(service.models("user")).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(connectionModels).not.toHaveBeenCalled();
});

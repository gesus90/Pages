import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentAssignmentTargetService } from "@/backend/service/agents/AgentAssignmentTargetService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type * as ReadContext from "@/backend/service/agents/AgentReadContext";
import type { AgentReadDependencies } from "@/backend/service/agents/AgentReadContext";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const mocks = vi.hoisted(() => ({ context: vi.fn(), directory: vi.fn() }));
vi.mock("@/backend/service/agents/AgentReadContext", async (original) => ({
  ...(await original<typeof ReadContext>()),
  createAgentReadContext: mocks.context,
}));
vi.mock("@/backend/service/agents/AgentDirectoryService", () => ({
  readAgentDirectory: mocks.directory,
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const identity = partial<AgentIdentity>({ userId: "u" });
const eligible = vi.fn();
const departments = vi.fn();

beforeEach(() => {
  mocks.context.mockResolvedValue({
    actor: { id: "u" },
    tasks: { findEligibleAssignees: eligible, departmentChoices: departments },
  });
  mocks.directory.mockResolvedValue({
    people: [
      { id: "p1", displayName: "Ada", departments: [], groups: [] },
      { id: "p2", displayName: "Adam", departments: [], groups: [] },
    ],
    groups: [{ id: "g", name: "Ada", memberIds: [] }],
    departments: [
      { id: "d", name: "Ada" },
      { id: "hidden", name: "Ada" },
    ],
  });
  eligible.mockResolvedValue([{ id: "p1" }]);
  departments.mockResolvedValue({ available: [{ id: "d" }] });
});

describe("assignment target search", () => {
  it("filters visible targets by name and project eligibility", async () => {
    const service = new AgentAssignmentTargetService(
      partial<AgentReadDependencies>({}),
    );
    const response = await service.search(identity, {
      text: "Ada",
      projectId: "project",
    });
    expect(response.result).toMatchObject({
      total: 3,
      targets: [
        { targetType: "department", id: "d", isExactMatch: true },
        { targetType: "group", id: "g", isExactMatch: true },
        { targetType: "person", id: "p1", isExactMatch: true },
      ],
    });
    expect(eligible).toHaveBeenCalledOnce();
  });

  it("narrows by type, handles no text and validates the input", async () => {
    const service = new AgentAssignmentTargetService(
      partial<AgentReadDependencies>({}),
    );
    const response = await service.search(identity, { targetType: "person" });
    expect(response.result).toMatchObject({
      total: 2,
      targets: [
        { id: "p1", isExactMatch: false },
        { id: "p2", isExactMatch: false },
      ],
    });
    await expect(
      service.search(identity, { targetType: "invalid" }),
    ).rejects.toThrow();
  });
});

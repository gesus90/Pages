import { expect, it, vi } from "vitest";

import { AgentAvailabilityService } from "@/backend/service/agents/AgentAvailabilityService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { ProfileDependencies } from "@/backend/service/agents/AgentProfileService";
import type { AgentProfile } from "@/definition/AgentProfile";

const PROFILE = partial<AgentProfile>({
  id: "profile",
  name: "Agent",
  model: "model",
  connectionId: "connection",
  purposes: ["agent"],
  isActive: false,
  targets: [{ kind: "person", targetId: "user" }],
  configuration: {
    accessMode: "personal",
    projectId: null,
    sharing: { isGlobal: true },
    markdown: "",
    parameters: [],
    directoryParameter: null,
  },
});

it("lists a shared but inactive agent as unavailable", async () => {
  const dependencies = partial<ProfileDependencies>({
    authorization: {
      snapshot: async () => ({
        accounts: [{ userId: "user", isActive: true, departments: [] }],
      }),
    },
    profiles: { list: async () => [PROFILE] },
    groups: { findIdsByMember: async () => [] },
    connections: { find: async () => ({ provider: "codex_cli" }) },
  });
  const service = new AgentAvailabilityService(dependencies);
  await expect(service.catalog("user")).resolves.toMatchObject([
    {
      id: "profile",
      availability: { isUsable: false, reason: "agent_inactive" },
    },
  ]);
  await expect(service.isVisible("user", "profile")).resolves.toBe(true);
  await expect(service.isVisible("user", "missing")).resolves.toBe(false);
});

it("rejects inactive accounts and inaccessible project contexts", async () => {
  const canReadProject = vi.fn(async () => false);
  const dependencies = partial<ProfileDependencies>({
    authorization: {
      snapshot: async () => ({
        accounts: [{ userId: "user", isActive: true }],
      }),
    },
    profiles: { list: async () => [] },
    groups: { findIdsByMember: async () => [] },
    content: { canReadProject },
  });
  const service = new AgentAvailabilityService(dependencies);
  await expect(service.catalog("missing")).rejects.toMatchObject({
    code: "accessDenied",
  });
  await expect(service.catalog("user", "project")).rejects.toMatchObject({
    code: "agent_usage_denied",
  });
  expect(canReadProject).toHaveBeenCalledOnce();
});

it("reauthorizes a legacy selection before consulting model connections", async () => {
  const find = vi.fn();
  const dependencies = partial<ProfileDependencies>({
    authorization: {
      snapshot: async () => ({
        accounts: [{ userId: "user", isActive: true, departments: [] }],
      }),
    },
    profiles: { list: async () => [PROFILE] },
    groups: { findIdsByMember: async () => [] },
    connections: { find },
  });
  const service = new AgentAvailabilityService(dependencies);
  await expect(
    service.resolve("user", {
      agentId: "profile",
      personalAgentId: null,
      projectId: null,
    }),
  ).rejects.toMatchObject({ code: "agent_inactive" });
  await expect(
    service.resolve("user", {
      agentId: "missing",
      personalAgentId: null,
      projectId: null,
    }),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
  expect(find).not.toHaveBeenCalled();
});

it("limits administrative inspection to administrators", async () => {
  const dependencies = partial<ProfileDependencies>({
    authorization: {
      snapshot: async () => ({
        accounts: [{ userId: "user", isActive: true, isAdmin: false }],
      }),
    },
    profiles: { list: async () => [] },
    groups: { findIdsByMember: async () => [] },
  });
  const service = new AgentAvailabilityService(dependencies);
  await expect(service.inspect("user")).rejects.toMatchObject({
    code: "accessDenied",
  });
});

it("hides project agents outside their project or without project access", async () => {
  const profile = {
    ...PROFILE,
    configuration: { ...PROFILE.configuration, projectId: "project" },
  };
  const canReadProject = vi.fn(async () => true);
  const service = new AgentAvailabilityService(
    partial<ProfileDependencies>({
      authorization: {
        snapshot: async () => ({
          accounts: [{ userId: "user", isActive: true, departments: [] }],
        }),
      },
      profiles: { list: async () => [profile] },
      groups: { findIdsByMember: async () => [] },
      content: { canReadProject },
      connections: { find: async () => ({ provider: "codex_cli" }) },
    }),
  );
  await expect(service.isVisible("user", "profile")).resolves.toBe(true);
  canReadProject.mockResolvedValue(false);
  await expect(service.isVisible("user", "profile")).resolves.toBe(false);
});

it("excludes agents with no agent purpose and refuses their selection", async () => {
  const profile = { ...PROFILE, purposes: ["chat" as const], isActive: true };
  const service = new AgentAvailabilityService(
    partial<ProfileDependencies>({
      authorization: {
        snapshot: async () => ({
          accounts: [{ userId: "user", isActive: true, departments: [] }],
        }),
      },
      profiles: { list: async () => [profile] },
      groups: { findIdsByMember: async () => [] },
    }),
  );
  await expect(service.catalog("user")).resolves.toEqual([]);
  await expect(
    service.resolve("user", {
      agentId: "profile",
      personalAgentId: null,
      projectId: null,
    }),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
});

it("reports missing personal access for an otherwise visible agent", async () => {
  const profile = { ...PROFILE, isActive: true };
  const service = new AgentAvailabilityService(
    partial<ProfileDependencies>({
      authorization: {
        snapshot: async () => ({
          accounts: [{ userId: "user", isActive: true, departments: [] }],
        }),
      },
      profiles: { list: async () => [profile] },
      groups: { findIdsByMember: async () => [] },
      connections: { find: async () => null },
    }),
  );
  await expect(service.catalog("user")).resolves.toMatchObject([
    { availability: { isUsable: false, reason: "personal_access_missing" } },
  ]);
  await expect(
    service.resolve("user", {
      agentId: "profile",
      personalAgentId: null,
      projectId: null,
    }),
  ).rejects.toMatchObject({ code: "personal_access_missing" });
});

import { expect, it, vi } from "vitest";

import {
  requirePlanModelResources,
  resolvePlanModel,
} from "@/backend/service/agents/AgentPlanModel";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type {
  AgentProfileService,
  ProfileDependencies,
} from "@/backend/service/agents/AgentProfileService";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";

it("rechecks every model connection and visible agent before disclosing results", async () => {
  const requireConnection = vi.fn(async () => {});
  const isVisible = vi.fn(
    async (user: string, id: string) => user === "user" && id === "allowed",
  );
  const profiles = partial<AgentProfileService>({
    requireConnection,
    isVisible,
  });
  const resources = partial<AgentPlanRunResources>({
    connectionIds: ["connection"],
    agentIds: ["allowed", "denied"],
  });
  await expect(
    requirePlanModelResources(profiles, "user", resources),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  expect(requireConnection).toHaveBeenCalledWith("user", "connection");
});

it("rejects missing model assignments and unshared model profiles", async () => {
  const dependencies = partial<ProfileDependencies>({});
  const viewer = partial<AgentViewer>({
    actor: { userId: "user" },
    groupIds: [],
  });
  await expect(
    resolvePlanModel(
      dependencies,
      viewer,
      partial<AgentPlanConfiguration>({ modelProfileId: "" }),
      { profiles: [], projectId: null },
    ),
  ).rejects.toMatchObject({ code: "model_assignment_missing" });
  await expect(
    resolvePlanModel(
      dependencies,
      viewer,
      partial<AgentPlanConfiguration>({ modelProfileId: "missing" }),
      { profiles: [], projectId: null },
    ),
  ).rejects.toMatchObject({ code: "agent_usage_denied" });
});

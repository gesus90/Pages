import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanGitHubCredentials } from "@/backend/service/agents/AgentPlanGitHubCredentials";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";

const WORKSPACE = partial<ResolvedAgentWorkspace>({
  id: "workspace",
  projectId: "project",
  path: "/work",
  directoryIdentity: "identity",
  github: { repoUrl: "https://github.com/example/repo" },
});

it("requires current project management before reading credentials", async () => {
  const findTokenEncrypted = vi.fn();
  const service = new AgentPlanGitHubCredentials(
    partial({
      workspaces: {
        resolve: async () => WORKSPACE,
        requireManagement: async () => {
          throw new AgentError("workspace_management_denied");
        },
      },
      projects: { findTokenEncrypted },
    }),
  );
  await expect(service.resolve("user", WORKSPACE)).resolves.toEqual({
    status: "unavailable",
    reason: "project write access required",
  });
  expect(findTokenEncrypted).not.toHaveBeenCalled();
});

it("refuses a changed workspace and reports missing configured token", async () => {
  const workspaces = {
    resolve: async () => WORKSPACE,
    requireManagement: async () => {},
  };
  const service = new AgentPlanGitHubCredentials(
    partial({
      workspaces,
      projects: {
        findIntegration: async () => ({ repoUrl: WORKSPACE.github?.repoUrl }),
        findTokenEncrypted: async () => null,
      },
    }),
  );
  await expect(
    service.resolve("user", { ...WORKSPACE, path: "/changed" }),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
  await expect(service.resolve("user", WORKSPACE)).resolves.toEqual({
    status: "unavailable",
    reason: "project GitHub token not configured",
  });
  await expect(
    service.resolveBridge("user", WORKSPACE, {
      planId: "plan",
      stepId: "step",
    }),
  ).resolves.toBeNull();
});

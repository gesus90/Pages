import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanWorkspaces } from "@/backend/service/agents/AgentPlanWorkspaces";

import { partial } from "../../../app/lib/service-wiring-fakes";

const choices = vi.fn();
const list = vi.fn();
const resolve = vi.fn();
const requireConsole = vi.fn();
const registeredIds = vi.fn();
const requireProjectAccess = vi.fn();
const service = new AgentPlanWorkspaces(
  partial<ConstructorParameters<typeof AgentPlanWorkspaces>[0]>({
    local: { choices, resolve, requireProjectAccess },
    remote: { list, requireConsole },
    registrations: { registeredIds },
    projects: {},
  }),
);
const local = { id: "local", kind: "local", projectId: "project" };
const remote = {
  id: "remote",
  name: "Remote",
  path: "/workspace",
  projectId: "project",
  projectName: "Project",
  github: null,
  canOpenConsole: true,
  isUsable: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  choices.mockResolvedValue([local]);
  list.mockResolvedValue([
    remote,
    { ...remote, id: "hidden", canOpenConsole: false },
  ]);
  resolve.mockResolvedValue({ projectId: "project" });
  registeredIds.mockResolvedValue(new Set());
});

it("lists only accessible remote workspaces and resolves local and remote contexts", async () => {
  expect(await service.choices("user")).toMatchObject([
    { id: "local" },
    { id: "remote", kind: "remote", reason: null },
  ]);
  expect(await service.resolve("user", { workspaceId: "local" })).toEqual({
    projectId: "project",
  });
  expect(await service.resolve("user", { workspaceId: "remote" })).toEqual({
    projectId: "project",
    executionTarget: { kind: "remote", workspaceId: "remote" },
  });
  expect(requireConsole).toHaveBeenCalledWith("user", "remote");
});

it("rejects changed or unusable remote targets", async () => {
  await expect(
    service.resolve("user", { workspaceId: "missing" }),
  ).rejects.toThrow();
  await expect(
    service.resolve("user", {
      workspaceId: "remote",
      executionTarget: { kind: "remote", workspaceId: "other" },
    }),
  ).rejects.toThrow();
  list.mockResolvedValue([{ ...remote, isUsable: false }]);
  await expect(
    service.resolve("user", { workspaceId: "remote" }),
  ).rejects.toThrow();
});

it("distinguishes hidden registrations from removed ones during history access", async () => {
  await service.requireAccess("user", "local", "project");
  registeredIds.mockResolvedValueOnce(new Set(["hidden"]));
  await expect(
    service.requireAccess("user", "hidden", "project"),
  ).rejects.toThrow();
  await service.requireAccess("user", "removed", "project");
  expect(requireProjectAccess).toHaveBeenCalledWith("user", "project");
});

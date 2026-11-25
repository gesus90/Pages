import { expect, it, vi } from "vitest";

import { WikiChoiceService } from "./WikiChoiceService";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAccess } from "./WikiAccess";

const actor = { id: "u" } as unknown as User;

interface Options {
  readonly canWrite?: boolean;
  readonly isAdmin?: boolean;
  readonly page?: { ownerId: string; projectId: string | null; scope: string };
}

function setup(options: Options = {}): {
  readonly service: WikiChoiceService;
  readonly listMilestones: ReturnType<typeof vi.fn>;
} {
  const listMilestones = vi.fn(async () => [{ id: "m" }]);
  const repository = {
    anchors: {
      findAnchors: vi.fn(async () => [
        { kind: "epic", label: "E", targetId: "e1" },
      ]),
    },
    lookups: {
      listActiveUsers: vi.fn(async () => [{ id: "u" }]),
      listDepartments: vi.fn(async () => [{ id: "d1" }, { id: "d2" }]),
      listEpics: vi.fn(async () => [
        { departmentIds: [], id: "e1" },
        { departmentIds: ["d1"], id: "e2" },
        { departmentIds: ["d9"], id: "e3" },
      ]),
      listMilestones,
    },
    pages: {
      findVisible: vi.fn(async () => ({
        id: "page",
        ownerId: "u",
        projectId: null,
        scope: "instance",
        ...options.page,
      })),
    },
  } as unknown as WikiRepository;
  const access = {
    resolve: vi.fn(async () => ({
      canManageProjects: false,
      canWrite: options.canWrite ?? true,
      scope: {
        departmentIds: ["d1"],
        isAdmin: options.isAdmin ?? false,
        projectIds: ["p1", "p2"],
        userId: "u",
      },
    })),
  } as unknown as WikiAccess;

  return { listMilestones, service: new WikiChoiceService(repository, access) };
}

it("lists the choices the viewer can read", async () => {
  const { listMilestones, service } = setup();

  await expect(service.anchorChoices(actor, "page")).resolves.toEqual({
    departments: [{ id: "d1" }],
    epics: [
      { departmentIds: [], id: "e1" },
      { departmentIds: ["d1"], id: "e2" },
    ],
    milestones: [{ id: "m" }],
    selected: [{ kind: "epic", targetId: "e1" }],
  });
  expect(listMilestones).toHaveBeenCalledWith(["p1", "p2"]);
});

it("lists everything for an administrator and limits a project page", async () => {
  const { listMilestones, service } = setup({
    isAdmin: true,
    page: { ownerId: "u", projectId: "p2", scope: "project" },
  });
  const choices = await service.anchorChoices(actor, "page");

  expect(choices.departments).toHaveLength(2);
  expect(choices.epics).toHaveLength(3);
  expect(listMilestones).toHaveBeenCalledWith(["p2"]);
});

it("offers nothing on a private page", async () => {
  const { service } = setup({
    page: { ownerId: "u", projectId: null, scope: "private" },
  });

  await expect(service.anchorChoices(actor, "page")).resolves.toEqual({
    departments: [],
    epics: [],
    milestones: [],
    selected: [{ kind: "epic", targetId: "e1" }],
  });
});

it("offers nothing to someone who does not manage the page", async () => {
  const { service } = setup({
    page: { ownerId: "other", projectId: null, scope: "instance" },
  });

  await expect(service.anchorChoices(actor, "page")).resolves.toMatchObject({
    departments: [],
  });
});

it("lists the owner candidates for a writer only", async () => {
  await expect(setup().service.ownerCandidates(actor)).resolves.toEqual([
    { id: "u" },
  ]);
  await expect(
    setup({ canWrite: false }).service.ownerCandidates(actor),
  ).resolves.toEqual([]);
});

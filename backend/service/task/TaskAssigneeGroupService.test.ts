import { expect, it, vi } from "vitest";

import { TaskAssigneeGroupService } from "./TaskAssigneeGroupService";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { User } from "@/definition/User";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

const actor = doubleOf<User>({ id: "u1" });

function setup(): {
  readonly service: TaskAssigneeGroupService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly authorizationFacts: ReturnType<typeof vi.fn>;
} {
  const repository = {
    findAssigneeGroups: vi.fn(async () => [{ id: "g1" }]),
    findAssigneeGroupsWithMembers: vi.fn(async () => [
      { id: "g1", memberIds: ["a"] },
      { id: "g2", memberIds: ["z"] },
    ]),
    findGroupIdsByMember: vi.fn(async () => ["g1"]),
  };
  const authorizationFacts = vi.fn(async () => ({}));
  const service = new TaskAssigneeGroupService(
    doubleOf<TaskRepository>(repository),
    doubleOf<TaskAccessGuard>({ authorizationFacts }),
  );

  return { authorizationFacts, repository, service };
}

it("lists the groups after authorizing the actor", async () => {
  const { authorizationFacts, service } = setup();

  await expect(service.findGroups(actor)).resolves.toEqual([{ id: "g1" }]);
  expect(authorizationFacts).toHaveBeenCalledWith(actor);
});

it("lists the group ids with a member per project", async () => {
  const { service } = setup();

  await expect(
    service.findGroupIdsByProject(actor, {
      p1: [doubleOf<User>({ id: "a" })],
      p2: [],
    }),
  ).resolves.toEqual({ p1: ["g1"], p2: [] });
});

it("lists the groups of the actor", async () => {
  const { repository, service } = setup();

  await expect(service.findMemberGroupIds(actor)).resolves.toEqual(["g1"]);
  expect(repository.findGroupIdsByMember).toHaveBeenCalledWith("u1");
});

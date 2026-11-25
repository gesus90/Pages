import { expect, it, vi } from "vitest";

import {
  WorkItemHierarchyError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import { WorkItemReferenceValidator } from "./WorkItemReferenceValidator";

import type { WorkItemReferences } from "./WorkItemReferenceValidator";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "./TaskAccessGuard";

interface Facts {
  readonly parent?: object | null;
  readonly milestone?: object | null;
  readonly group?: object | null;
  readonly eligible?: readonly string[];
}

function doubleOf<Type extends object>(members: object): Type {
  return members as Type;
}

function setup(facts: Facts = {}): {
  readonly validator: WorkItemReferenceValidator;
  readonly findById: ReturnType<typeof vi.fn>;
} {
  const findById = vi.fn(async () =>
    facts.parent === undefined ? activeEpic() : facts.parent,
  );
  const repository = doubleOf<TaskRepository>({
    findAssigneeGroupById: vi.fn(async () =>
      facts.group === undefined ? { memberCount: 2 } : facts.group,
    ),
    findById,
    findEligibleAssignees: vi.fn(async () => []),
    findMilestoneById: vi.fn(async () =>
      facts.milestone === undefined ? { projectId: "p" } : facts.milestone,
    ),
  });
  const access = doubleOf<TaskAccessGuard>({
    filterAssignees: vi.fn(async (input: Map<string, unknown>) => {
      const key = [...input.keys()][0] ?? "";
      const ids = facts.eligible ?? ["u1"];
      return new Map(key === "none" ? [] : [[key, ids.map((id) => ({ id }))]]);
    }),
  });

  return {
    findById,
    validator: new WorkItemReferenceValidator(repository, access),
  };
}

function activeEpic(): object {
  return { archivedAt: null, projectId: "p", type: "epic" };
}

function references(
  patch: Partial<WorkItemReferences> = {},
): WorkItemReferences {
  return {
    assigneeGroupId: null,
    assigneeId: null,
    milestoneId: null,
    parentId: null,
    projectId: "p",
    selfId: null,
    type: "task",
    ...patch,
  };
}

it("accepts references without parent, milestone or assignment", async () => {
  const { validator } = setup();

  await expect(
    validator.validateReferences(references()),
  ).resolves.toBeUndefined();
});

it("accepts a valid parent, milestone and assignee", async () => {
  const { validator } = setup();

  await expect(
    validator.validateReferences(
      references({ assigneeId: "u1", milestoneId: "m", parentId: "e" }),
    ),
  ).resolves.toBeUndefined();
});

it("skips the lookup of a preserved parent", async () => {
  const { findById, validator } = setup();

  await validator.validateHierarchy(
    references({ parentId: "e", preservedParentId: "e" }),
  );

  expect(findById).not.toHaveBeenCalled();
});

it("lets an unchanged stored parent stay archived", async () => {
  const { validator } = setup({ parent: { ...activeEpic(), archivedAt: "x" } });

  await expect(
    validator.validateHierarchy(
      references({ parentId: "e", storedParentId: "e" }),
    ),
  ).resolves.toBeUndefined();
});

it("rejects a newly chosen archived parent", async () => {
  const { validator } = setup({ parent: { ...activeEpic(), archivedAt: "x" } });

  await expect(
    validator.validateHierarchy(references({ parentId: "e" })),
  ).rejects.toThrow(WorkItemHierarchyError);
});

it("rejects a missing parent", async () => {
  const { validator } = setup({ parent: null });

  await expect(
    validator.validateHierarchy(references({ parentId: "e" })),
  ).rejects.toThrow(WorkItemHierarchyError);
});

it("rejects an unknown milestone", async () => {
  const { validator } = setup({ milestone: null });

  await expect(
    validator.validateReferences(references({ milestoneId: "m" })),
  ).rejects.toMatchObject({ code: "milestoneNotFound" });
});

it("rejects a milestone of another project", async () => {
  const { validator } = setup({ milestone: { projectId: "other" } });

  await expect(
    validator.validateReferences(references({ milestoneId: "m" })),
  ).rejects.toMatchObject({ code: "milestoneOtherProject" });
});

it("rejects an assignee together with a group", async () => {
  const { validator } = setup();

  await expect(
    validator.validateReferences(
      references({ assigneeGroupId: "g", assigneeId: "u1" }),
    ),
  ).rejects.toMatchObject({ code: "assigneeAndGroup" });
});

it("rejects an assignee without project access", async () => {
  const { validator } = setup();

  await expect(validator.validateAssignee("x", "p")).rejects.toThrow(
    WorkItemValidationError,
  );
  await expect(validator.isEligibleAssignee("u1", "p")).resolves.toBe(true);
});

it("treats a project without eligible entry as no access", async () => {
  const { validator } = setup();

  await expect(validator.isEligibleAssignee("u1", "none")).resolves.toBe(false);
});

it("accepts a group with members", async () => {
  const { validator } = setup();

  await expect(
    validator.validateReferences(references({ assigneeGroupId: "g" })),
  ).resolves.toBeUndefined();
});

it("skips the check of a preserved group", async () => {
  const { validator } = setup({ group: null });

  await expect(
    validator.validateReferences(
      references({ assigneeGroupId: "g", preservedGroupId: "g" }),
    ),
  ).resolves.toBeUndefined();
});

it("rejects an unknown group", async () => {
  const { validator } = setup({ group: null });

  await expect(
    validator.validateReferences(references({ assigneeGroupId: "g" })),
  ).rejects.toMatchObject({ code: "groupNotFound" });
});

it("rejects an empty group", async () => {
  const { validator } = setup({ group: { memberCount: 0 } });

  await expect(
    validator.validateReferences(references({ assigneeGroupId: "g" })),
  ).rejects.toMatchObject({ code: "groupEmpty" });
});

import { expect, it } from "vitest";

import {
  assertParentActive,
  assertParentFits,
  selectParentLookup,
} from "./WorkItemHierarchy";

import { WorkItemHierarchyError } from "@/backend/error/WorkItemErrors";

import type { ParentRule } from "./WorkItemHierarchy";
import type { WorkItemDetail } from "@/definition/Task";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

function codeOf(work: () => unknown): string | undefined {
  try {
    work();
  } catch (error) {
    return error instanceof WorkItemHierarchyError ? error.code : undefined;
  }

  return undefined;
}

it("rejects a parent for an initiative and accepts none", () => {
  expect(codeOf(() => selectParentLookup("initiative", "p", null))).toBe(
    "initiativeNoParent",
  );
  expect(selectParentLookup("initiative", null, null)).toBeNull();
});

it("requires a parent for a subtask only", () => {
  expect(codeOf(() => selectParentLookup("subtask", null, null))).toBe(
    "subtaskParentRequired",
  );
  expect(selectParentLookup("task", null, null)).toBeNull();
});

it("rejects a work item as its own parent", () => {
  expect(codeOf(() => selectParentLookup("epic", "a", "a"))).toBe(
    "epicSelfParent",
  );
});

it("selects the rule for a parent to look up", () => {
  const lookup = selectParentLookup("task", "e1", "t1");

  expect(lookup?.parentId).toBe("e1");
  expect(lookup?.rule.parentType).toBe("epic");
  expect(selectParentLookup("task", "e1", null)?.parentId).toBe("e1");
});

const rule: ParentRule = {
  missingCode: "epicMissing",
  parentType: "epic",
  projectCode: "epicOtherProject",
  requiredCode: null,
  selfCode: "taskSelfParent",
  typeCode: "taskParentType",
};

it("checks the stored parent against the rule", () => {
  const parent = doubleOf<WorkItemDetail>({ projectId: "p", type: "epic" });

  expect(codeOf(() => assertParentFits(null, rule, "p"))).toBe("epicMissing");
  expect(
    codeOf(() => assertParentFits({ ...parent, type: "task" }, rule, "p")),
  ).toBe("taskParentType");
  expect(codeOf(() => assertParentFits(parent, rule, "other"))).toBe(
    "epicOtherProject",
  );
  expect(codeOf(() => assertParentFits(parent, rule, "p"))).toBeUndefined();
});

it("rejects an archived parent", () => {
  expect(
    codeOf(() =>
      assertParentActive(doubleOf<WorkItemDetail>({ archivedAt: "x" })),
    ),
  ).toBe("parentArchived");
  expect(
    codeOf(() =>
      assertParentActive(doubleOf<WorkItemDetail>({ archivedAt: null })),
    ),
  ).toBeUndefined();
});

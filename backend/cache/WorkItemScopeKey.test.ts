import { expect, it } from "vitest";

import { workItemScopeKey } from "./WorkItemScopeKey";

it("normalizes scope without conflating unrestricted and empty scopes", () => {
  const scope = { departmentIds: ["b", "a", "a"], projectIds: ["p", "p"] };
  const normalized = { departmentIds: ["a", "b"], projectIds: ["p"] };
  expect(workItemScopeKey("actor", scope)).toBe(
    workItemScopeKey("actor", normalized),
  );
  expect(scope.departmentIds).toEqual(["b", "a", "a"]);
  expect(workItemScopeKey("actor", { departmentIds: null })).not.toBe(
    workItemScopeKey("actor", { departmentIds: [], projectIds: [] }),
  );
  expect(workItemScopeKey("other", normalized)).not.toBe(
    workItemScopeKey("actor", normalized),
  );
});

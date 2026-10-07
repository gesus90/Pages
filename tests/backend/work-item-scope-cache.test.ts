import { describe, expect, it } from "vitest";

import { workItemScopeKey } from "@/backend/cache/WorkItemScopeKey";

describe("ticket scope cache isolation", () => {
  it("separates actors, public-only scope, administrator scope and ambiguous department IDs", () => {
    const scopes = [
      { departmentIds: null, projectIds: ["project"] },
      { departmentIds: [], projectIds: ["project"] },
      { departmentIds: ["a,b"], projectIds: ["project"] },
      { departmentIds: ["a", "b"], projectIds: ["project"] },
      { departmentIds: ["a", "b"], projectIds: [] },
      { departmentIds: ["a", "b"] },
    ];
    expect(
      new Set(scopes.map((scope) => workItemScopeKey("actor", scope))).size,
    ).toBe(scopes.length);
    expect(
      workItemScopeKey("actor", scopes[0] ?? { departmentIds: null }),
    ).not.toBe(
      workItemScopeKey("other", {
        departmentIds: null,
        projectIds: ["project"],
      }),
    );
  });

  it("reuses scopes when only order and duplicate assignments differ", () => {
    expect(
      workItemScopeKey("actor", {
        departmentIds: ["b", "a", "a"],
        projectIds: ["two", "one"],
      }),
    ).toBe(
      workItemScopeKey("actor", {
        departmentIds: ["a", "b"],
        projectIds: ["one", "two", "one"],
      }),
    );
  });
});

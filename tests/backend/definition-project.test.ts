import { describe, expect, it } from "vitest";

import { isProjectStatus, PROJECT_STATUS } from "@/definition/Project";

describe("project definitions", () => {
  it("exposes every supported project status", () => {
    expect(PROJECT_STATUS).toEqual({
      ACTIVE: "active",
      COMPLETED: "completed",
      PAUSED: "paused",
      PLANNED: "planned",
    });
  });
});

describe("isProjectStatus", () => {
  it.each(Object.values(PROJECT_STATUS))("accepts %s", (status) => {
    expect(isProjectStatus(status)).toBe(true);
  });

  it.each(["archived", "", "ACTIVE", null, undefined, 0, true, {}, []])(
    "rejects unsupported value %p",
    (value) => {
      expect(isProjectStatus(value)).toBe(false);
    },
  );
});

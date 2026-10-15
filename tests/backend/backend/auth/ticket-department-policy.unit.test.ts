import { describe, expect, it } from "vitest";

import { TicketDepartmentPolicy } from "@/backend/auth/TicketDepartmentPolicy";
import { CAPABILITY } from "@/definition/Authorization";

import { accountFixture, administratorFixture } from "./account-fixture";

const policy = new TicketDepartmentPolicy();

describe("ticket department selection", () => {
  it("allows an own department without a management capability", () => {
    const actor = accountFixture({ departments: ["sales"], permissions: [] });

    expect(policy.canSelect(actor, "sales")).toBe(true);
    expect(policy.canSelect(actor, "legal")).toBe(false);
  });

  it("requires project management for managed departments", () => {
    expect(
      policy.canSelect(
        accountFixture({
          managedDepartments: ["sales"],
          permissions: [CAPABILITY.MANAGE_PROJECTS],
        }),
        "sales",
      ),
    ).toBe(true);
    expect(
      policy.canSelect(
        accountFixture({
          managedDepartments: ["sales"],
          permissions: [],
        }),
        "sales",
      ),
    ).toBe(false);
  });

  it.each(["allProjects", "allDepartments"] as const)(
    "allows every department with %s only when management is granted",
    (scope) => {
      expect(
        policy.canSelect(
          accountFixture({
            [scope]: true,
            permissions: [CAPABILITY.MANAGE_PROJECTS],
          }),
          "legal",
        ),
      ).toBe(true);
      expect(
        policy.canSelect(
          accountFixture({
            [scope]: true,
            permissions: [],
          }),
          "legal",
        ),
      ).toBe(false);
    },
  );

  it("requires administrator mode for the administrator exception", () => {
    expect(policy.canSelect(administratorFixture(), "legal")).toBe(true);
    expect(
      policy.canSelect(administratorFixture({ mode: "role" }), "legal"),
    ).toBe(false);
  });

  it("rejects inactive members, managers and administrators", () => {
    const actors = [
      accountFixture({ departments: ["sales"], isActive: false }),
      accountFixture({
        permissions: [CAPABILITY.MANAGE_PROJECTS],
        allProjects: true,
        isActive: false,
      }),
      administratorFixture({ isActive: false }),
    ];

    for (const actor of actors)
      expect(policy.canSelect(actor, "sales")).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { CAPABILITY } from "@/definition/Authorization";
import { WorkItemAccessDeniedError } from "@/backend/error/WorkItemErrors";

import { ArchiveWorld } from "./archive-world";

let world = new ArchiveWorld();
beforeEach(() => {
  world = new ArchiveWorld();
});

describe.each(["ticket.delete", "milestone.delete"] as const)(
  "%s authorization",
  (operation) => {
    it.each(["admin", "manager"])(
      "allows %s with current archive rights",
      async (userId) => {
        await expect(world.call(userId, operation)).resolves.toMatchObject({
          affectedCount: 1,
          changed: true,
          disposition: "trash",
        });
        expect(world.activity).toHaveLength(1);
        expect(world.events).toHaveLength(1);
      },
    );

    it.each(["writer", "reader"])(
      "refuses %s without changing records or history",
      async (userId) => {
        const before = world.changes();
        await expect(world.call(userId, operation)).rejects.toMatchObject({
          code: "FORBIDDEN",
          status: 403,
        });
        expect(world.changes()).toEqual(before);
        expect(world.tickets.get("root")?.archivedAt).toBeNull();
        expect(world.milestones.get("milestone")?.archivedAt).toBeNull();
      },
    );

    it("does not require ordinary write rights in addition to the UI archive right", async () => {
      world.addPerson("manager", { capabilities: [CAPABILITY.MILESTONES] });
      await expect(world.call("manager", operation)).resolves.toMatchObject({
        affectedCount: 1,
      });
    });

    it("needs project responsibility even with the milestone capability", async () => {
      world.managers.delete("engineering:manager");
      await expect(world.call("manager", operation)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(world.keys.size).toBe(0);
      expect(world.activity).toHaveLength(0);
    });

    it("allows department-scoped co-owners in their managed project", async () => {
      world.addPerson("scoped", {
        capabilities: [CAPABILITY.MILESTONES, CAPABILITY.MANAGE_PROJECTS],
        managedDepartments: ["engineering"],
      });
      await expect(world.call("scoped", operation)).resolves.toMatchObject({
        affectedCount: 1,
      });
    });

    it("refuses management rights belonging to another department", async () => {
      world.addPerson("scoped", {
        capabilities: [CAPABILITY.MILESTONES, CAPABILITY.MANAGE_PROJECTS],
        managedDepartments: ["design"],
      });
      await expect(world.call("scoped", operation)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(world.keys.size).toBe(0);
    });

    it("allows explicit global project management with the milestone capability", async () => {
      world.addPerson("global", {
        capabilities: [CAPABILITY.MILESTONES, CAPABILITY.MANAGE_PROJECTS],
        allProjects: true,
      });
      await expect(world.call("global", operation)).resolves.toMatchObject({
        affectedCount: 1,
      });
    });

    it("does not reveal targets in hidden projects even to their project manager", async () => {
      world.addProject("engineering", ["design"]);
      await expect(world.call("manager", operation)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
      expect(world.keys.size).toBe(0);
      expect(world.activity).toHaveLength(0);
    });
  },
);

describe.each(["ticket.delete", "milestone.delete"] as const)(
  "%s UI and MCP policy parity",
  (operation) => {
    it("shares the UI decision for ordinary writers and authorized managers", async () => {
      for (const userId of ["writer", "reader", "manager"]) {
        const context = world.ui(userId);
        const canArchive = await context.tasks.canArchive(
          context.actor,
          "engineering",
        );
        expect(canArchive).toBe(userId === "manager");
        if (canArchive)
          await expect(world.call(userId, operation)).resolves.toMatchObject({
            changed: true,
          });
        else
          await expect(world.call(userId, operation)).rejects.toMatchObject({
            code: "FORBIDDEN",
          });
      }
    });

    it("preserves personal MCP admin eligibility without changing browser mode", async () => {
      const context = world.ui("admin");
      await expect(
        context.tasks.canArchive(context.actor, "engineering"),
      ).resolves.toBe(false);
      await expect(world.call("admin", operation)).resolves.toMatchObject({
        affectedCount: 1,
      });
      expect(world.accounts.get("admin")?.mode).toBe("role");
    });

    it("allows the same administrator in active UI administrator mode", async () => {
      world.addPerson("admin", {
        isAdmin: true,
        mode: "admin",
        capabilities: [],
      });
      const context = world.ui("admin");
      await expect(
        context.tasks.canArchive(context.actor, "engineering"),
      ).resolves.toBe(true);
      await expect(world.call("admin", operation)).resolves.toMatchObject({
        changed: true,
      });
    });

    it("ignores stale admin hints supplied with the identity", async () => {
      await expect(
        world.operations.handle(
          {
            userId: "reader",
            isAdmin: true,
            permissions: [CAPABILITY.MILESTONES],
          },
          operation,
          world.request(operation),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(world.keys.size).toBe(0);
    });

    it("refuses a direct UI service call by the same unauthorized writer", async () => {
      const context = world.ui("writer");
      const before = world.changes();
      const write =
        operation === "ticket.delete"
          ? context.tasks.archive(context.actor, "root")
          : context.tasks.archiveMilestone(context.actor, "milestone");
      await expect(write).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
      expect(world.changes()).toEqual(before);
    });
  },
);

it("hides a ticket outside the actor's own department like a nonexistent ticket", async () => {
  world.addTicket("root", { departmentId: "design" });
  const before = world.changes();
  await expect(world.call("manager", "ticket.delete")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    world.call("manager", "ticket.delete", {
      ...world.request("ticket.delete"),
      ticketId: "missing",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(world.changes()).toEqual(before);
});

it("allows public tickets within project responsibility", async () => {
  world.addTicket("root", { departmentId: null });
  await expect(world.call("manager", "ticket.delete")).resolves.toMatchObject({
    affectedCount: 1,
  });
});

it("does not widen ticket department visibility through global project management", async () => {
  world.addPerson("global", {
    capabilities: [CAPABILITY.MILESTONES, CAPABILITY.MANAGE_PROJECTS],
    allProjects: true,
    departments: ["design"],
  });
  await expect(world.call("global", "ticket.delete")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(world.keys.size).toBe(0);
});

it("rejects a milestone belonging to another project like a nonexistent one", async () => {
  const before = world.changes();
  await expect(
    world.call("admin", "milestone.delete", {
      ...world.request("milestone.delete"),
      projectId: "design",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(world.changes()).toEqual(before);
});

it("accepts the existing public ticket key contract", async () => {
  await expect(
    world.call("manager", "ticket.delete", {
      ...world.request("ticket.delete"),
      ticketId: "SYNTHETIC-1",
    }),
  ).resolves.toMatchObject({ id: "root", affectedCount: 1 });
});

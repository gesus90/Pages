import { beforeEach, describe, expect, it } from "vitest";

import { ArchiveWorld } from "./archive-world";

let world = new ArchiveWorld();
beforeEach(() => {
  world = new ArchiveWorld();
});

describe.each(["ticket.delete", "milestone.delete"] as const)(
  "%s confirmation and replay",
  (operation) => {
    it.each([undefined, "DELETE", "löschen", " LÖSCHEN", "yes"])(
      "refuses invalid German confirmation %s before writing",
      async (confirmation) => {
        const before = world.changes();
        await expect(
          world.call("manager", operation, {
            ...world.request(operation),
            confirmation,
          }),
        ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
        expect(world.changes()).toEqual(before);
      },
    );

    it("requires English confirmation in the current account language", async () => {
      world.languages.set("manager", "en");
      await expect(world.call("manager", operation)).rejects.toMatchObject({
        code: "CONFIRMATION_REQUIRED",
      });
      await expect(
        world.call("manager", operation, {
          ...world.request(operation),
          confirmation: "DELETE",
        }),
      ).resolves.toMatchObject({ affectedCount: 1 });
    });

    it("requires confirmation when the parameter is absent", async () => {
      const request = { ...world.request(operation) };
      delete request.confirmation;
      const before = world.changes();
      await expect(
        world.call("manager", operation, request),
      ).rejects.toMatchObject({
        code: "CONFIRMATION_REQUIRED",
      });
      expect(world.changes()).toEqual(before);
    });
  },
);

describe.each(["ticket.delete", "milestone.delete"] as const)(
  "%s replay authorization and idempotency",
  (operation) => {
    it("returns the identical stored result and emits no duplicate history or activity", async () => {
      const first = await world.call("manager", operation);
      const before = world.changes();
      expect(await world.call("manager", operation)).toEqual(first);
      expect(world.changes()).toEqual(before);
    });

    it("rechecks the milestone capability after it is revoked", async () => {
      await world.call("manager", operation);
      world.addPerson("manager", { capabilities: ["write"] });
      const before = world.changes();
      await expect(world.call("manager", operation)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(world.changes()).toEqual(before);
    });

    it("rechecks project responsibility after it is revoked", async () => {
      await world.call("manager", operation);
      world.managers.delete("engineering:manager");
      const before = world.changes();
      await expect(world.call("manager", operation)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(world.changes()).toEqual(before);
    });

    it("rechecks project visibility after department scope changes", async () => {
      await world.call("manager", operation);
      world.addPerson("manager", { departments: ["design"] });
      const before = world.changes();
      await expect(world.call("manager", operation)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(world.changes()).toEqual(before);
    });

    it("does not replay an archive result after the actual target disappears", async () => {
      await world.call("manager", operation);
      if (operation === "ticket.delete") world.tickets.delete("root");
      else world.milestones.delete("milestone");
      const before = world.changes();
      await expect(world.call("manager", operation)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(world.changes()).toEqual(before);
    });

    it("rechecks confirmation using the current language on replay", async () => {
      await world.call("manager", operation);
      world.languages.set("manager", "en");
      const before = world.changes();
      await expect(world.call("manager", operation)).rejects.toMatchObject({
        code: "CONFIRMATION_REQUIRED",
      });
      expect(world.changes()).toEqual(before);
    });
  },
);

describe.each(["ticket.delete", "milestone.delete"] as const)(
  "%s operation key and account validity",
  (operation) => {
    it("binds operationId to both operation and exact input", async () => {
      await world.call("manager", operation);
      const before = world.changes();
      await expect(
        world.call("manager", operation, {
          ...world.request(operation),
          confirmation: "DELETE",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const other =
        operation === "ticket.delete" ? "milestone.delete" : "ticket.delete";
      await expect(world.call("manager", other)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(world.changes()).toEqual(before);
    });

    it("keeps a denied operationId usable after rights are granted", async () => {
      await expect(world.call("writer", operation)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(world.keys.size).toBe(0);
      world.addPerson("writer");
      await expect(world.call("writer", operation)).resolves.toMatchObject({
        affectedCount: 1,
      });
    });

    it("refuses an unknown credential owner inside the transaction", async () => {
      const before = world.changes();
      await expect(world.call("unknown", operation)).rejects.toMatchObject({
        code: "invalid_token",
        status: 401,
      });
      expect(world.changes()).toEqual(before);
    });

    it.each([{ isActive: false }, { mustChangePassword: true }])(
      "checks the account again on a new call and replay: %j",
      async (options) => {
        await world.call("manager", operation);
        world.addPerson("manager", options);
        const before = world.changes();
        await expect(world.call("manager", operation)).rejects.toMatchObject({
          code: "invalid_token",
          status: 401,
        });
        await expect(
          world.call(
            "manager",
            operation,
            world.request(operation, "new-call"),
          ),
        ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
        expect(world.changes()).toEqual(before);
      },
    );
  },
);

it("rechecks the ticket's actual department on replay", async () => {
  await world.call("manager", "ticket.delete");
  world.addTicket("root", {
    archivedAt: "2026-10-14 00:00:00",
    departmentId: "design",
  });
  await expect(world.call("manager", "ticket.delete")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("rechecks the ticket's actual project responsibility on replay after a move", async () => {
  await world.call("manager", "ticket.delete");
  world.addProject("shared", ["engineering"]);
  world.addTicket("root", {
    archivedAt: "2026-10-14 00:00:00",
    projectId: "shared",
  });
  await expect(world.call("manager", "ticket.delete")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("refuses a stored milestone result whose target now belongs to another project", async () => {
  await world.call("admin", "milestone.delete");
  const milestone = world.milestones.get("milestone");
  if (!milestone) throw new Error("Missing milestone");
  world.milestones.set(milestone.id, { ...milestone, projectId: "design" });
  await expect(world.call("admin", "milestone.delete")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("keeps operationId results owner-scoped", async () => {
  await world.call("manager", "ticket.delete");
  await expect(world.call("admin", "ticket.delete")).resolves.toMatchObject({
    changed: false,
    affectedCount: 0,
  });
  expect(world.keys.size).toBe(2);
  expect(world.activity).toHaveLength(1);
});

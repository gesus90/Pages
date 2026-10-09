import { describe, expect, it, vi } from "vitest";

import { WorkItemTreeRepository } from "@/backend/database/repositories/task/WorkItemTreeRepository";
import { TicketTreeService } from "@/backend/service/task/TicketTreeService";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import { useMigratedDatabase } from "../helpers/test-database";
import { createUser, createWorkItem } from "../helpers/factories";

const actor = createUser({ id: "user-1" });

describe("ticket tree", () => {
  const getDatabase = useMigratedDatabase();

  function createService(
    findAll = vi.fn(async () => [
      createWorkItem({
        id: "epic-1",
        isDone: true,
        key: "PAGE-2",
        parentId: "initiative-1",
        projectName: "Pages",
        statusKey: "done",
        statusName: "Done",
        title: "Login",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    ]),
  ): TicketTreeService {
    return new TicketTreeService(new WorkItemTreeRepository(getDatabase()), {
      findAll,
    });
  }

  it("lists the active tickets of the actor in compact form", async () => {
    const findAll = vi.fn(async () => [
      createWorkItem({ id: "epic-1", type: WORK_ITEM_TYPE.EPIC }),
    ]);

    await expect(createService(findAll).findEntries(actor)).resolves.toEqual([
      {
        id: "epic-1",
        isDone: false,
        key: "PAGE-1",
        parentId: null,
        projectId: "project-1",
        projectName: "Pages",
        statusKey: "todo",
        statusName: "To Do",
        title: expect.any(String),
        type: WORK_ITEM_TYPE.EPIC,
      },
    ]);
    expect(findAll).toHaveBeenCalledWith(actor);
  });

  it("keeps the open branches per person", async () => {
    const service = createService();
    const other = createUser({ id: "user-2" });

    await service.setExpanded(actor, "project:project-1", true);
    await service.setExpanded(actor, "epic-1", true);
    await service.setExpanded(actor, "epic-1", true);
    await service.setExpanded(actor, "no-epic:project-1", true);
    await service.setExpanded(actor, "no-task:project-1", true);
    await service.setExpanded(other, "no-initiative:project-1", true);
    await service.setExpanded(actor, "no-epic:project-1", false);

    await expect(service.findExpandedKeys(actor)).resolves.toEqual([
      "epic-1",
      "no-task:project-1",
      "project:project-1",
    ]);
    await expect(service.findExpandedKeys(other)).resolves.toEqual([
      "no-initiative:project-1",
    ]);
  });

  it("refuses keys of an unknown form", async () => {
    const service = createService();

    for (const key of ["", "drop table", "other:x", "x".repeat(65)]) {
      await expect(service.setExpanded(actor, key, true)).rejects.toMatchObject(
        { code: "invalidTreeKey" },
      );
    }
  });

  it("stores no more than 500 open branches per person but still closes them", async () => {
    const service = createService();
    const repository = new WorkItemTreeRepository(getDatabase());

    for (let index = 0; index < 500; index += 1) {
      await repository.setExpanded(actor.id, `ticket-${index}`, true);
    }

    await service.setExpanded(actor, "ticket-500", true);
    await service.setExpanded(actor, "ticket-1", false);

    await expect(repository.countExpanded(actor.id)).resolves.toBe(499);
  });
});

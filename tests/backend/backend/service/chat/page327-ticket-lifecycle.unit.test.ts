import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { McpTicketLifecycleService } from "@/backend/service/mcp/ticket/McpTicketLifecycleService";

import { createPicaTicketWorld } from "./page327-ticket-world";

import type { PicaTicketWorld } from "./page327-ticket-world";

// Never start the independent MCP catalog in the Pages unit scope.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

let world: PicaTicketWorld;
beforeEach(() => {
  world = createPicaTicketWorld();
});

it.each([undefined, false])(
  "previews every affected key and title without writing when confirmed is %s",
  async (confirmed) => {
    const archive = vi.spyOn(McpTicketLifecycleService.prototype, "archive");
    const result = await world.call("tickets_archive", {
      ticketId: "ALP-3",
      ...(confirmed === undefined ? {} : { confirmed }),
    });
    expect(result).toEqual({
      ok: true,
      error: null,
      result: JSON.stringify({
        confirmationRequired: true,
        ticket: { key: "ALP-3", title: "Title task" },
        affected: [
          { key: "ALP-3", title: "Title task" },
          { key: "ALP-4", title: "Title sub" },
        ],
      }),
    });
    expect(archive).toHaveBeenCalledOnce();
    expect(world.storage.ticket("task").archivedAt).toBeNull();
    expect(world.storage.ticket("sub").archivedAt).toBeNull();
    expect(world.storage.state.writes).toEqual([]);
    expect(world.storage.state.history).toEqual([]);
  },
);

it("archives the confirmed subtree, reads its archived keys and restores it with the acting account in history", async () => {
  const restore = vi.spyOn(McpTicketLifecycleService.prototype, "restore");
  expect(
    await world.call("tickets_archive", { ticketId: "ALP-3", confirmed: true }),
  ).toEqual({ ok: true, error: null, result: '{"archived":2}' });
  for (const ticketId of ["ALP-3", "ALP-4"]) {
    const read = await world.call("tickets_read", { ticketId });
    expect(read.ok).toBe(true);
    expect(JSON.parse(read.result ?? "null")).toMatchObject({
      key: ticketId,
      isArchived: true,
      statusId: "done",
      isDone: true,
    });
  }
  expect(world.storage.ticket("epic").archivedAt).toBeNull();
  expect(world.storage.state.history).toMatchObject([
    { workItemId: "task", action: "archived", userId: "manager" },
    { workItemId: "sub", action: "archived", userId: "manager" },
  ]);
  const restored = await world.call("tickets_restore", { ticketId: "ALP-3" });
  expect(restored.ok).toBe(true);
  expect(JSON.parse(restored.result ?? "null")).toMatchObject({
    restored: 2,
    ticket: { key: "ALP-3", archived: false, status: { isDone: true } },
  });
  expect(restore).toHaveBeenCalledOnce();
  for (const id of ["task", "sub"]) {
    expect(world.storage.ticket(id)).toMatchObject({
      archivedAt: null,
      statusId: "done",
    });
    expect(world.storage.actions(id)).toEqual(["archived", "restored"]);
  }
  const history = await world.storage.tasks.findHistoryByProject(
    world.storage.user("manager"),
    "alpha",
  );
  expect(history).toHaveLength(4);
  expect(history.every((entry) => entry.userDisplayName === "manager")).toBe(
    true,
  );
  expect(
    JSON.parse(
      (await world.call("tickets_read", { ticketId: "ALP-3" })).result ??
        "null",
    ),
  ).toMatchObject({ isArchived: false });
});

it.each([{}, { confirmed: true }])(
  "returns FORBIDDEN without archive rights and writes nothing for %j",
  async (options) => {
    expect(
      await world.call(
        "tickets_archive",
        { ticketId: "task", ...options },
        "writer",
      ),
    ).toEqual({ ok: false, error: "FORBIDDEN", result: null });
    expect(world.storage.state.writes).toEqual([]);
    expect(world.storage.state.history).toEqual([]);
    expect(world.storage.ticket("task").archivedAt).toBeNull();
  },
);

it("rechecks archive rights after the preview and refuses restore without them", async () => {
  await world.call("tickets_archive", { ticketId: "task", confirmed: true });
  const before = structuredClone(world.storage.state);
  expect(
    await world.call("tickets_restore", { ticketId: "task" }, "writer"),
  ).toEqual({ ok: false, error: "FORBIDDEN", result: null });
  expect(world.storage.state).toEqual(before);
  await world.call("tickets_restore", { ticketId: "task" });
  await world.call("tickets_archive", { ticketId: "task" });
  world.storage.addPerson("manager", { capabilities: ["write", "milestones"] });
  const previewed = structuredClone(world.storage.state);
  expect(
    await world.call("tickets_archive", { ticketId: "task", confirmed: true }),
  ).toEqual({ ok: false, error: "FORBIDDEN", result: null });
  expect(world.storage.state).toEqual(previewed);
});

it("requires project responsibility as well as the milestone capability to archive", async () => {
  const active = structuredClone(world.storage.state);
  for (const options of [{}, { confirmed: true }]) {
    expect(
      await world.call(
        "tickets_archive",
        { ticketId: "task", ...options },
        "milestoner",
      ),
    ).toEqual({ ok: false, error: "FORBIDDEN", result: null });
    expect(world.storage.state).toEqual(active);
  }
});

it("requires project responsibility as well as the milestone capability to restore", async () => {
  expect(
    (await world.call("tickets_archive", { ticketId: "task", confirmed: true }))
      .ok,
  ).toBe(true);
  const archived = structuredClone(world.storage.state);
  expect(
    await world.call("tickets_restore", { ticketId: "task" }, "milestoner"),
  ).toEqual({ ok: false, error: "FORBIDDEN", result: null });
  expect(world.storage.state).toEqual(archived);
});

it("attributes restoration to its current account independently of the account that archived", async () => {
  world.storage.addPerson("restorer", {
    capabilities: ["write", "milestones", "manage_projects"],
    managedDepartments: ["engineering"],
  });
  expect(
    await world.call("tickets_archive", { ticketId: "task", confirmed: true }),
  ).toEqual({ ok: true, error: null, result: '{"archived":2}' });
  const restored = await world.call(
    "tickets_restore",
    { ticketId: "task" },
    "restorer",
  );
  expect(restored.ok).toBe(true);
  expect(JSON.parse(restored.result ?? "null")).toMatchObject({ restored: 2 });
  const history = await world.storage.tasks.findHistoryByProject(
    world.storage.user("manager"),
    "alpha",
  );
  expect(history).toHaveLength(4);
  for (const workItemId of ["task", "sub"]) {
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workItemId,
          action: "archived",
          userId: "manager",
          userDisplayName: "manager",
        }),
        expect.objectContaining({
          workItemId,
          action: "restored",
          userId: "restorer",
          userDisplayName: "restorer",
        }),
      ]),
    );
  }
});

it.each([undefined, true])(
  "rejects keep for a task in preview and execution (confirmed %s)",
  async (confirmed) => {
    expect(
      await world.call("tickets_archive", {
        ticketId: "task",
        children: "keep",
        confirmed,
      }),
    ).toEqual({ ok: false, error: "INVALID_REQUEST", result: null });
    expect(world.storage.state.writes).toEqual([]);
    expect(world.storage.ticket("sub").parentId).toBe("task");
    expect(world.storage.ticket("sub").archivedAt).toBeNull();
  },
);

it("keeps an epic's children active and detaches them only after confirmation", async () => {
  const preview = await world.call("tickets_archive", {
    ticketId: "epic",
    children: "keep",
  });
  expect(JSON.parse(preview.result ?? "null")).toMatchObject({
    affected: [{ key: "ALP-2", title: "Title epic" }],
  });
  expect(world.storage.ticket("task").parentId).toBe("epic");
  expect(
    await world.call("tickets_archive", {
      ticketId: "epic",
      children: "keep",
      confirmed: true,
    }),
  ).toEqual({ ok: true, error: null, result: '{"archived":1}' });
  expect(world.storage.ticket("task")).toMatchObject({
    parentId: null,
    archivedAt: null,
  });
  expect(world.storage.ticket("sub")).toMatchObject({
    parentId: "task",
    archivedAt: null,
  });
});

it.each(["tickets_archive", "tickets_restore"])(
  "returns NOT_FOUND for missing and hidden tickets through %s",
  async (tool) => {
    world.storage.addTicket("hidden", {
      projectId: "beta",
      departmentIds: ["design"],
    });
    for (const ticketId of ["missing", "hidden"])
      expect(await world.call(tool, { ticketId })).toEqual({
        ok: false,
        error: "NOT_FOUND",
        result: null,
      });
    expect(world.storage.state.writes).toEqual([]);
  },
);

it("rejects hidden descendants without archiving any visible ticket", async () => {
  world.storage.addTicket("hidden", {
    type: "subtask",
    parentId: "task",
    departmentIds: ["design"],
  });
  expect(
    await world.call("tickets_archive", { ticketId: "task", confirmed: true }),
  ).toEqual({ ok: false, error: "INVALID_REQUEST", result: null });
  expect(world.storage.state.writes).toEqual([]);
  expect(world.storage.state.history).toEqual([]);
});

it("rejects restoring a subtree with hidden descendants without changing tickets or history", async () => {
  expect(
    (await world.call("tickets_archive", { ticketId: "task", confirmed: true }))
      .ok,
  ).toBe(true);
  world.storage.addTicket("sub", {
    ...world.storage.ticket("sub"),
    departmentIds: ["design"],
  });
  const archived = structuredClone(world.storage.state);
  expect(await world.call("tickets_restore", { ticketId: "task" })).toEqual({
    ok: false,
    error: "INVALID_REQUEST",
    result: null,
  });
  expect(world.storage.state).toEqual(archived);
});

it("finds only archived tickets with archived true and excludes them by default or with false", async () => {
  await world.call("tickets_archive", { ticketId: "ALP-3", confirmed: true });
  for (const archived of [undefined, false, true]) {
    const searched = await world.call("tickets_search", {
      projectId: "alpha",
      ...(archived === undefined ? {} : { archived }),
    });
    expect(searched.ok).toBe(true);
    expect(JSON.parse(searched.result ?? "null")).toMatchObject({
      total: 2,
      tickets: (archived === true ? ["task", "sub"] : ["ini", "epic"]).map(
        (id) => ({ id }),
      ),
    });
  }
  const denied = await world.call(
    "tickets_search",
    { projectId: "alpha", archived: true },
    "writer",
  );
  expect(denied.ok).toBe(true);
  expect(JSON.parse(denied.result ?? "null")).toMatchObject({
    total: 0,
    tickets: [],
  });
});

it("pages only visible archived tickets and binds the cursor to the archive filter", async () => {
  await world.call("tickets_archive", { ticketId: "task", confirmed: true });
  world.storage.addTicket("hidden", {
    number: 5,
    departmentIds: ["design"],
    archivedAt: "2026-01-01 00:00:00",
  });
  const first = await world.call("tickets_search", {
    projectId: "alpha",
    archived: true,
    limit: 1,
  });
  expect(first.ok).toBe(true);
  const page = z
    .object({
      total: z.number(),
      tickets: z.array(z.object({ id: z.string() })),
      nextCursor: z.string(),
    })
    .parse(JSON.parse(first.result ?? "null"));
  expect(page).toEqual({
    total: 2,
    tickets: [{ id: "task" }],
    nextCursor: expect.any(String),
  });
  const next = await world.call("tickets_search", {
    projectId: "alpha",
    archived: true,
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(next.ok).toBe(true);
  expect(JSON.parse(next.result ?? "null")).toMatchObject({
    total: 2,
    tickets: [{ id: "sub" }],
    nextCursor: null,
  });
  expect(
    await world.call("tickets_search", {
      projectId: "alpha",
      cursor: page.nextCursor,
    }),
  ).toEqual({ ok: false, error: "INVALID_REQUEST", result: null });
});

it("combines the archive filter with the ticket type and reflects restoration in search", async () => {
  await world.call("tickets_archive", { ticketId: "task", confirmed: true });
  const parameters = { projectId: "alpha", archived: true, type: "task" };
  const archived = await world.call("tickets_search", parameters);
  expect(archived.ok).toBe(true);
  expect(JSON.parse(archived.result ?? "null")).toMatchObject({
    total: 1,
    tickets: [{ id: "task", type: "task" }],
  });
  expect((await world.call("tickets_restore", { ticketId: "task" })).ok).toBe(
    true,
  );
  const restored = await world.call("tickets_search", parameters);
  expect(restored.ok).toBe(true);
  expect(JSON.parse(restored.result ?? "null")).toMatchObject({
    total: 0,
    tickets: [],
  });
});

it.each([
  ["tickets_archive", { ticketId: "task", confirmed: "true" }],
  ["tickets_archive", { ticketId: "task", children: "omit" }],
  ["tickets_archive", { ticketId: "task", userId: "manager" }],
  ["tickets_restore", { ticketId: "task", confirmed: true }],
  ["tickets_search", { projectId: "alpha", archived: "true" }],
  ["tickets_search", { projectId: "alpha", archived: null }],
] as const)(
  "rejects malformed native input for %s: %j",
  async (tool, input) => {
    const execute = vi.spyOn(world.executor, "run");
    const before = structuredClone(world.storage.state);
    expect(
      await world.registry.invoke(tool, input, {
        userId: "writer",
        sessionId: "session",
        runId: "run",
        signal: new AbortController().signal,
        authorize: async () => undefined,
      }),
    ).toEqual({ isValid: false, output: null });
    expect(execute).not.toHaveBeenCalled();
    expect(world.storage.state).toEqual(before);
  },
);

it("keeps an internal failure distinct from a business rejection", async () => {
  vi.spyOn(TaskRepository.prototype, "archiveMany").mockRejectedValue(
    new Error("Synthetic internal detail"),
  );
  expect(
    await world.call("tickets_archive", { ticketId: "task", confirmed: true }),
  ).toEqual({ ok: false, error: "FAILED", result: null });
  expect(world.storage.state.history).toEqual([]);
});

it("counts only newly archived tickets and leaves an already archived subtask out of the preview", async () => {
  world.storage.addTicket("sub", {
    ...world.storage.ticket("sub"),
    archivedAt: "2026-01-01 00:00:00",
  });
  const preview = await world.call("tickets_archive", { ticketId: "task" });
  expect(JSON.parse(preview.result ?? "null")).toMatchObject({
    affected: [{ key: "ALP-3", title: "Title task" }],
  });
  expect(
    await world.call("tickets_archive", { ticketId: "task", confirmed: true }),
  ).toEqual({ ok: true, error: null, result: '{"archived":1}' });
  expect(
    await world.call("tickets_archive", { ticketId: "task", confirmed: true }),
  ).toEqual({ ok: true, error: null, result: '{"archived":0}' });
  expect(world.storage.state.history).toHaveLength(1);
});

it("rejects restoring below an archived parent without changing the subtree", async () => {
  await world.call("tickets_archive", { ticketId: "epic", confirmed: true });
  const before = structuredClone(world.storage.state);
  expect(await world.call("tickets_restore", { ticketId: "task" })).toEqual({
    ok: false,
    error: "INVALID_REQUEST",
    result: null,
  });
  expect(world.storage.state).toEqual(before);
});

it.each([
  ["ticket.archive", { ticketId: "task", confirmed: "true" }],
  ["ticket.archive", { ticketId: "task", children: "omit" }],
  ["ticket.restore", { ticketId: "task", confirmed: true }],
] as const)(
  "validates raw executor parameters for %s",
  async (operation, parameters) => {
    expect(
      await world.executor.run("manager", { operation, parameters }, null),
    ).toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(world.storage.state.writes).toEqual([]);
  },
);

it.each(["manager", "missing"])(
  "refuses an unavailable lifecycle account %s",
  async (userId) => {
    world.storage.addPerson("manager", { isActive: false });
    await expect(
      world.lifecycle.handle(userId, "ticket.archive", {
        ticketId: "task",
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(world.storage.state.writes).toEqual([]);
  },
);

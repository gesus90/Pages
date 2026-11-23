import { expect, it, vi } from "vitest";

import { AutomationRepository } from "./AutomationRepository";

import type { StoredAutomation } from "./AutomationRepository";
import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AutomationRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AutomationRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

function rowOf(overrides: Record<number, unknown> = {}): unknown[] {
  const row: unknown[] = [
    "a1",
    "u1",
    "Name",
    JSON.stringify({ type: "manual" }),
    JSON.stringify({ type: "agent", agentId: "ag", instruction: "go" }),
    "private",
    null,
    1,
    0,
    "off",
    null,
    null,
    3n,
    "c",
    "u",
  ];
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  return row;
}

function automationOf(overrides: Partial<StoredAutomation>): StoredAutomation {
  return {
    id: "a1",
    creatorId: "u1",
    name: "Name",
    trigger: { type: "manual" },
    action: { type: "agent", agentId: "ag", instruction: "go" },
    sharing: { scope: "private" },
    isActive: true,
    deleteAfterSuccess: false,
    agentNotification: { mode: "off" },
    nextRunAt: null,
    revision: 1,
    createdAt: "c",
    updatedAt: "u",
    ...overrides,
  };
}

it("finds and locks an automation or returns null", async () => {
  const found = doubleOf([rowOf()]);
  const missing = doubleOf([]);

  expect(await found.repository.find("a1")).toMatchObject({
    id: "a1",
    revision: 3,
    isActive: true,
    deleteAfterSuccess: false,
    sharing: { scope: "private" },
    agentNotification: { mode: "off" },
  });
  expect(await found.repository.lock("a1")).not.toBeNull();
  expect(await missing.repository.find("a1")).toBeNull();
  expect(await missing.repository.lock("a1")).toBeNull();
  expect(String(found.query.mock.calls[1]?.[0])).toContain("FOR UPDATE");
});

it("reads project and group sharing and falls back to private", async () => {
  const project = doubleOf([rowOf({ 5: "project", 6: "p1" })]);
  const group = doubleOf([rowOf({ 5: "group", 6: "g1" })]);
  const orphan = doubleOf([rowOf({ 5: "project", 6: null })]);

  expect((await project.repository.find("a"))?.sharing).toEqual({
    scope: "project",
    projectId: "p1",
  });
  expect((await group.repository.find("a"))?.sharing).toEqual({
    scope: "group",
    groupId: "g1",
  });
  expect((await orphan.repository.find("a"))?.sharing).toEqual({
    scope: "private",
  });
});

it("reads the notification modes and treats unknown modes as off", async () => {
  const error = doubleOf([rowOf({ 9: "error", 10: "ag" })]);
  const always = doubleOf([rowOf({ 9: "always" })]);
  const unknown = doubleOf([rowOf({ 9: "weird", 10: "ag" })]);

  expect((await error.repository.find("a"))?.agentNotification).toEqual({
    mode: "error",
    agentId: "ag",
  });
  expect((await always.repository.find("a"))?.agentNotification).toEqual({
    mode: "always",
    agentId: null,
  });
  expect((await unknown.repository.find("a"))?.agentNotification).toEqual({
    mode: "off",
  });
});

it("fails loudly on a stored definition that violates the contract", async () => {
  const { repository } = doubleOf([
    rowOf({ 3: JSON.stringify({ type: "x" }) }),
  ]);

  await expect(repository.find("a1")).rejects.toThrow();
});

it("lists with the viewer, the filters and the keyset", async () => {
  const { repository, query } = doubleOf([rowOf()]);

  const items = await repository.list({
    viewerId: "v",
    isAdministrator: true,
    text: "x",
    isActive: false,
    after: { createdAt: "c0", id: "i0" },
    limit: 10,
  });

  expect(items).toHaveLength(1);
  expect(query.mock.calls[0]?.[1]).toEqual({
    viewer_id: "v",
    is_administrator: true,
    text: "x",
    active_filter: "false",
    after_created_at: "c0",
    after_id: "i0",
    limit: 10,
  });
});

it("lists without optional filters", async () => {
  const { repository, query } = doubleOf([]);

  await repository.list({ viewerId: "v", isAdministrator: false, limit: 5 });

  expect(query.mock.calls[0]?.[1]).toEqual({
    viewer_id: "v",
    is_administrator: false,
    text: "",
    active_filter: "",
    after_created_at: "",
    after_id: "",
    limit: 5,
  });
});

it("reads due automations and the ones waiting for an event", async () => {
  const { repository, query } = doubleOf([rowOf()]);

  expect(await repository.due("now", 4)).toHaveLength(1);
  expect(await repository.waitingFor("ticket.created")).toHaveLength(1);
  expect(query.mock.calls[0]?.[1]).toEqual({ now: "now", limit: 4 });
  expect(query.mock.calls[1]?.[1]).toEqual({ event_type: "ticket.created" });
});

it("inserts an automation with its creator and creation time", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.insert(automationOf({}));

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "a1",
    creator_id: "u1",
    created_at: "c",
    trigger_type: "manual",
    event_type: null,
    action_type: "agent",
    sharing_scope: "private",
    sharing_target_id: null,
    notification_mode: "off",
    notification_agent_id: null,
  });
});

it("writes event triggers, sharing targets and notification agents", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.insert(
    automationOf({
      trigger: { type: "event", eventType: "plan.failed" },
      sharing: { scope: "project", projectId: "p1" },
      agentNotification: { mode: "error", agentId: "ag" },
    }),
  );
  await repository.insert(
    automationOf({
      sharing: { scope: "group", groupId: "g1" },
      agentNotification: { mode: "always" },
    }),
  );

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    event_type: "plan.failed",
    sharing_target_id: "p1",
    notification_agent_id: "ag",
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    sharing_target_id: "g1",
    notification_agent_id: null,
  });
});

it("replaces only at the expected revision", async () => {
  const written = doubleOf([["a1"]]);
  const stale = doubleOf([]);

  expect(await written.repository.replace(automationOf({}), 0)).toBe(true);
  expect(await stale.repository.replace(automationOf({}), 0)).toBe(false);
  expect(written.query.mock.calls[0]?.[1]).toMatchObject({
    expected_revision: 0,
  });
});

it("schedules and deletes an automation", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.schedule("a1", null);
  await repository.delete("a1");

  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "a1", next_run_at: null });
  expect(execute.mock.calls[1]?.[1]).toEqual({ id: "a1" });
});

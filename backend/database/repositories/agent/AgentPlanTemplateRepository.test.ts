import { beforeEach, expect, it, vi } from "vitest";

import {
  AgentPlanTemplateRepository,
  type AgentPlanTemplateScope,
  type AgentPlanTemplateWrite,
} from "./AgentPlanTemplateRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlanTemplateNode } from "@/definition/AgentPlanNodeTemplate";

const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
const query = vi.fn<DatabaseTransaction["query"]>();

const NODE: AgentPlanTemplateNode = {
  id: "n1",
  type: "parameter",
  name: "Limit",
  format: "string",
  value: { type: "text", text: "5" },
  x: 0,
  y: 0,
};

const PERSONAL: AgentPlanTemplateScope = {
  ownerId: "u1",
  projectId: null,
  departmentIds: [],
};

const WRITE: AgentPlanTemplateWrite = {
  id: "t1",
  ownerId: "u1",
  name: " Limit ",
  node: NODE,
  team: null,
};

function row(
  overrides: Partial<
    Record<"type" | "node" | "department" | "owner", string | null>
  > = {},
): DatabaseValue[] {
  return [
    "t1",
    "Limit",
    overrides.type ?? "parameter",
    overrides.node ?? JSON.stringify(NODE),
    "2026-01-01T00:00:00.000Z",
    overrides.department ?? null,
    overrides.owner ?? "u1",
  ];
}

function repository(): AgentPlanTemplateRepository {
  return new AgentPlanTemplateRepository({
    query,
    transaction: async (work) => work({ execute, query }),
  });
}

beforeEach(() => {
  execute.mockClear();
  query.mockReset();
});

it("lists personal templates and skips unknown node types", async () => {
  query.mockResolvedValueOnce([row(), row({ type: "future" })]);

  const templates = await repository().list(PERSONAL);

  expect(templates).toHaveLength(1);
  expect(templates[0]).toMatchObject({
    id: "t1",
    type: "parameter",
    isShared: false,
    isOwn: true,
    node: NODE,
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ owner_id: "u1" });
});

it("lists the shared templates of the scope's departments", async () => {
  query.mockResolvedValueOnce([row({ department: "d1", owner: "u2" })]);

  const templates = await repository().list({
    ownerId: "u1",
    projectId: "p1",
    departmentIds: ["d1", "d2"],
  });

  expect(templates[0]).toMatchObject({ isShared: true, isOwn: false });
  expect(query.mock.calls[0]?.[1]).toEqual({
    owner_id: "u1",
    project_id: "p1",
    department_0: "d1",
    department_1: "d2",
  });
});

it("limits the scope to personal templates without departments or project", async () => {
  query.mockResolvedValue([]);

  await repository().list({
    ownerId: "u1",
    projectId: "p1",
    departmentIds: [],
  });
  await repository().list({
    ownerId: "u1",
    projectId: null,
    departmentIds: ["d1"],
  });

  expect(query.mock.calls[0]?.[1]).toEqual({ owner_id: "u1" });
  expect(query.mock.calls[1]?.[1]).toEqual({ owner_id: "u1" });
});

it("finds one template or none", async () => {
  query.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);

  expect(await repository().find(PERSONAL, "t1")).toMatchObject({ id: "t1" });
  expect(await repository().find(PERSONAL, "t2")).toBeNull();
});

it("refuses a stored node that does not match its type", async () => {
  query.mockResolvedValueOnce([row({ type: "agent" })]);

  await expect(repository().find(PERSONAL, "t1")).rejects.toMatchObject({
    code: "template_invalid",
  });
});

it("creates a template under a free name", async () => {
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([row()]);
  const journal = vi.fn(async () => {});

  const created = await repository().create(WRITE, journal);

  expect(created.id).toBe("t1");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    name_key: "limit",
    node_type: "parameter",
    project_id: null,
    department_id: null,
  });
  expect(journal).toHaveBeenCalledWith(expect.anything(), created);
});

it("creates a shared template for the team", async () => {
  query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([row({ department: "d1" })]);

  await repository().create({
    ...WRITE,
    team: { projectId: "p1", departmentId: "d1" },
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    project_id: "p1",
    department_id: "d1",
  });
  expect(query.mock.calls[1]?.[1]).toMatchObject({ department_0: "d1" });
});

it("refuses a name the owner already uses", async () => {
  query.mockResolvedValueOnce([["other"]]);

  await expect(repository().create(WRITE)).rejects.toMatchObject({
    code: "template_name_taken",
  });
  expect(execute).not.toHaveBeenCalled();
});

it("fails when the created template cannot be read back", async () => {
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

  await expect(repository().create(WRITE)).rejects.toMatchObject({
    code: "template_invalid",
  });
});

it("turns a parallel duplicate into template_name_taken and passes other errors", async () => {
  const duplicate = Object.assign(new Error("dup"), {
    code: "23505",
    detail: "Key (owner_id, name_key)=(a, b) already exists.",
  });
  const failing = (error: unknown): AgentPlanTemplateRepository =>
    new AgentPlanTemplateRepository({
      query,
      transaction: async () => {
        throw error;
      },
    });
  const other = new Error("disk");

  await expect(failing(duplicate).create(WRITE)).rejects.toMatchObject({
    code: "template_name_taken",
  });
  await expect(
    failing(duplicate).update({
      id: "t1",
      ownerId: "u1",
      name: "x",
      node: null,
    }),
  ).rejects.toMatchObject({ code: "template_name_taken" });
  await expect(failing(other).create(WRITE)).rejects.toBe(other);
  await expect(
    failing(other).update({ id: "t1", ownerId: "u1", name: null, node: null }),
  ).rejects.toBe(other);
});

it("renames a template and replaces its node", async () => {
  query
    .mockResolvedValueOnce([["p1", "d1"]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([row({ department: "d1" })]);
  const journal = vi.fn(async () => {});

  const updated = await repository().update(
    { id: "t1", ownerId: "u1", name: "New", node: NODE },
    journal,
  );

  expect(updated.isShared).toBe(true);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    name: "New",
    name_key: "new",
    node_type: "parameter",
  });
  expect(journal).toHaveBeenCalledWith(expect.anything(), updated);
});

it("keeps name and node when the change names neither", async () => {
  query.mockResolvedValueOnce([[null, null]]).mockResolvedValueOnce([row()]);

  await repository().update({
    id: "t1",
    ownerId: "u1",
    name: null,
    node: null,
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    name: null,
    name_key: null,
    node_type: null,
    node_json: null,
  });
});

it("refuses an update of a template of someone else", async () => {
  query.mockResolvedValueOnce([]);

  await expect(
    repository().update({ id: "t1", ownerId: "u2", name: null, node: null }),
  ).rejects.toMatchObject({ code: "template_owner_only" });
});

it("refuses a rename to a name of another template", async () => {
  query.mockResolvedValueOnce([[null, null]]).mockResolvedValueOnce([["t2"]]);

  await expect(
    repository().update({ id: "t1", ownerId: "u1", name: "Taken", node: null }),
  ).rejects.toMatchObject({ code: "template_name_taken" });
});

it("fails when the updated template cannot be read back", async () => {
  query.mockResolvedValueOnce([[null, null]]).mockResolvedValueOnce([]);

  await expect(
    repository().update({ id: "t1", ownerId: "u1", name: null, node: null }),
  ).rejects.toMatchObject({ code: "template_invalid" });
});

it("removes a template of its owner and journals the removed one", async () => {
  query.mockResolvedValueOnce([["p1", "d1"]]).mockResolvedValueOnce([row()]);
  const journal = vi.fn(async () => {});

  await repository().remove({ id: "t1", ownerId: "u1" }, journal);

  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "t1", owner_id: "u1" });
  expect(journal).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: "t1" }),
  );
});

it("refuses to remove a template that is not the owner's or unreadable", async () => {
  query
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[null, null]])
    .mockResolvedValueOnce([]);

  await expect(
    repository().remove({ id: "t1", ownerId: "u2" }),
  ).rejects.toMatchObject({ code: "template_owner_only" });
  await expect(
    repository().remove({ id: "t1", ownerId: "u1" }),
  ).rejects.toMatchObject({ code: "template_owner_only" });
  expect(execute).not.toHaveBeenCalled();
});

it("removes without a journal", async () => {
  query.mockResolvedValueOnce([[null, null]]).mockResolvedValueOnce([row()]);

  await repository().remove({ id: "t1", ownerId: "u1" });

  expect(execute).toHaveBeenCalledTimes(1);
});

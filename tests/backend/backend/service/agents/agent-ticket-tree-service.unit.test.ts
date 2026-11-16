import { expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentReadDependencies } from "@/backend/service/agents/AgentReadContext";
import type { AgentIdentity } from "@/definition/McpAuthorization";

const boundary = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/backend/service/agents/AgentTaskAccess", () => ({
  createAgentTaskContext: boundary.context,
}));

import { AgentTicketTreeService } from "@/backend/service/agents/AgentTicketTreeService";

function ticket(
  id: string,
  number: number,
  parentId: string | null,
): {
  id: string;
  number: number;
  key: string;
  title: string;
  type: string;
  projectId: string;
  parentId: string | null;
  parentKey: null;
  statusId: string;
  statusName: string;
  isDone: boolean;
} {
  return {
    id,
    number,
    key: `P-${number}`,
    title: id,
    type: "task",
    projectId: "project",
    parentId,
    parentKey: null,
    statusId: "open",
    statusName: "Open",
    isDone: false,
  };
}
const root = ticket("root", 1, null);
const child = ticket("child", 2, "root");
const grandchild = ticket("grandchild", 3, "child");
const getById = vi.fn(async () => child);
const findAll = vi.fn(async () => [root, child, grandchild]);
const project = vi.fn(async () => ({}));
const service = new AgentTicketTreeService(
  partial<AgentReadDependencies>({
    database: {},
    users: {
      getById: async () => ({
        id: "user",
        isActive: true,
        mustChangePassword: false,
      }),
    },
  }),
);
const identity = partial<AgentIdentity>({ userId: "user" });
boundary.context.mockReturnValue({
  actor: { id: "user" },
  projects: { getById: project },
  tasks: { getById, findAll },
});

it("returns a project hierarchy with visible child counts and depths", async () => {
  const response = await service.read(identity, { projectId: "project" });
  expect(response.result).toMatchObject({
    projectId: "project",
    root: null,
    total: 3,
    nodes: [
      { id: "root", depth: 0, childCount: 1 },
      { id: "child", depth: 1, childCount: 1 },
      { id: "grandchild", depth: 2, childCount: 0 },
    ],
  });
  expect(project).toHaveBeenCalledWith({ id: "user" }, "project");
});

it("returns a visible ancestor path and the requested subtree", async () => {
  const response = await service.read(identity, { ticketId: "child" });
  expect(response.result).toMatchObject({
    root: { id: "child", depth: 1 },
    path: [{ id: "root", depth: 0 }],
    nodes: [{ id: "grandchild", depth: 2 }],
    total: 1,
  });
  await expect(
    service.read(identity, { ticketId: "child", projectId: "other" }),
  ).rejects.toThrow();
});

it("binds paging cursors to the reader and scope", async () => {
  const response = await service.read(identity, {
    projectId: "project",
    limit: 1,
  });
  expect(response.result).toMatchObject({ total: 3, nodes: [{ id: "root" }] });
  const result = response.result;
  if (!("nextCursor" in result) || typeof result.nextCursor !== "string")
    throw new Error("Expected cursor");
  const next = await service.read(identity, {
    projectId: "project",
    limit: 1,
    cursor: result.nextCursor,
  });
  expect(next.result).toMatchObject({ nodes: [{ id: "child" }] });
  await expect(
    service.read(partial<AgentIdentity>({ userId: "other" }), {
      projectId: "project",
      cursor: result.nextCursor,
    }),
  ).rejects.toThrow();
});

import { beforeEach, expect, it, vi } from "vitest";

import { applyAgentWikiAnchors } from "@/backend/service/agents/AgentWikiAnchors";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";

const boundary = vi.hoisted(() => ({
  findVisible: vi.fn(),
  findAnchors: vi.fn(),
  setAnchors: vi.fn(async () => undefined),
  record: vi.fn(async () => undefined),
}));
vi.mock("@/backend/database/repositories/WikiRepository", () => ({
  WikiRepository: class {
    public pages = { findVisible: boundary.findVisible };
    public anchors = { findAnchors: boundary.findAnchors };
  },
}));
vi.mock("@/backend/database/repositories/ProjectRepository", () => ({
  ProjectRepository: class {},
}));
vi.mock("@/backend/service/agents/AgentWikiAccess", () => ({
  createAgentWikiAccess: () => ({ resolve: async () => ({ scope: {} }) }),
}));
vi.mock("@/backend/service/wiki/WikiPageService", () => ({
  WikiPageService: class {
    public setAnchors = boundary.setAnchors;
  },
}));
vi.mock("@/backend/service/wiki/WikiActivity", () => ({
  recordWikiActivity: boundary.record,
}));

const context = partial<AgentTaskContext>({
  actor: { id: "user" },
  channel: "mcp",
  database: {},
});
const anchor = { kind: "department", targetId: "department-id" };

beforeEach(() => {
  vi.clearAllMocks();
  boundary.findVisible.mockResolvedValue({ id: "page", projectId: "project" });
  boundary.findAnchors.mockResolvedValue([]);
});

it("replaces unchanged expected anchors and records activity", async () => {
  await expect(
    applyAgentWikiAnchors(context, {
      pageId: "page",
      expectedAnchors: [],
      anchors: [anchor],
    }),
  ).resolves.toEqual({ id: "page", projectId: "project", changed: true });
  expect(boundary.setAnchors).toHaveBeenCalledWith(context.actor, "page", [
    anchor,
  ]);
  expect(boundary.record).toHaveBeenCalledOnce();
});

it("accepts an already applied result but rejects conflicting or duplicate anchors", async () => {
  boundary.findAnchors.mockResolvedValue([anchor]);
  await expect(
    applyAgentWikiAnchors(context, {
      pageId: "page",
      expectedAnchors: [],
      anchors: [anchor],
    }),
  ).resolves.toMatchObject({ changed: false });
  await expect(
    applyAgentWikiAnchors(context, {
      pageId: "page",
      expectedAnchors: [],
      anchors: [],
    }),
  ).rejects.toThrow();
  await expect(
    applyAgentWikiAnchors(context, {
      pageId: "page",
      expectedAnchors: [],
      anchors: [anchor, anchor],
    }),
  ).rejects.toThrow();
  expect(boundary.setAnchors).not.toHaveBeenCalled();
});

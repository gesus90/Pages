import { describe, expect, it, vi } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { readAgentWikiCreate } from "@/backend/service/agents/AgentWikiCreateValidation";
import {
  normalizeRevision,
  readAgentWikiFieldChange,
  readAgentWikiMove,
} from "@/backend/service/agents/AgentWikiFieldValidation";
import { AgentWikiReadService } from "@/backend/service/agents/AgentWikiReadService";
import {
  extractWikiLinks,
  mentionsWikiPage,
} from "@/backend/service/wiki/WikiLinks";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { createUser } from "../helpers/factories";

const CONTENT_LIMIT = PAGES_AGENT_LIMITS.wikiContentBytes;

describe("wiki link extraction of page: references", () => {
  it("keeps real page references and drops the reserved paths of the wiki", () => {
    const content = [
      "[a](page:attachments)",
      "[b](page:trash)",
      "[c](page:search)",
      "[d](page:handbook-1)",
      "[e](page:handbook-1)",
    ].join("\n");

    expect(extractWikiLinks(content)).toEqual({
      pageIds: ["handbook-1"],
      ticketKeys: [],
    });
    expect(mentionsWikiPage(content, "handbook-1")).toBe(true);
    expect(mentionsWikiPage(content, "trash")).toBe(false);
  });
});

describe("agent wiki create validation limits", () => {
  const base = {
    operationId: "create-1",
    projectId: null,
    parentId: null,
    title: "Title",
    icon: null,
    assetIds: [],
  };

  it("accepts a page of exactly the maximum size", () => {
    const content = "a".repeat(CONTENT_LIMIT);

    expect(readAgentWikiCreate({ ...base, content })).toMatchObject({
      operationId: "create-1",
      content,
    });
  });

  it("refuses a page above the maximum size and names the limit", () => {
    expect(() =>
      readAgentWikiCreate({ ...base, content: "a".repeat(CONTENT_LIMIT + 1) }),
    ).toThrow(
      expect.objectContaining({
        code: "PAYLOAD_TOO_LARGE",
        details: { constraint: "wikiContentBytes", limit: CONTENT_LIMIT },
      }),
    );
  });

  it("measures the size in bytes, not in characters", () => {
    const content = "ä".repeat(CONTENT_LIMIT / 2 + 1);

    expect(content.length).toBeLessThan(CONTENT_LIMIT);
    expect(() => readAgentWikiCreate({ ...base, content })).toThrow(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE" }),
    );
  });
});

describe("agent wiki move scope and revision spelling", () => {
  const move = {
    operationId: "move-1",
    pageId: "page-1",
    expectedRevision: 1,
    projectId: null,
    parentId: null,
    beforeId: null,
  };

  it.each(["instance", "private"] as const)(
    "moves a page without project into the %s scope",
    (scope) => {
      expect(readAgentWikiMove({ ...move, scope })).toEqual({
        ...move,
        scope,
      });
    },
  );

  it.each(["project", undefined, "team", 1, null])(
    "refuses a move without project for the scope %j",
    (scope) => {
      expect(() => readAgentWikiMove({ ...move, scope })).toThrow(
        expect.objectContaining({ code: "INVALID_REQUEST" }),
      );
    },
  );

  it("refuses an unknown scope even when a project is named", () => {
    expect(() =>
      readAgentWikiMove({ ...move, projectId: "alpha", scope: "team" }),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
    expect(
      readAgentWikiMove({ ...move, projectId: "alpha", scope: "project" }),
    ).toMatchObject({ projectId: "alpha", scope: "project" });
  });

  it("reads the specified snake-case revision and refuses both spellings together", () => {
    expect(normalizeRevision({ expected_revision: 3, title: "T" })).toEqual({
      expectedRevision: 3,
      title: "T",
    });
    expect(() =>
      normalizeRevision({ expected_revision: 3, expectedRevision: 3 }),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
    expect(
      readAgentWikiFieldChange("wiki.page.setTitle", {
        operationId: "title-1",
        pageId: "page-1",
        expected_revision: 2,
        title: "New",
      }),
    ).toEqual({
      operationId: "title-1",
      pageId: "page-1",
      expectedRevision: 2,
      field: "title",
      value: "New",
    });
    expect(() =>
      readAgentWikiMove({
        ...move,
        expected_revision: 1,
        projectId: "alpha",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});

describe("agent wiki page read anchors", () => {
  const actor = createUser();
  const page = {
    id: "page-1",
    title: "Page",
    content: "# Page",
    revision: 4,
    parentId: null,
    scope: "project",
    projectId: "p1",
  };

  it("reports no anchors when the service has no anchor repository", async () => {
    const reads = {
      readWithoutVisit: vi.fn().mockResolvedValue(page),
      visibleNodes: vi.fn(),
    };

    expect(
      await new AgentWikiReadService(reads, { search: vi.fn() }).read(
        actor,
        "page-1",
      ),
    ).toEqual({ ...page, anchors: [] });
  });

  it("reports the stored anchors of the page when a repository is given", async () => {
    const anchor = { kind: "milestone", targetId: "m-1" };
    const findAnchors = vi.fn().mockResolvedValue([anchor]);
    const service = new AgentWikiReadService(
      {
        readWithoutVisit: vi.fn().mockResolvedValue(page),
        visibleNodes: vi.fn(),
      },
      { search: vi.fn() },
      { findAnchors },
    );

    expect(await service.read(actor, "page-1")).toMatchObject({
      anchors: [anchor],
    });
    expect(findAnchors).toHaveBeenCalledExactlyOnceWith("page-1");
  });

  it("reports a hidden page like a missing one and refuses an oversized page", async () => {
    const hidden = new AgentWikiReadService(
      {
        readWithoutVisit: vi
          .fn()
          .mockRejectedValue(new WikiPageNotFoundError()),
        visibleNodes: vi.fn(),
      },
      { search: vi.fn() },
    );
    const oversized = new AgentWikiReadService(
      {
        readWithoutVisit: vi.fn().mockResolvedValue({
          ...page,
          content: "a".repeat(CONTENT_LIMIT + 1),
        }),
        visibleNodes: vi.fn(),
      },
      { search: vi.fn() },
    );

    await expect(hidden.read(actor, "page-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(oversized.read(actor, "page-1")).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});

describe("agent wiki search location", () => {
  const actor = createUser();

  it.each([
    [undefined, null],
    ["p1", "project:p1"],
  ])("searches project %j in the location %j", async (projectId, location) => {
    const search = vi.fn().mockResolvedValue({ results: [], total: 0 });
    const service = new AgentWikiReadService(
      { readWithoutVisit: vi.fn(), visibleNodes: vi.fn() },
      { search },
    );

    expect(await service.search(actor, "plan", projectId)).toMatchObject({
      results: [],
      total: 0,
    });
    expect(search).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ text: "plan", location }),
      Number.MAX_SAFE_INTEGER,
    );
  });
});

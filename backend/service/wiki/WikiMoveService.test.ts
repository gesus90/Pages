import { expect, it, vi } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { WikiMoveService } from "./WikiMoveService";

import type {
  WikiPageRecord,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAccess, WikiViewer } from "./WikiAccess";
import type { MoveWikiPageInput } from "./WikiMoveService";

const ACTOR = { id: "u1" } as unknown as User;

function viewerOf(overrides: Partial<WikiViewer> = {}): WikiViewer {
  return {
    canManageProjects: false,
    canWrite: true,
    scope: {
      departmentIds: [],
      isAdmin: false,
      projectIds: ["pr1", "pr2"],
      userId: "u1",
    },
    user: ACTOR,
    ...overrides,
  };
}

function pageOf(overrides: Partial<WikiPageRecord> = {}): WikiPageRecord {
  return {
    id: "p1",
    isTemplate: false,
    ownerId: "u1",
    parentId: null,
    projectId: null,
    scope: "instance",
    ...overrides,
  } as unknown as WikiPageRecord;
}

interface Doubles {
  readonly service: WikiMoveService;
  readonly repository: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
}

function serviceOf(
  options: {
    readonly page?: WikiPageRecord | null;
    readonly parent?: WikiPageRecord | null;
    readonly viewer?: WikiViewer;
    readonly siblings?: string[];
    readonly subtree?: string[];
    readonly levelsBelow?: number;
    readonly anchors?: Record<string, { kind: string; targetId: string }[]>;
  } = {},
): Doubles {
  const page = options.page === undefined ? pageOf() : options.page;
  const parent = options.parent ?? pageOf({ id: "parent" });
  const repository: Doubles["repository"] = {
    activity: { insert: vi.fn(async () => {}) },
    anchors: {
      findAnchors: vi.fn(async (id: string) => options.anchors?.[id] ?? []),
      removeAnchorsOfSubtree: vi.fn(async () => {}),
    },
    pages: {
      countLevelsAbove: vi.fn(async () => 0),
      countLevelsBelow: vi.fn(async () => options.levelsBelow ?? 0),
      findBreadcrumb: vi.fn(async (id: string) =>
        id === "child" ? [{ id: "grand" }] : [],
      ),
      findSubtreeIds: vi.fn(async () => options.subtree ?? ["p1"]),
      findVisible: vi.fn(async (scope: unknown, id: string) =>
        id === "p1" ? page : parent,
      ),
    },
    writes: {
      applyScopeToDescendants: vi.fn(async () => {}),
      findSiblingIds: vi.fn(async () => options.siblings ?? ["a", "b", "p1"]),
      place: vi.fn(async () => {}),
      writePositions: vi.fn(async () => {}),
    },
  };
  const wikiRepository = {
    ...repository,
    transaction: vi.fn(async (work: (r: unknown) => Promise<unknown>) =>
      work(wikiRepository),
    ),
  };
  const access = {
    resolve: vi.fn(async () => options.viewer ?? viewerOf()),
  } as unknown as WikiAccess;

  return {
    repository,
    service: new WikiMoveService(
      wikiRepository as unknown as WikiRepository,
      access,
    ),
  };
}

function inputOf(
  overrides: Partial<MoveWikiPageInput> = {},
): MoveWikiPageInput {
  return {
    beforeId: null,
    parentId: null,
    projectId: null,
    scope: "instance",
    ...overrides,
  };
}

it("appends a moved page and records no second activity without project", async () => {
  const { service, repository } = serviceOf();

  await service.move(ACTOR, "p1", inputOf());

  expect(repository.writes?.writePositions).toHaveBeenCalledWith([
    "a",
    "b",
    "p1",
  ]);
  expect(repository.activity?.insert).not.toHaveBeenCalled();
  expect(repository.anchors?.removeAnchorsOfSubtree).not.toHaveBeenCalled();
});

it("places a page before a sibling", async () => {
  const { service, repository } = serviceOf();

  await service.move(ACTOR, "p1", inputOf({ beforeId: "b" }));

  expect(repository.writes?.writePositions).toHaveBeenCalledWith([
    "a",
    "p1",
    "b",
  ]);
});

it("rejects an unknown sibling position", async () => {
  const { service } = serviceOf();

  await expect(
    service.move(ACTOR, "p1", inputOf({ beforeId: "zzz" })),
  ).rejects.toThrow(WikiValidationError);
});

it("drops project anchors and records activity when the project changes", async () => {
  const { service, repository } = serviceOf({
    page: pageOf({ projectId: "pr1", scope: "project" }),
  });

  await service.move(
    ACTOR,
    "p1",
    inputOf({ projectId: "pr2", scope: "project" }),
  );

  expect(repository.anchors?.removeAnchorsOfSubtree).toHaveBeenCalledWith(
    "p1",
    ["milestone", "epic"],
  );
  expect(repository.activity?.insert).toHaveBeenCalledTimes(2);
});

it("keeps anchors when the project stays", async () => {
  const { service, repository } = serviceOf({
    page: pageOf({ projectId: "pr1", scope: "project" }),
  });

  await service.move(
    ACTOR,
    "p1",
    inputOf({ projectId: "pr1", scope: "project" }),
  );

  expect(repository.anchors?.removeAnchorsOfSubtree).not.toHaveBeenCalled();
  expect(repository.activity?.insert).toHaveBeenCalledTimes(1);
});

it("removes every anchor of a page moved into the private area", async () => {
  const { service, repository } = serviceOf();

  await service.move(ACTOR, "p1", inputOf({ scope: "private" }));

  expect(repository.anchors?.removeAnchorsOfSubtree).toHaveBeenCalledWith(
    "p1",
    expect.arrayContaining(["milestone", "epic"]),
  );
});

it("rejects a missing page, a reader without write rights and a stranger", async () => {
  await expect(
    serviceOf({ page: null }).service.move(ACTOR, "p1", inputOf()),
  ).rejects.toThrow(WikiPageNotFoundError);
  await expect(
    serviceOf({ viewer: viewerOf({ canWrite: false }) }).service.move(
      ACTOR,
      "p1",
      inputOf(),
    ),
  ).rejects.toThrow(WikiAccessDeniedError);
  await expect(
    serviceOf({
      page: pageOf({ ownerId: "other", scope: "private" }),
    }).service.move(ACTOR, "p1", inputOf()),
  ).rejects.toThrow(WikiAccessDeniedError);
});

it("rejects a target below the page itself", async () => {
  const { service } = serviceOf({ subtree: ["p1", "parent"] });

  await expect(
    service.move(ACTOR, "p1", inputOf({ parentId: "parent" })),
  ).rejects.toThrow(WikiValidationError);
});

it("rejects the private area for pages of other people", async () => {
  const { service } = serviceOf({
    page: pageOf({ ownerId: "other", scope: "instance" }),
    viewer: viewerOf({
      scope: { ...viewerOf().scope, isAdmin: true },
    }),
  });

  await expect(
    service.move(ACTOR, "p1", inputOf({ scope: "private" })),
  ).rejects.toThrow(WikiValidationError);
});

it("rejects a tree that gets too deep", async () => {
  const { service } = serviceOf({ levelsBelow: 10 });

  await expect(service.move(ACTOR, "p1", inputOf())).rejects.toThrow(
    WikiValidationError,
  );
});

it("previews a change of scope without moving", async () => {
  const { service, repository } = serviceOf();

  await expect(
    service.preview(ACTOR, "p1", inputOf({ scope: "private" })),
  ).resolves.toBe("narrower");
  expect(repository.writes?.place).not.toHaveBeenCalled();
});

it("previews a move without change when no anchors differ", async () => {
  const { service } = serviceOf();

  await expect(service.preview(ACTOR, "p1", inputOf())).resolves.toBe("same");
});

it("previews the anchors inherited from the new parent", async () => {
  const { service } = serviceOf({
    anchors: { parent: [{ kind: "epic", targetId: "e" }] },
  });

  await expect(
    service.preview(ACTOR, "p1", inputOf({ parentId: "parent" })),
  ).resolves.toBe("narrower");
});

it("previews the anchors inherited through the breadcrumb", async () => {
  const { service } = serviceOf({
    anchors: { grand: [{ kind: "milestone", targetId: "m" }] },
    page: pageOf({ parentId: "child" }),
    parent: pageOf({ id: "parent" }),
  });

  await expect(
    service.preview(ACTOR, "p1", inputOf({ parentId: "parent" })),
  ).resolves.toBe("wider");
});

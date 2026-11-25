import { beforeEach, expect, it, vi } from "vitest";

import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { OperationReusedError } from "@/backend/service/InterfaceOperationJournal";

import { validateAnchors } from "./WikiAnchorValidator";
import { syncMentions } from "./WikiMentions";
import { WikiPageService } from "./WikiPageService";

import type {
  WikiPageRecord,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type {
  CreateWikiPageInput,
  UpdateWikiPageInput,
} from "./WikiPageService";
import type { WikiAccess, WikiViewer } from "./WikiAccess";

vi.mock("./WikiAnchorValidator", () => ({
  validateAnchors: vi.fn(async (...call: readonly unknown[]) => call[3]),
}));
vi.mock("./WikiMentions", () => ({ syncMentions: vi.fn(async () => {}) }));

const actor = { id: "u1" } as unknown as User;

function viewerOf(overrides: Partial<WikiViewer> = {}): WikiViewer {
  return {
    canManageProjects: false,
    canWrite: true,
    scope: {
      departmentIds: [],
      isAdmin: false,
      projectIds: ["p1"],
      userId: "u1",
    },
    user: actor,
    ...overrides,
  };
}

function accessOf(viewer: WikiViewer): WikiAccess {
  return { resolve: vi.fn(async () => viewer) } as unknown as WikiAccess;
}

function pageOf(overrides: Partial<WikiPageRecord> = {}): WikiPageRecord {
  return {
    content: "text",
    cover: null,
    icon: null,
    id: "page",
    isTemplate: false,
    ownerId: "u1",
    parentId: null,
    projectId: null,
    revision: 1,
    scope: "instance",
    title: "Title",
    updatedByName: null,
    ...overrides,
  } as unknown as WikiPageRecord;
}

interface KeyRow {
  readonly fingerprint: string;
  readonly operation: string;
  readonly resultJson: string;
}

function fixture(
  pages: readonly WikiPageRecord[] = [pageOf()],
  fallback: WikiPageRecord | null = null,
): {
  readonly parts: {
    readonly [key: string]: Record<string, ReturnType<typeof vi.fn>>;
  };
  readonly repository: WikiRepository;
} {
  const keys = new Map<string, KeyRow>();
  const store = new Map(pages.map((page) => [page.id, page]));
  const parts = {
    activity: { insert: vi.fn(async () => {}) },
    anchors: {
      findAnchors: vi.fn(async () => [
        { kind: "epic", label: "Epic", targetId: "e1" },
        { kind: "epic", label: null, targetId: "e2" },
      ]),
      replaceAnchors: vi.fn(async () => {}),
    },
    links: { replace: vi.fn(async () => {}) },
    lookups: { isActiveUser: vi.fn(async () => true) },
    operations: {
      find: vi.fn(async (...call: readonly [string, string]) =>
        keys.get(call[1]),
      ),
      insert: vi.fn(async (...call: readonly [string, string, KeyRow]) => {
        keys.set(call[1], call[2]);
      }),
      removeOlder: vi.fn(async () => {}),
    },
    pages: {
      countLevelsAbove: vi.fn(async () => 0),
      findBreadcrumb: vi.fn(async () => []),
      findVisible: vi.fn(
        async (...call: readonly [unknown, string]) =>
          store.get(call[1]) ?? fallback,
      ),
      listNodes: vi.fn(async () => []),
    },
    versions: {
      find: vi.fn(async () => null),
      save: vi.fn(async () => {}),
    },
    writes: {
      insert: vi.fn(async () => {}),
      nextPosition: vi.fn(async () => 3),
      saveEdit: vi.fn(async () => 2),
      setCurrentUntil: vi.fn(async () => {}),
      setOwner: vi.fn(async () => {}),
      storedTextForm: vi.fn(async (text: string) => text.replace("\u0000", "")),
    },
  };
  const repository = {
    ...parts,
    transaction: async (
      work: (inner: WikiRepository) => Promise<unknown>,
    ): Promise<unknown> => work(repository),
  } as unknown as WikiRepository;

  return { parts, repository };
}

function serviceOf(
  repository: WikiRepository,
  viewer: WikiViewer = viewerOf(),
): WikiPageService {
  return new WikiPageService(repository, accessOf(viewer));
}

const createInput: CreateWikiPageInput = {
  anchors: [{ kind: "epic", targetId: "e1" }],
  content: "see /wiki/other",
  icon: null,
  isTemplate: false,
  parentId: null,
  projectId: null,
  scope: "instance",
  templateId: null,
  title: " New ",
};

const updateInput: UpdateWikiPageInput = {
  content: "changed",
  expectedRevision: 1,
  icon: null,
  title: "Title",
};

beforeEach(() => {
  vi.mocked(validateAnchors).mockClear();
  vi.mocked(syncMentions).mockClear();
});

it("refuses to write without the capability", async () => {
  const { repository } = fixture();
  const service = serviceOf(repository, viewerOf({ canWrite: false }));

  await expect(service.create(actor, createInput)).rejects.toBeInstanceOf(
    WikiAccessDeniedError,
  );
});

it("creates an instance page and syncs mentions", async () => {
  const { parts, repository } = fixture([], pageOf());

  await serviceOf(repository).create(actor, createInput);

  expect(parts.writes?.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      authorId: "u1",
      content: "see /wiki/other",
      scope: "instance",
      title: "New",
    }),
    3,
  );
  expect(parts.anchors?.replaceAnchors).toHaveBeenCalledWith(
    expect.any(String),
    createInput.anchors,
  );
  expect(parts.links?.replace).toHaveBeenCalledWith(expect.any(String), {
    pageIds: ["other"],
    ticketKeys: [],
  });
  expect(syncMentions).toHaveBeenCalledTimes(1);
  expect(parts.activity?.insert).not.toHaveBeenCalled();
});

it("creates a private project page without mentions", async () => {
  const { parts, repository } = fixture([], pageOf({ projectId: "p1" }));

  await serviceOf(repository).create(actor, {
    ...createInput,
    anchors: [],
    projectId: "p1",
    scope: "private",
  });

  expect(syncMentions).not.toHaveBeenCalled();
  expect(parts.activity?.insert).toHaveBeenCalledWith(
    expect.objectContaining({ action: "wiki_page_created", projectId: "p1" }),
  );
});

it("copies text and icon of a template", async () => {
  const { parts, repository } = fixture(
    [
      pageOf({
        content: "from template",
        icon: "😀",
        id: "tpl",
        isTemplate: true,
      }),
    ],
    pageOf(),
  );

  await serviceOf(repository).create(actor, {
    ...createInput,
    templateId: "tpl",
  });

  expect(parts.writes?.insert).toHaveBeenCalledWith(
    expect.objectContaining({ content: "from template", icon: "😀" }),
    3,
  );
});

it("rejects a missing template and a page that is no template", async () => {
  const { repository } = fixture([pageOf({ id: "plain" })]);
  const service = serviceOf(repository);

  for (const templateId of ["none", "plain"]) {
    await expect(
      service.create(actor, { ...createInput, templateId }),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  }
});

it("saves an edit, records what changed and its operation", async () => {
  const { parts, repository } = fixture([
    pageOf({ content: "old [t](/wiki/a)", icon: "😀", projectId: "p1" }),
  ]);

  const saved = await serviceOf(repository).update(actor, "page", {
    ...updateInput,
    icon: null,
    operationId: "op1",
    title: "Other",
  });

  expect(saved.id).toBe("page");
  expect(parts.writes?.saveEdit).toHaveBeenCalledWith(
    "page",
    expect.objectContaining({ editorId: "u1", title: "Other" }),
    1,
  );
  expect(parts.versions?.save).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 2 }),
    10,
  );
  expect(
    parts.activity?.insert.mock.calls.map(([entry]) => entry.action),
  ).toEqual([
    "wiki_title_changed",
    "wiki_content_changed",
    "wiki_icon_changed",
    "wiki_links_changed",
  ]);
  expect(parts.operations?.insert).toHaveBeenCalledTimes(1);
});

it("adds a version for every save when coalescing is off", async () => {
  const { parts, repository } = fixture([pageOf({ scope: "private" })]);

  await serviceOf(repository).update(actor, "page", {
    ...updateInput,
    coalesceVersions: false,
  });

  expect(parts.versions?.save).toHaveBeenCalledWith(expect.anything(), 0);
  expect(syncMentions).not.toHaveBeenCalled();
});

it("answers a repeated operation without saving again", async () => {
  const { parts, repository } = fixture();
  const service = serviceOf(repository);
  const input = { ...updateInput, operationId: "op1" };

  await service.update(actor, "page", input);
  parts.writes?.saveEdit.mockClear();

  const replayed = await service.update(actor, "page", input);

  expect(replayed).toMatchObject({ content: "changed", revision: 1 });
  expect(parts.writes?.saveEdit).not.toHaveBeenCalled();
});

it("rejects an operation ID used for another save", async () => {
  const { parts, repository } = fixture();

  parts.operations?.find.mockResolvedValue({
    fingerprint: "other",
    operation: "ui.wiki.save",
    resultJson: "{}",
  });

  await expect(
    serviceOf(repository).update(actor, "page", {
      ...updateInput,
      operationId: "op1",
    }),
  ).rejects.toBeInstanceOf(OperationReusedError);
});

it("reports a conflict for a stale revision", async () => {
  const { repository } = fixture([pageOf({ revision: 3 })]);

  await expect(
    serviceOf(repository).update(actor, "page", updateInput),
  ).rejects.toBeInstanceOf(WikiConflictError);
});

it("accepts a stale revision that leaves the page as stored", async () => {
  const { parts, repository } = fixture([
    pageOf({ content: "changed", revision: 3 }),
  ]);

  const saved = await serviceOf(repository).update(actor, "page", updateInput);

  expect(saved.revision).toBe(3);
  expect(parts.writes?.saveEdit).not.toHaveBeenCalled();
});

it("compares texts with U+0000 in their stored form", async () => {
  const { parts, repository } = fixture([
    pageOf({ content: "ab", revision: 3, title: "Tt" }),
  ]);

  await serviceOf(repository).update(actor, "page", {
    ...updateInput,
    content: "a\u0000b",
    title: "T\u0000t",
  });

  expect(parts.writes?.storedTextForm).toHaveBeenCalledWith("a\u0000b");
  expect(parts.writes?.saveEdit).not.toHaveBeenCalled();
});

it("takes a concurrent identical save as done", async () => {
  const { parts, repository } = fixture([pageOf()]);
  const found = parts.pages?.findVisible;

  parts.writes?.saveEdit.mockResolvedValue(0);
  found?.mockResolvedValueOnce(pageOf());
  found?.mockResolvedValueOnce(pageOf({ content: "changed", revision: 2 }));

  const saved = await serviceOf(repository).update(actor, "page", updateInput);

  expect(saved.revision).toBe(2);
});

it("reports a conflict when a concurrent save differs", async () => {
  const { parts, repository } = fixture([pageOf()]);

  parts.writes?.saveEdit.mockResolvedValue(0);

  await expect(
    serviceOf(repository).update(actor, "page", updateInput),
  ).rejects.toBeInstanceOf(WikiConflictError);
});

it("restores an earlier version", async () => {
  const { parts, repository } = fixture([pageOf({ icon: "😀" })]);

  parts.versions?.find.mockResolvedValue({ content: "old", title: "Old" });
  await serviceOf(repository).restoreVersion(actor, "page", "v1");

  expect(parts.writes?.saveEdit).toHaveBeenCalledWith(
    "page",
    expect.objectContaining({ content: "old", icon: "😀", title: "Old" }),
    1,
  );
  expect(parts.versions?.save).toHaveBeenCalledWith(expect.anything(), 0);
});

it("rejects a missing version", async () => {
  const { repository } = fixture();

  await expect(
    serviceOf(repository).restoreVersion(actor, "page", "v1"),
  ).rejects.toBeInstanceOf(WikiValidationError);
});

it("replaces the anchors of a managed page", async () => {
  const { parts, repository } = fixture();
  const anchors = [{ kind: "epic" as const, targetId: "e1" }];

  await serviceOf(repository).setAnchors(actor, "page", anchors);

  expect(parts.anchors?.replaceAnchors).toHaveBeenCalledWith("page", anchors);
});

it("refuses to manage a page of somebody else", async () => {
  const { repository } = fixture([pageOf({ ownerId: "u2", scope: "private" })]);

  await expect(
    serviceOf(repository).setAnchors(actor, "page", []),
  ).rejects.toBeInstanceOf(WikiAccessDeniedError);
});

it("sets the date until which a page is current", async () => {
  const { parts, repository } = fixture();

  await serviceOf(repository).setCurrentUntil(actor, "page", "2026-05-01");

  expect(parts.writes?.setCurrentUntil).toHaveBeenCalledWith(
    "page",
    "2026-05-01",
  );
});

it("hands a page over to an active account", async () => {
  const { parts, repository } = fixture();

  await serviceOf(repository).setOwner(actor, "page", "u2");

  expect(parts.writes?.setOwner).toHaveBeenCalledWith("page", "u2");
});

it("refuses to hand over a private page or to an inactive account", async () => {
  const privateFixture = fixture([pageOf({ scope: "private" })]);
  const inactiveFixture = fixture();

  inactiveFixture.parts.lookups?.isActiveUser.mockResolvedValue(false);

  await expect(
    serviceOf(privateFixture.repository).setOwner(actor, "page", "u2"),
  ).rejects.toBeInstanceOf(WikiValidationError);
  await expect(
    serviceOf(inactiveFixture.repository).setOwner(actor, "page", "u2"),
  ).rejects.toBeInstanceOf(WikiValidationError);
});

it("duplicates a single page as a template", async () => {
  const { parts, repository } = fixture(
    [
      pageOf({ parentId: "up", projectId: "p1", scope: "project" }),
      pageOf({ id: "up" }),
    ],
    pageOf(),
  );

  await serviceOf(repository).duplicate(actor, "page", {
    isTemplate: true,
    title: "Copy",
    withChildren: false,
  });

  expect(parts.pages?.listNodes).not.toHaveBeenCalled();
  expect(parts.writes?.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      isTemplate: true,
      parentId: "up",
      title: "Copy",
    }),
    3,
  );
  expect(parts.anchors?.replaceAnchors).toHaveBeenCalledWith(
    expect.any(String),
    [{ kind: "epic", targetId: "e1" }],
  );
});

it("duplicates a page with its children and keeps their names", async () => {
  const { parts, repository } = fixture(
    [
      pageOf(),
      pageOf({ id: "child1", isTemplate: true, parentId: "page", title: "C1" }),
      pageOf({ id: "child2", parentId: "page", title: "C2" }),
    ],
    pageOf(),
  );

  parts.pages?.listNodes.mockResolvedValue([
    { id: "page", parentId: null },
    { id: "child1", parentId: "page" },
    { id: "child2", parentId: "page" },
  ]);
  await serviceOf(repository).duplicate(actor, "page", {
    isTemplate: false,
    title: "Copy",
    withChildren: true,
  });

  const inserted = parts.writes?.insert.mock.calls.map(([row]) => row);

  expect(inserted?.map((row) => row.title)).toEqual(["Copy", "C1", "C2"]);
  expect(inserted?.map((row) => row.isTemplate)).toEqual([false, true, false]);
  expect(inserted?.[1]?.parentId).toBe(inserted?.[0]?.id);
});

it("records only the title when only the title changes", async () => {
  const { parts, repository } = fixture([pageOf({ projectId: "p1" })]);

  await serviceOf(repository).update(actor, "page", {
    ...updateInput,
    content: "text",
    title: "Other",
  });

  expect(
    parts.activity?.insert.mock.calls.map(([entry]) => entry.action),
  ).toEqual(["wiki_title_changed"]);
});

import { afterEach, expect, it, vi } from "vitest";

import { WikiService } from "@/backend/service/WikiService";

import { AnnouncingWikiService } from "./AnnouncingWikiService";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { TaskEventSink } from "@/backend/service/AnnouncingTaskService";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { User } from "@/definition/User";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(): {
  readonly service: AnnouncingWikiService;
  readonly announced: PagesEvent[][];
} {
  const announced: PagesEvent[][] = [];
  const events = doubleOf<TaskEventSink>({
    announce: async (
      work: () => Promise<unknown>,
      decide: (result: never) => PagesEvent[],
    ) => {
      const result = await work();

      announced.push(decide(result as never));

      return result;
    },
    publish: vi.fn(),
  });
  const repository = doubleOf<WikiRepository>({
    attachments: {
      find: vi.fn(async (id: string) =>
        id === "known" ? { pageId: "page" } : null,
      ),
    },
    comments: {
      find: vi.fn(async (id: string) =>
        id === "known" ? { pageId: "page" } : null,
      ),
    },
  });
  const service = new AnnouncingWikiService(
    repository,
    {
      permissionService: doubleOf<PermissionService>({}),
      projectService: doubleOf<ProjectService>({}),
    },
    doubleOf<WikiFileStore>({}),
    events,
  );

  return { announced, service };
}

function stub(name: keyof WikiService, result: unknown): void {
  const prototype = doubleOf<Record<string, () => Promise<unknown>>>(
    WikiService.prototype,
  );

  vi.spyOn(prototype, name).mockResolvedValue(result);
}

const actor = doubleOf<User>({ id: "u" });

it.each([
  ["create", { id: "n" }, "wiki.page.created", "n"],
  ["duplicate", { id: "n" }, "wiki.page.created", "n"],
] as const)("announces %s", async (name, result, type, id) => {
  const { announced, service } = setup();

  stub(name, result);
  await (service[name] as (...input: unknown[]) => Promise<unknown>)(actor, {});

  expect(announced).toEqual([[{ id, type }]]);
});

it.each([
  ["update", "wiki.page.updated"],
  ["setAnchors", "wiki.page.updated"],
  ["setCover", "wiki.page.updated"],
  ["setCurrentUntil", "wiki.page.updated"],
  ["setOwner", "wiki.page.updated"],
  ["move", "wiki.page.updated"],
  ["delete", "wiki.page.updated"],
  ["restore", "wiki.page.updated"],
  ["deletePrivateAsAdministrator", "wiki.page.updated"],
  ["restoreVersion", "wiki.page.updated"],
  ["purge", "wiki.page.purged"],
  ["addComment", "wiki.comments.changed"],
  ["uploadAttachment", "wiki.page.updated"],
] as const)("announces %s for its page", async (name, type) => {
  const { announced, service } = setup();

  stub(name, undefined);
  await (service[name] as (...input: unknown[]) => Promise<unknown>)(
    actor,
    "page",
  );

  expect(announced).toEqual([[{ id: "page", type }]]);
});

it("announces the trash roots the maintenance removed", async () => {
  const { announced, service } = setup();

  stub("runMaintenance", ["a", "b"]);
  await service.runMaintenance();

  expect(announced).toEqual([
    [
      { id: "a", type: "wiki.page.purged" },
      { id: "b", type: "wiki.page.purged" },
    ],
  ]);
});

it.each(["editComment", "removeComment", "resolveComment"] as const)(
  "announces %s for the page of the comment",
  async (name) => {
    const { announced, service } = setup();
    const call = service[name] as (...input: unknown[]) => Promise<unknown>;

    stub(name, undefined);
    await call.call(service, actor, "known");
    await call.call(service, actor, "unknown");

    expect(announced).toEqual([
      [{ id: "page", type: "wiki.comments.changed" }],
      [],
    ]);
  },
);

it("announces the page of a removed attachment", async () => {
  const { announced, service } = setup();

  stub("removeAttachment", undefined);
  await service.removeAttachment(actor, "known");
  await service.removeAttachment(actor, "unknown");

  expect(announced).toEqual([[{ id: "page", type: "wiki.page.updated" }], []]);
});

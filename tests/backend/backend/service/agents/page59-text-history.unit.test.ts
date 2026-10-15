import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { TEXT_TARGETS, TextWorld } from "./page59-text-world";

let world: TextWorld;
beforeEach(() => {
  world = new TextWorld();
  world.seed("abc");
});

describe("ticket history and synchronization", () => {
  it("records the same history and synchronization as full replacement after commit", async () => {
    expect(await world.read("ticket")).toHaveProperty(
      "descriptionVersion",
      "ba7816bf8f01cfea414140de5dae2223",
    );
    const result = await world.patch(
      "ticket",
      await world.patchParameters("ticket"),
    );
    const version = createHash("sha256")
      .update("Xbc")
      .digest("hex")
      .slice(0, 32);
    expect(result).toMatchObject({
      changed: true,
      descriptionVersion: version,
    });
    expect(await world.read("ticket")).toHaveProperty(
      "descriptionVersion",
      version,
    );
    expect(
      await world.call("ticket.read", world.target("ticket")),
    ).toMatchObject({
      description: "Xbc",
      title: world.ticket.title,
      statusId: world.ticket.statusId,
      milestoneId: world.ticket.milestoneId,
    });
    await world.call("ticket.setDescription", {
      ...world.target("ticket"),
      operationId: "full-ticket",
      expectedDescription: "Xbc",
      description: "last",
    });
    expect(world.history).toMatchObject([
      {
        action: "description_changed",
        field: "description",
        oldValue: "abc",
        newValue: "Xbc",
        userId: "writer",
        workItemId: world.ticket.id,
      },
      {
        action: "description_changed",
        field: "description",
        oldValue: "Xbc",
        newValue: "last",
        userId: "writer",
        workItemId: world.ticket.id,
      },
    ]);
    expect(
      world.publish.mock.calls.map(([, ticket]) => ticket.description),
    ).toEqual(["Xbc", "last"]);
    expect(world.invalidate).toHaveBeenCalledTimes(2);
    expect(world.events).toEqual([
      { type: "ticket.updated", id: world.ticket.id },
      { type: "ticket.updated", id: world.ticket.id },
    ]);
    expect(world.activity.map(({ action }) => action)).toEqual([
      "ticket.patchDescription",
      "ticket.setDescription",
    ]);
    expect(
      await world.call("ticket.read", world.target("ticket")),
    ).toMatchObject({ description: "last" });
  });
});

describe("wiki versions and references", () => {
  it("increments revisions and keeps separate versions for patch and full replacement by the same author", async () => {
    const revision = world.page.revision;
    await world.patch("wiki", await world.patchParameters("wiki"));
    expect(
      await world.call("wiki.page.read", world.target("wiki")),
    ).toMatchObject({ content: "Xbc", revision: revision + 1 });
    await world.call("wiki.page.setContent", {
      ...world.target("wiki"),
      operationId: "full-wiki",
      expectedRevision: revision + 1,
      content: "last",
    });
    expect(world.versions).toEqual([
      {
        version: {
          pageId: world.page.id,
          content: "Xbc",
          title: world.page.title,
          revision: revision + 1,
          authorId: "writer",
        },
        coalesceMinutes: 0,
      },
      {
        version: {
          pageId: world.page.id,
          content: "last",
          title: world.page.title,
          revision: revision + 2,
          authorId: "writer",
        },
        coalesceMinutes: 0,
      },
    ]);
    expect(world.activity.map(({ action }) => action)).toEqual([
      "wiki_content_changed",
      "wiki_content_changed",
    ]);
    expect(world.events).toEqual([
      { type: "wiki.page.updated", id: world.page.id },
      { type: "wiki.page.updated", id: world.page.id },
    ]);
    expect(
      await world.call("wiki.page.read", world.target("wiki")),
    ).toMatchObject({ content: "last", revision: revision + 2 });
  });

  it("refreshes page links, ticket links and mentions through the normal save path", async () => {
    world.seed("/wiki/old");
    const replacementText = "[New](/wiki/new) [Ticket](/tasks/SYN-3) @reader";
    await world.patch(
      "wiki",
      await world.patchParameters("wiki", {
        end: { line: 1, column: 10 },
        expectedText: "/wiki/old",
        replacementText,
      }),
    );
    expect(world.links).toEqual([
      { id: world.page.id, links: { pageIds: ["new"], ticketKeys: ["SYN-3"] } },
    ]);
    expect(world.mentions).toEqual([
      {
        source: {
          pageId: world.page.id,
          commentId: "",
          authorId: "writer",
          text: replacementText,
        },
        users: [],
      },
    ]);
    expect(world.activity.map(({ action }) => action)).toEqual([
      "wiki_content_changed",
      "wiki_links_changed",
    ]);
  });
});

describe.each(TEXT_TARGETS)("%s no-op patches", (target) => {
  it("keeps revision, history, metadata and synchronization unchanged", async () => {
    const read = await world.read(target);
    const page = structuredClone(world.page);
    const ticket = structuredClone(world.ticket);
    const parameters = await world.patchParameters(target, {
      replacementText: "a",
      includeAfter: true,
    });
    expect(await world.patch(target, parameters)).toMatchObject({
      changed: false,
      after: { text: "a" },
    });
    expect(await world.read(target)).toEqual(read);
    expect(world.page).toEqual(page);
    expect(world.ticket).toEqual(ticket);
    expect([
      world.history,
      world.versions,
      world.activity,
      world.events,
      world.links,
      world.mentions,
    ]).toEqual([[], [], [], [], [], []]);
    expect(world.publish).not.toHaveBeenCalled();
    expect(world.invalidate).not.toHaveBeenCalled();
    expect(world.keys.size).toBe(1);
  });
});

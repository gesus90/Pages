import { expect, it, vi } from "vitest";

import {
  createTicketVisibility,
  escapeLike,
  WikiLinkRepository,
} from "./WikiLinkRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { WikiVisibilityScope } from "@/definition/Wiki";

const scope: WikiVisibilityScope = {
  userId: "viewer",
  isAdmin: false,
  projectIds: ["project"],
  departmentIds: ["department"],
};

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);

  return { database: { execute, query }, execute, query };
}

it("escapes LIKE wildcards", () => {
  expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
});

it("limits ticket visibility to the departments of a non-administrator", () => {
  const plain = createTicketVisibility(scope);
  const admin = createTicketVisibility({ ...scope, isAdmin: true });

  expect(plain.parameters).not.toEqual(admin.parameters);
  expect(JSON.stringify(plain.parameters)).toContain("department");
  expect(JSON.stringify(admin.parameters)).not.toContain("department");
});

it("replaces the links and skips a link to the page itself", async () => {
  const { database, execute } = databaseOf();

  await new WikiLinkRepository(database).replace("page", {
    pageIds: ["page", "other"],
    ticketKeys: ["KEY-1"],
  });

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("INSERT INTO wiki_page_links"),
    { page_id: "page", target_id: "other", target_kind: "page" },
  );
  expect(execute).toHaveBeenNthCalledWith(3, expect.any(String), {
    page_id: "page",
    target_id: "KEY-1",
    target_kind: "ticket",
  });
});

it("finds the pages that link to a page", async () => {
  const row: DatabaseValue[] = [
    "id",
    "Title",
    null,
    "instance",
    null,
    null,
    null,
    "owner",
    "Owner",
    null,
    "u",
    "c",
  ];
  const { database, query } = databaseOf([row]);

  const pages = await new WikiLinkRepository(database).findLinkingPages(
    scope,
    "target",
  );

  expect(pages).toHaveLength(1);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("link.target_kind = 'page'"),
    expect.objectContaining({ target_id: "target" }),
  );
});

it("finds tickets and projects that mention an address", async () => {
  const tickets = databaseOf([["id", "Title", "KEY-1", "text"]]);
  const projects = databaseOf([["id", "Name", "text"]]);

  await expect(
    new WikiLinkRepository(tickets.database).findTicketsMentioning(
      scope,
      "/wiki/a_b",
    ),
  ).resolves.toEqual([
    { id: "id", title: "Title", key: "KEY-1", description: "text" },
  ]);
  await expect(
    new WikiLinkRepository(projects.database).findProjectsMentioning(
      scope,
      "/wiki/x",
    ),
  ).resolves.toEqual([{ id: "id", name: "Name", description: "text" }]);
  expect(tickets.query).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ needle: "%/wiki/a\\_b%" }),
  );
  expect(projects.query).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ project_0: "project" }),
  );
});

it("searches tickets with a truncated limit", async () => {
  const { database, query } = databaseOf([["KEY-1", "Title"]]);

  await expect(
    new WikiLinkRepository(database).searchTickets(scope, "ti", 5.9),
  ).resolves.toEqual([{ key: "KEY-1", title: "Title" }]);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("LIMIT 5;"),
    expect.objectContaining({ pattern: "%ti%" }),
  );
});

it("reads the summaries of ticket links", async () => {
  const { database } = databaseOf([
    ["KEY-1", "Title", "open", "Open", null, "Milestone"],
  ]);

  await expect(
    new WikiLinkRepository(database).findTicketSummaries(scope, ["KEY-1"]),
  ).resolves.toEqual([
    {
      key: "KEY-1",
      title: "Title",
      statusKey: "open",
      statusName: "Open",
      assigneeName: null,
      milestoneName: "Milestone",
    },
  ]);
});

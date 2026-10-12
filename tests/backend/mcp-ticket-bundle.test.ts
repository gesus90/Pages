import { readFileSync, writeFileSync } from "node:fs";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  BundleClient,
  buildBundle,
  removeBundle,
  startPagesListener,
} from "../helpers/mcp-bundle";
import { listOf, textOf, useTicketHarness } from "../helpers/mcp-tickets";

import type { BuiltBundle } from "../helpers/mcp-bundle";
import type { TicketHarness } from "../helpers/mcp-tickets";

const setup = useTicketHarness();
const README = readFileSync(
  new URL("../../mcp/README.md", import.meta.url),
  "utf8",
);
const SECTION = README.split(
  "## Ticket search, hierarchy, links and assignment (PAGE-16)",
)[1]?.split("\n## ")[0];

/** The tools PAGE-16 adds or changes, in the order a client uses them. */
const PAGE_16_TOOLS = [
  "search_tickets",
  "read_ticket_tree",
  "read_ticket_links",
  "search_assignment_targets",
  "add_ticket_link",
  "remove_ticket_link",
];
const RELATED_TOOLS = [
  "create_ticket",
  "set_ticket_parent",
  "set_ticket_assignee",
  "read_ticket",
];

let bundle: BuiltBundle;

beforeAll(async () => {
  bundle = await buildBundle();
}, 90_000);

afterAll(async () => {
  await removeBundle(bundle);
});

/** The bundle as the tool list and the protocol log of one run. */
interface Session {
  readonly harness: TicketHarness;
  readonly clients: BundleClient[];
  readonly log: Record<string, unknown>[];
  readonly close: () => Promise<void>;
  as(userId: string): Promise<Client>;
}

/** One person's view of the bundle that records every call. */
interface Client {
  call(
    name: string,
    parameters?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  raw: BundleClient;
}

async function openSession(): Promise<Session> {
  const harness = await setup();
  const listener = await startPagesListener(harness);
  const clients: BundleClient[] = [];
  const log: Record<string, unknown>[] = [];
  return {
    harness,
    clients,
    log,
    close: async () => {
      for (const client of clients) await client.close();
      await listener.close();
    },
    as: async (userId) => {
      const token = harness.tokens.get(userId);
      if (token === undefined) throw new Error(`No token for ${userId}.`);
      const raw = await BundleClient.connect(bundle, listener.url, token);
      clients.push(raw);
      return {
        raw,
        call: async (name, parameters = {}) => {
          const result = await raw.call(name, parameters);
          log.push({ as: userId, tool: name, arguments: parameters, result });
          return result;
        },
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextOperation(): string {
  return `e2e-${String(Date.now())}-${String(Math.random()).slice(2, 10)}`;
}

function keys(result: Record<string, unknown>, field: string): string[] {
  return listOf(result, field).map((entry) => textOf(entry, "key"));
}

it("lists the PAGE-16 tools in the built bundle, with schemas that match the README", async () => {
  const session = await openSession();
  try {
    const client = await session.as("writer");
    const reply = await client.raw.request("tools/list");
    const tools = reply.result?.tools;
    if (!Array.isArray(tools)) throw new Error("No tool list.");
    const byName = new Map<string, unknown>();
    for (const tool of tools)
      if (isRecord(tool)) byName.set(textOf(tool, "name"), tool);

    for (const name of [...PAGE_16_TOOLS, ...RELATED_TOOLS]) {
      const tool = byName.get(name);
      expect(tool, name).toMatchObject({
        description: expect.stringMatching(/.{100,}/s),
        inputSchema: { type: "object", additionalProperties: false },
      });
    }
    // The tools of this task are documented under their names, and only those.
    for (const name of PAGE_16_TOOLS) expect(SECTION).toContain(`\`${name}\``);
    const documented = [
      ...(SECTION ?? "").matchAll(
        /^\| `([a-z_]+)`\s+\| `[a-z]+(?:\.[A-Za-z]+)+`/gm,
      ),
    ].map((match) => match[1]);
    expect(documented.sort()).toEqual([...PAGE_16_TOOLS].sort());
    for (const name of documented)
      expect([...byName.keys()], name).toContain(name);

    expect(byName.get("search_tickets")).toMatchObject({
      inputSchema: { required: ["projectId"] },
    });
    expect(byName.get("add_ticket_link")).toMatchObject({
      inputSchema: {
        required: ["operationId", "ticketId", "targetTicketId", "linkType"],
      },
    });
    // The project and the milestone may be left out of a create call.
    expect(byName.get("create_ticket")).toMatchObject({
      inputSchema: {
        required: [
          "operationId",
          "type",
          "title",
          "description",
          "statusId",
          "parentId",
        ],
        properties: {
          projectId: expect.anything(),
          milestoneId: expect.anything(),
          departmentId: expect.anything(),
          assignee: expect.anything(),
        },
      },
    });
    expect(README).toContain("`assignee`");
  } finally {
    await session.close();
  }
}, 60_000);

it("finds, reads, creates, moves, links, assigns and reads back through the built bundle over stdio", async () => {
  const session = await openSession();
  try {
    const owner = await session.as("owner");
    const writer = await session.as("writer");
    const manager = await session.as("manager");

    // A project the owner prepared: initiative > two epics > a task.
    const milestone = textOf(
      await owner.call("create_milestone", {
        operationId: nextOperation(),
        projectId: "p1",
        name: "Release 1",
        description: "",
        startAt: null,
        dueAt: null,
      }),
      "milestoneId",
    );
    const create = async (
      client: Client,
      fields: Record<string, unknown>,
    ): Promise<{ id: string; key: string }> => {
      const result = await client.call("create_ticket", {
        operationId: nextOperation(),
        description: "",
        statusId: null,
        parentId: null,
        ...fields,
      });
      return { id: textOf(result, "ticketId"), key: textOf(result, "key") };
    };
    const initiative = await create(owner, {
      projectId: "p1",
      type: "initiative",
      title: "Launch plan",
    });
    const backend = await create(owner, {
      type: "epic",
      title: "Backend work",
      parentId: initiative.id,
      milestoneId: milestone,
      departmentId: "alpha",
    });
    const docs = await create(owner, {
      type: "epic",
      title: "Documentation",
      parentId: initiative.id,
    });
    const apiDocs = await create(owner, {
      type: "task",
      title: "Write API docs",
      description: "Describes the search endpoint of the service.",
      parentId: docs.id,
    });
    const secret = await create(owner, {
      projectId: "p1",
      type: "task",
      title: "Backend salary review",
      departmentId: "beta",
    });

    // 1. Search: by title, by description and by key; hidden tickets stay out.
    const byTitle = await writer.call("search_tickets", {
      projectId: "p1",
      text: "backend",
    });
    expect(keys(byTitle, "tickets")).toEqual([backend.key]);
    expect(byTitle).toMatchObject({ total: 1, nextCursor: null });
    const byDescription = await writer.call("search_tickets", {
      projectId: "p1",
      text: "SEARCH ENDPOINT",
    });
    expect(keys(byDescription, "tickets")).toEqual([apiDocs.key]);
    expect(listOf(byDescription, "tickets")[0]).toMatchObject({
      snippet: expect.stringContaining("search endpoint"),
    });
    expect(
      keys(
        await writer.call("search_tickets", {
          projectId: "p1",
          text: backend.key,
        }),
        "tickets",
      ),
    ).toEqual([backend.key]);
    expect(
      JSON.stringify(
        await writer.call("search_tickets", { projectId: "p1", limit: 100 }),
      ),
    ).not.toContain(secret.key);

    // 2. Hierarchy and links of the chosen epic.
    const chosen = await writer.call("read_ticket_tree", {
      ticketId: backend.key,
    });
    expect(chosen).toMatchObject({
      root: { id: backend.id, parentId: initiative.id, childCount: 0 },
      total: 0,
    });
    expect(keys(chosen, "path")).toEqual([initiative.key]);
    expect(
      await writer.call("read_ticket_links", { ticketId: backend.key }),
    ).toMatchObject({ total: 0, links: [] });

    // 3. Create below the epic; everything left out comes from the parent
    // and from the person who is signed in.
    const created = await create(writer, {
      type: "task",
      title: "Implement search",
      parentId: backend.key,
    });
    expect(
      await writer.call("read_ticket", { ticketId: created.id }),
    ).toMatchObject({
      projectId: "p1",
      parentId: backend.id,
      milestoneId: milestone,
      department: { id: "alpha" },
      assignee: { id: "writer" },
    });
    const other = await create(manager, {
      type: "task",
      title: "Other work",
      parentId: backend.key,
    });
    expect(
      await manager.call("read_ticket", { ticketId: other.id }),
    ).toMatchObject({ assignee: { id: "manager" } });

    // 4. The new ticket shows below its epic with matching references.
    const below = await writer.call("read_ticket_tree", {
      ticketId: backend.id,
    });
    const nodes = listOf(below, "nodes");
    expect(nodes.map((node) => textOf(node, "key")).sort()).toEqual(
      [created.key, other.key].sort(),
    );
    for (const node of nodes)
      expect(node).toMatchObject({
        parentId: backend.id,
        parentKey: backend.key,
        depth: 2,
      });
    expect(below).toMatchObject({ root: { childCount: 2 } });

    // 5. Move it below the other epic, read the parent first.
    const before = await writer.call("read_ticket", { ticketId: created.id });
    expect(
      await writer.call("set_ticket_parent", {
        operationId: nextOperation(),
        ticketId: created.id,
        expectedParentId: before.parentId,
        parentId: docs.id,
      }),
    ).toMatchObject({ changed: true });
    expect(
      await writer.call("read_ticket", { ticketId: created.id }),
    ).toMatchObject({ parentId: docs.id, parentKey: docs.key });
    expect(
      await writer.call("read_ticket_tree", { ticketId: backend.id }),
    ).toMatchObject({ root: { childCount: 1 } });
    // A stale parent is refused and changes nothing.
    expect(
      await writer.call("set_ticket_parent", {
        operationId: nextOperation(),
        ticketId: created.id,
        expectedParentId: backend.id,
        parentId: backend.id,
      }),
    ).toMatchObject({ code: "CONFLICT" });

    // 6. A link, seen from both tickets with the same ID and the other direction.
    const linkRequest = {
      operationId: nextOperation(),
      ticketId: created.key,
      targetTicketId: apiDocs.key,
      linkType: "blocks",
    };
    const added = await writer.call("add_ticket_link", linkRequest);
    expect(added).toMatchObject({
      linkType: "blocks",
      direction: "outgoing",
      ticketId: created.id,
      linkedTicketId: apiDocs.id,
      removed: false,
    });
    expect(await writer.call("add_ticket_link", linkRequest)).toEqual(added);
    const linkId = textOf(added, "linkId");
    expect(
      listOf(
        await writer.call("read_ticket_links", { ticketId: created.id }),
        "links",
      ),
    ).toEqual([
      expect.objectContaining({
        id: linkId,
        linkType: "blocks",
        direction: "outgoing",
        ticket: expect.objectContaining({ id: apiDocs.id }),
      }),
    ]);
    expect(
      listOf(
        await manager.call("read_ticket_links", { ticketId: apiDocs.key }),
        "links",
      ),
    ).toEqual([
      expect.objectContaining({
        id: linkId,
        linkType: "blocks",
        direction: "incoming",
        ticket: expect.objectContaining({ id: created.id }),
      }),
    ]);
    for (const refused of [
      { targetTicketId: created.key, linkType: "relates_to" },
      { targetTicketId: apiDocs.key, linkType: "blocks" },
      { targetTicketId: apiDocs.key, linkType: "unknown" },
    ])
      expect(
        await writer.call("add_ticket_link", {
          operationId: nextOperation(),
          ticketId: created.key,
          ...refused,
        }),
      ).toMatchObject({
        code: refused.linkType === "blocks" ? "CONFLICT" : "INVALID_REQUEST",
      });
    // A hidden ticket cannot be the target and gives no hint that it exists.
    expect(
      await writer.call("add_ticket_link", {
        operationId: nextOperation(),
        ticketId: created.key,
        targetTicketId: secret.key,
        linkType: "relates_to",
      }),
    ).toEqual(
      await writer.call("add_ticket_link", {
        operationId: nextOperation(),
        ticketId: created.key,
        targetTicketId: "PP-9999",
        linkType: "relates_to",
      }),
    );

    // 7. Assignment: find the person by name, change from what was read.
    const targets = await writer.call("search_assignment_targets", {
      text: "manager",
      targetType: "person",
      projectId: "p1",
    });
    const person = listOf(targets, "targets").find(
      (target) => target.id === "manager",
    );
    expect(person).toMatchObject({ targetType: "person", isExactMatch: true });
    expect(
      await writer.call("set_ticket_assignee", {
        operationId: nextOperation(),
        ticketId: created.id,
        targetType: "person",
        targetId: textOf(person ?? {}, "id"),
        expectedAssigneeId: "writer",
        expectedAssigneeGroupId: null,
      }),
    ).toMatchObject({ changed: true });
    expect(
      await writer.call("read_ticket", { ticketId: created.id }),
    ).toMatchObject({ assignee: { id: "manager" }, parentId: docs.id });
    expect(
      await writer.call("set_ticket_assignee", {
        operationId: nextOperation(),
        ticketId: created.id,
        targetType: "none",
        targetId: null,
        expectedAssigneeId: "writer",
        expectedAssigneeGroupId: null,
      }),
    ).toMatchObject({ code: "CONFLICT" });

    // 8. Remove the link from the other side; both tickets read as unlinked.
    expect(
      await manager.call("remove_ticket_link", {
        operationId: nextOperation(),
        ticketId: apiDocs.key,
        linkId,
      }),
    ).toMatchObject({ linkId, removed: true });
    for (const ticketId of [created.id, apiDocs.id])
      expect(
        await writer.call("read_ticket_links", { ticketId }),
      ).toMatchObject({ total: 0, links: [] });

    // 9. The whole project: every parent reference resolves to a visible ticket.
    const project = await writer.call("read_ticket_tree", {
      projectId: "p1",
      limit: 100,
    });
    const projectNodes = listOf(project, "nodes");
    const known = new Map(
      projectNodes.map((node) => [textOf(node, "id"), node]),
    );
    expect(projectNodes).toHaveLength(6);
    for (const node of projectNodes) {
      const parentId = node.parentId;
      if (typeof parentId !== "string") continue;
      expect(known.get(parentId), textOf(node, "key")).toBeDefined();
    }
    expect(JSON.stringify(project)).not.toContain(secret.key);

    if (process.env.PAGE16_E2E_LOG)
      writeFileSync(
        process.env.PAGE16_E2E_LOG,
        `${JSON.stringify({ bundle: "built from mcp/src", calls: session.log }, null, 2)}\n`,
      );
  } finally {
    await session.close();
  }
}, 120_000);

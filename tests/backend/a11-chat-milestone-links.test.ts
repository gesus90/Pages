import { describe, expect, it } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { describeChatOperations } from "@/backend/service/chat/ChatToolCatalog";

import { chatAction, useChatHarness } from "../helpers/chat-harness";

import type { ChatHarness } from "../helpers/chat-harness";

const setup = useChatHarness();

function ticket(overrides: Readonly<Record<string, unknown>>) {
  return {
    projectId: "p1",
    description: "",
    statusId: null,
    parentId: null,
    milestoneId: null,
    ...overrides,
  };
}

function prompts(run: ChatHarness): readonly string[] {
  return run.execution.run.mock.calls.map(([input]) => input.prompt);
}

async function count(run: ChatHarness, table: string): Promise<number> {
  const rows = await run.database.query(`SELECT COUNT(*) FROM ${table};`);
  return Number(rows[0][0]);
}

async function prepare(run: ChatHarness): Promise<void> {
  const tasks = new TaskRepository(run.database);
  await tasks.insertMilestone({
    id: "m-1",
    projectId: "p1",
    name: "Release",
    description: "",
    dueAt: null,
  });
  await tasks.insertLabel({ id: "tag-1", name: "Customer", color: "#112233" });
}

describe("A11.5 AK-11: chat and agents use the same tools with the rights of the person", () => {
  it("describes the new operations for the agent", () => {
    const catalog = describeChatOperations();
    for (const operation of [
      "tags.list",
      "ticket.setTags",
      "milestone.initiative.add",
      "milestone.initiative.remove",
      "wiki.page.setAnchors",
    ])
      expect(catalog).toContain(`\`${operation}\``);
  });

  it("threads a milestone through the hierarchy and sets catalog tags as AI actions of the person", async () => {
    const run = await setup();
    await prepare(run);
    run.execution.run
      .mockResolvedValueOnce(
        chatAction("ticket.create", ticket({ type: "initiative", title: "I" })),
      )
      .mockResolvedValueOnce(
        chatAction(
          "ticket.create",
          ticket({ type: "epic", title: "E", parentId: "PAGE-1" }),
        ),
      )
      .mockResolvedValueOnce(
        chatAction(
          "ticket.create",
          ticket({ type: "task", title: "T", parentId: "PAGE-2" }),
        ),
      )
      .mockResolvedValueOnce(
        chatAction("ticket.assignMilestone", {
          ticketId: "PAGE-3",
          milestoneId: "m-1",
          expectedMilestoneId: null,
        }),
      )
      .mockResolvedValueOnce(
        chatAction("ticket.setTags", {
          ticketId: "PAGE-3",
          tagIds: ["tag-1"],
          expectedTagIds: [],
        }),
      )
      .mockResolvedValueOnce("Erledigt.");
    await run.ask("writer", "Lege die Hierarchie an und ordne sie zu.");

    expect(
      await run.database.query(
        "SELECT key, milestone_id FROM work_items ORDER BY number;",
      ),
    ).toEqual([
      ["PAGE-1", null],
      ["PAGE-2", "m-1"],
      ["PAGE-3", "m-1"],
    ]);
    expect(
      await run.database.query(
        "SELECT milestone_initiatives.milestone_id, work_items.key FROM milestone_initiatives INNER JOIN work_items ON work_items.id = milestone_initiatives.initiative_id;",
      ),
    ).toEqual([["m-1", "PAGE-1"]]);
    expect(
      await run.database.query("SELECT label_id FROM work_item_labels;"),
    ).toEqual([["tag-1"]]);
    const entries = await run.database.query(
      "SELECT action, user_id, source FROM project_activity WHERE action IN ('ticket.assignMilestone', 'ticket.setTags');",
    );
    expect([...entries].sort()).toEqual([
      ["ticket.assignMilestone", "writer", "ai"],
      ["ticket.setTags", "writer", "ai"],
    ]);
  });

  it("refuses links and tags without the right or outside the catalog and changes nothing", async () => {
    const run = await setup();
    await prepare(run);
    run.execution.run
      .mockResolvedValueOnce(
        chatAction("ticket.create", ticket({ type: "initiative", title: "I" })),
      )
      .mockResolvedValueOnce(
        chatAction("ticket.setTags", {
          ticketId: "PAGE-1",
          tagIds: ["invented"],
          expectedTagIds: [],
        }),
      )
      .mockResolvedValueOnce("Der Tag existiert nicht.");
    await run.ask("writer", "Lege eine Initiative mit einem neuen Tag an.");
    expect(prompts(run)[2]).toContain(
      'Ergebnis: {"ok":false,"error":"INVALID_REQUEST"}',
    );
    expect(await count(run, "work_item_labels")).toBe(0);
    expect(await count(run, "labels")).toBe(1);

    run.execution.run.mockReset();
    run.execution.run
      .mockResolvedValueOnce(
        chatAction("milestone.initiative.add", {
          projectId: "p1",
          milestoneId: "m-1",
          initiativeId: "PAGE-1",
        }),
      )
      .mockResolvedValueOnce(
        chatAction("ticket.setTags", {
          ticketId: "PAGE-1",
          tagIds: ["tag-1"],
          expectedTagIds: [],
        }),
      )
      .mockResolvedValueOnce("Dafür fehlt dir das Recht.");
    await run.ask("reader", "Verknüpfe die Initiative und setze den Tag.");
    const final = prompts(run)[2];
    expect(final.match(/"error":"FORBIDDEN"/gu)).toHaveLength(2);
    expect(await count(run, "milestone_initiatives")).toBe(0);
    expect(await count(run, "work_item_labels")).toBe(0);
  });
});

import { strict as assert } from "node:assert";

import { storedTextForm } from "@/backend/database/repositories/StoredTextForm";
import { WorkItemWriteRepository } from "@/backend/database/repositories/task/WorkItemWriteRepository";
import { agentTransactionScope } from "@/backend/service/agents/AgentTransactionScope";

import { withoutNul } from "./saved-order-flows";
import { call, prepare } from "./world";

import type { Database } from "@/backend/database/Database";
import type { RepositoryStep } from "./world";

const NUL = "\u0000";
const TEXT = `mit${NUL}Zeichen`;

const REPEAT_UPDATE = {
  title: "Ziel",
  description: TEXT,
  baseDescription: "Ziel",
  statusId: "status-todo",
  priority: "normal",
  assigneeId: null,
  assigneeGroupId: null,
  reporterId: "user-admin",
  parentId: null,
  milestoneId: null,
  dueAt: null,
  startAt: null,
} as const;

const FIXED_TIME = "2020-01-01 00:00:00";

/** What the row holds, with the time it was last saved compared to a fixed one. */
async function repeatRow(database: Database): Promise<unknown> {
  const rows = await database.query(
    "SELECT description, updated_at = $time FROM work_items WHERE id = 'nul-repeat';",
    { time: FIXED_TIME },
  );
  return withoutNul(rows);
}

function setRepeatRow(description: string): RepositoryStep {
  return prepare(
    "UPDATE work_items SET description = $description, updated_at = $time WHERE id = 'nul-repeat';",
    { description, time: FIXED_TIME },
  );
}

/** Saving the same text twice works, and a change by someone else stays a conflict. */
export const REPEAT_SAVE_STEPS: readonly RepositoryStep[] = [
  // The form a comparison with a stored text needs: gone only where saving removes it.
  ...(
    [
      ["storedTextForm", ({ database }) => storedTextForm(database, TEXT)],
      [
        "WorkItemWriteRepository.storedTextForm",
        ({ database }) =>
          new WorkItemWriteRepository(database).storedTextForm(TEXT),
      ],
      [
        "TaskRepository.storedTextForm",
        ({ tasks }) => tasks.storedTextForm(TEXT),
      ],
      [
        "WikiPageWriteRepository.storedTextForm",
        ({ wiki }) => wiki.writes.storedTextForm(TEXT),
      ],
    ] as const satisfies readonly (readonly [string, RepositoryStep["run"]])[]
  ).map(([name, read]) =>
    call(name, async (world) => {
      const expected =
        world.database.dialect === "postgres" ? TEXT.replaceAll(NUL, "") : TEXT;
      assert.equal(await read(world), expected);
    }),
  ),
  call("storedTextForm", ({ database }) => storedTextForm(database, "ohne")),
  prepare(`
    INSERT INTO work_items (id, project_id, key, number, type, title, description, status_id, created_by)
    VALUES ('nul-repeat', 'project-a', 'NUL-3', 3, 'task', 'Ziel', 'Ziel', 'status-todo', 'user-admin');
  `),
  ...[1, 2].map((): RepositoryStep =>
    call("WorkItemWriteRepository.updateDescription", async ({ database }) => {
      const isSaved = await new WorkItemWriteRepository(
        database,
      ).updateDescription("nul-repeat", TEXT, "Ziel");
      assert.equal(isSaved, true);
      return repeatRow(database);
    }),
  ),
  ...[1, 2].map((): RepositoryStep =>
    call("WorkItemWriteRepository.update", async ({ database }) => {
      const isSaved = await new WorkItemWriteRepository(database).update(
        "nul-repeat",
        REPEAT_UPDATE,
      );
      assert.equal(isSaved, true);
      return repeatRow(database);
    }),
  ),
  // A repeated save counts as a save: its time moves, like on DuckDB.
  call("WorkItemWriteRepository.updateDescription", async ({ database }) => {
    await database.execute(
      "UPDATE work_items SET updated_at = $time WHERE id = 'nul-repeat';",
      { time: FIXED_TIME },
    );
    await new WorkItemWriteRepository(database).updateDescription(
      "nul-repeat",
      TEXT,
      "Ziel",
    );
    return repeatRow(database);
  }),
  // Inside the transaction of a caller, as the agent API runs it.
  call("WorkItemWriteRepository.updateDescription", ({ database }) =>
    database.transaction((transaction) =>
      new WorkItemWriteRepository(
        agentTransactionScope(transaction),
      ).updateDescription("nul-repeat", TEXT, "Ziel"),
    ),
  ),
  // A real conflict: someone else saved another text. Nothing changes, not even the time.
  setRepeatRow("Fremd"),
  call("WorkItemWriteRepository.updateDescription", async ({ database }) => {
    const isSaved = await new WorkItemWriteRepository(
      database,
    ).updateDescription("nul-repeat", TEXT, "Ziel");
    assert.equal(isSaved, false);
    return repeatRow(database);
  }),
  call("WorkItemWriteRepository.update", async ({ database }) => {
    const isSaved = await new WorkItemWriteRepository(database).update(
      "nul-repeat",
      REPEAT_UPDATE,
    );
    assert.equal(isSaved, false);
    return repeatRow(database);
  }),
  call("WorkItemWriteRepository.updateDescription", ({ database }) =>
    database.transaction(async (transaction) => {
      const isSaved = await new WorkItemWriteRepository(
        agentTransactionScope(transaction),
      ).updateDescription("nul-repeat", TEXT, "Ziel");
      assert.equal(isSaved, false);
    }),
  ),
  call("stored", ({ database }) => repeatRow(database)),
  // Another guard of the same save still decides, also for a repeated text.
  prepare(
    "UPDATE work_items SET description = 'Basis', title = 'Ziel' WHERE id = 'nul-repeat';",
  ),
  call("WorkItemWriteRepository.update", async ({ database }) => {
    const writes = new WorkItemWriteRepository(database);
    await writes.updateDescription("nul-repeat", TEXT, "Basis");
    const isSaved = await writes.update("nul-repeat", {
      ...REPEAT_UPDATE,
      title: "Abgelehnt",
      expected: {
        title: "Veraltet",
        statusId: "status-todo",
        priority: "normal",
        assigneeId: null,
        assigneeGroupId: null,
        reporterId: "user-admin",
        parentId: null,
        milestoneId: null,
        dueAt: null,
        startAt: null,
      },
    });
    assert.equal(isSaved, false);
    return repeatRow(database);
  }),
  // The stored text is what the other text becomes only where the character goes.
  setRepeatRow(TEXT.replaceAll(NUL, "")),
  call("WorkItemWriteRepository.updateDescription", async ({ database }) => {
    const isSaved = await new WorkItemWriteRepository(
      database,
    ).updateDescription("nul-repeat", TEXT, "Ziel");
    return { isAsApproved: isSaved === (database.dialect === "postgres") };
  }),
  // An archived ticket takes no save, repeated or not.
  prepare(
    "UPDATE work_items SET archived_at = '2026-01-01 00:00:00' WHERE id = 'nul-repeat';",
  ),
  call("WorkItemWriteRepository.updateDescription", async ({ database }) => {
    const isSaved = await new WorkItemWriteRepository(
      database,
    ).updateDescription("nul-repeat", TEXT, "Ziel");
    assert.equal(isSaved, false);
  }),
  prepare("DELETE FROM work_items WHERE id = 'nul-repeat';"),
];

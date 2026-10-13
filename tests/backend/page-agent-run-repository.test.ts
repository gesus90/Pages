import { describe, expect, it } from "vitest";

import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";

import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";
import type { PageAgentRunRecord } from "@/definition/PageAgent";

function record(
  overrides: Partial<PageAgentRunRecord> = {},
): PageAgentRunRecord {
  return {
    agentId: "agent",
    runId: "run",
    planRunId: "plan-run",
    userId: "person",
    startedAt: "2026-10-13T08:00:00.000Z",
    finishedAt: "2026-10-13T08:01:00.000Z",
    status: "succeeded",
    model: "model-a",
    reasoningEffort: "medium",
    input: "Prepared input",
    result: "Final answer",
    ...overrides,
  };
}

describe("PAGE-20 run record persistence", () => {
  const getDatabase = useMigratedDatabase();

  it("keeps the first completion of a run and lists the identifiers of all records", async () => {
    const repository = new PageAgentRunRepository(getDatabase());
    const first = await repository.save(record());
    const repeated = await repository.save(
      record({ status: "failed", result: "Another outcome", model: "other" }),
    );
    expect(repeated).toEqual(first);
    await repository.save(record({ runId: "second", reasoningEffort: null }));
    await repository.save(record({ agentId: "other", runId: "third" }));
    expect(await repository.keys()).toEqual([
      { agentId: "agent", runId: "run" },
      { agentId: "agent", runId: "second" },
      { agentId: "other", runId: "third" },
    ]);
    expect(
      (await repository.get("agent", "second")).reasoningEffort,
    ).toBeNull();
    expect(await repository.find("agent", "missing")).toBeNull();
    await expect(repository.get("agent", "missing")).rejects.toMatchObject({
      code: "plan_invalid",
    });
  });

  it("pins the first prompt of a step and forgets it once the record carries it", async () => {
    const repository = new PageAgentRunRepository(getDatabase());
    await repository.pinInput("plan-run", "A", {
      prompt: "First prompt",
      startedAt: "2026-10-13T08:00:00.000Z",
    });
    await repository.pinInput("plan-run", "A", {
      prompt: "Replacement",
      startedAt: "2026-10-13T09:00:00.000Z",
    });
    expect(await repository.findInput("plan-run", "A")).toEqual({
      prompt: "First prompt",
      startedAt: "2026-10-13T08:00:00.000Z",
    });
    expect(await repository.findInput("plan-run", "B")).toBeNull();
    await repository.discardInput("plan-run", "A");
    await repository.discardInput("plan-run", "A");
    expect(await repository.findInput("plan-run", "A")).toBeNull();
  });

  it("lists ended plan runs only until they are marked, and never a running one", async () => {
    const database = getDatabase();
    const repository = new PageAgentRunRepository(database);
    const insert = async (id: string, status: string): Promise<void> =>
      database.execute(
        `
        INSERT INTO agent_plan_runs (
            id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json
        ) VALUES (
            $id, 'plan', 'u1', 'project', 'workspace', $started_at, $status, $view_json, $snapshot_json
        );
      `,
        {
          id,
          started_at: `2026-10-13T08:00:0${id.length}.000Z`,
          status,
          view_json: JSON.stringify({
            id,
            planId: "plan",
            planName: "Plan",
            planRevision: 1,
            userId: "u1",
            startedAt: "2026-10-13T08:00:00.000Z",
            status,
            stopRequested: false,
            steps: [],
          }),
          snapshot_json: JSON.stringify({ steps: [] }),
        },
      );
    await insert("a", "succeeded");
    await insert("bb", "failed");
    await insert("ccc", "running");
    expect(
      (await repository.unarchived()).map((entry) => entry.run.id),
    ).toEqual(["a", "bb"]);
    await repository.markArchived("a");
    await repository.markArchived("a");
    expect(
      (await repository.unarchived()).map((entry) => entry.run.id),
    ).toEqual(["bb"]);
  });

  it("refuses a stored status that is not one of the four terminal states", async () => {
    const stored = [
      "agent",
      "run",
      "plan-run",
      "person",
      "start",
      "end",
      "running",
      "model-a",
      null,
      "input",
      "result",
    ];
    const database = { query: async () => [stored] } as unknown as Database;
    await expect(
      new PageAgentRunRepository(database).find("agent", "run"),
    ).rejects.toMatchObject({ code: "plan_invalid" });
  });
});

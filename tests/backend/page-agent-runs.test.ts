import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { PageAgentService } from "@/backend/service/agents/PageAgentService";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";

import {
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
  waitForPlan,
} from "../helpers/execution-plans";
import { pageAgentInput } from "../helpers/page-agents";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ExecutionPlanHarness } from "../helpers/execution-plans";

describe("PAGE-20 terminal agent run archive and definition immutability", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });
  async function setup() {
    const database = getDatabase();
    harness = await createExecutionPlanHarness(database);
    const current = harness;
    const pages = new PageAgentService(
      {
        profiles: current.profileRepository,
        connections: current.connections,
        authorization: current.authorization,
        groups: new UserGroupRepository(database),
        operations: new AgentOperationRegistry(),
        workspaces: current.workspaces,
        content: new AgentContentAccess(
          current.projects,
          current.wiki.repository,
        ),
      },
      current.profiles,
      current.files,
    );
    const agentId = await pages.save(
      current.bob.id,
      null,
      pageAgentInput({ modelProfileId: current.agentId }),
    );
    return { ...current, pages, userAgentId: agentId };
  }

  it.each(["succeeded", "failed", "cancelled", "timeout"] as const)(
    "archives %s exactly once, with model, timestamps, rendered input and sanitized result",
    async (status) => {
      const current = await setup();
      current.execution.run.mockImplementation(async (input) => {
        await input.beforeStart?.();
        if (status === "failed") throw new AgentError("plan_step_failed");
        if (status === "cancelled") throw new AgentPlanCancelledError();
        if (status === "timeout") throw new TextAssistantError("timeout");
        return "Completed";
      });
      const planId = await current.service.save(
        current.bob.id,
        null,
        executionPlan(current.workspaceId, current.userAgentId),
      );
      const run = await current.service.play(current.bob.id, planId, 1);
      const runId = createHash("sha256").update(`${run.id}\nA`).digest("hex");
      await waitForPlan(async () => {
        const archived = await current.archive.read(
          current.bob.id,
          current.userAgentId,
          runId,
        );
        expect(archived.record).toMatchObject({
          agentId: current.userAgentId,
          runId,
          planRunId: run.id,
          status,
          model: "model-a",
          reasoningEffort: "medium",
          input: "Test Default task\n\nA",
        });
        expect(Number.isFinite(Date.parse(archived.record.startedAt))).toBe(
          true,
        );
        expect(Number.isFinite(Date.parse(archived.record.finishedAt))).toBe(
          true,
        );
      });
      await current.engine.shutdown();
      const directory = path.join(
        current.root,
        "instance",
        ".pages",
        "Agents",
        current.userAgentId,
        "runs",
      );
      const before = await readFile(
        path.join(directory, `${runId}.md`),
        "utf8",
      );
      await current.archive.recover();
      await current.archive.recover();
      expect(await readdir(directory)).toEqual([`${runId}.md`]);
      expect(await readFile(path.join(directory, `${runId}.md`), "utf8")).toBe(
        before,
      );
      expect(before).toContain("## Input");
      expect(before).toContain("## Result");
      expect(before).not.toMatch(/ciphertext|connectionId|hasApiKey/u);
      await expect(
        current.archive.read(current.alice.id, current.userAgentId, runId),
      ).rejects.toMatchObject({ code: "agent_usage_denied" });
      await expect(
        current.archive.read(current.bob.id, "../escape", runId),
      ).rejects.toThrow();
    },
  );

  it("holds AGENT.md unchanged while running and denies an owner save until settled", async () => {
    const current = await setup();
    const filename = path.join(
      current.root,
      "instance",
      ".pages",
      "Agents",
      current.userAgentId,
      "AGENT.md",
    );
    const before = await readFile(filename, "utf8");
    let finish: (() => void) | undefined;
    const pending = new Promise<string>((resolve) => {
      finish = () => resolve("Completed");
    });
    current.execution.run.mockImplementation(async (input) => {
      await input.beforeStart?.();
      return pending;
    });
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(() => expect(current.execution.run).toHaveBeenCalled());
    const saved = (await current.pages.page(current.bob.id)).agents[0];
    await expect(
      current.pages.save(current.bob.id, current.userAgentId, {
        ...saved,
        name: "During run",
      }),
    ).rejects.toMatchObject({ code: "profile_conflict" });
    expect(await readFile(filename, "utf8")).toBe(before);
    finish?.();
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await current.engine.shutdown();
    await current.pages.save(current.bob.id, current.userAgentId, {
      ...saved,
      name: "After run",
    });
    expect(await readFile(filename, "utf8")).toContain("After run");
  });

  it("records result-bound rendered inputs and repairs missing files after restart without duplicate records", async () => {
    const current = await setup();
    const credentialShape = ["sk", "x".repeat(20)].join("-");
    current.execution.run.mockImplementation(async (input) => {
      await input.beforeStart?.();
      return `Result ${credentialShape}`;
    });
    const planId = await current.service.save(
      current.bob.id,
      null,
      executionPlan(current.workspaceId, current.userAgentId, {
        nodes: [
          executionStep("A", current.userAgentId),
          executionStep("B", current.userAgentId, {
            input: { kind: "result", stepId: "A" },
          }),
        ],
        edges: [{ from: "A", to: "B" }],
      }),
    );
    const run = await current.service.play(current.bob.id, planId, 1);
    await waitForPlan(async () =>
      expect((await current.runRepository.find(run.id))?.status).toBe(
        "succeeded",
      ),
    );
    await current.engine.shutdown();
    const runId = createHash("sha256").update(`${run.id}\nB`).digest("hex");
    const archived = await current.archive.read(
      current.bob.id,
      current.userAgentId,
      runId,
    );
    expect(archived.record.input).toBe("Test Result [redacted]\n\nB");
    expect(archived.markdown).not.toContain(credentialShape);
    const filename = path.join(
      current.root,
      "instance",
      ".pages",
      "Agents",
      current.userAgentId,
      "runs",
      `${runId}.md`,
    );
    await rm(filename);
    await current.archive.recover();
    expect(await readFile(filename, "utf8")).toBe(archived.markdown);
    const rows = await getDatabase().query(
      "SELECT COUNT(*) FROM page_agent_run_records;",
    );
    expect(rows[0]?.[0]).toBe(2);
  });
});

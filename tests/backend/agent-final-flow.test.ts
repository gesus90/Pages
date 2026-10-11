import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliPlanExecution } from "@/backend/agents/cli/CliPlanExecution";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { createCatalogModel } from "../helpers/agents";
import {
  createExecutionPlanHarness,
  executionPlan,
  executionStep,
  waitForPlan,
} from "../helpers/execution-plans";
import { useMigratedDatabase } from "../helpers/test-database";
import { pageInput } from "../helpers/wiki-harness";

import type { CliToolAdapter } from "@/backend/agents/cli/CliContracts";
import type { ExecutionPlanHarness } from "../helpers/execution-plans";

const LOCAL_CLI = `#!/usr/bin/env node
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  const output = JSON.stringify({ directory: process.cwd(), home: process.env.HOME, prompt });
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: output } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n");
});
`;

async function personalConnection(
  current: ExecutionPlanHarness,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await current.connections.insert({
    id,
    name,
    provider: "codex_cli",
    secretEncrypted: null,
    testModel: null,
    actorId: current.alice.id,
  });
  await current.connections.setCliAccount(
    id,
    { loggedInAt: "2026-10-11T14:00:00Z", label: name },
    current.alice.id,
  );
  await current.connections.catalogs().save(
    id,
    {
      attemptedAt: "now",
      errorCode: null,
      models: [
        createCatalogModel({
          id: "model-a",
          reasoning: "levels",
          reasoningEfforts: ["medium"],
        }),
      ],
    },
    null,
  );
  return id;
}

async function localExecution(
  current: ExecutionPlanHarness,
): Promise<CliProcessRunner> {
  const file = path.join(current.root, "local-test-cli");
  await writeFile(file, LOCAL_CLI, { mode: 0o700 });
  await mkdir(path.join(current.root, "test-credentials"));
  const store = new AgentCredentialStore(
    path.join(current.root, "test-credentials"),
  );
  const locator = new CliLocator("/synthetic/unused", "/synthetic/unused");
  vi.spyOn(locator, "find").mockResolvedValue({ found: true, path: file });
  const runner = new CliProcessRunner();
  const runtime = new AgentCliRuntime({ store, locator, runner });
  const adapter: CliToolAdapter = {
    provider: "codex_cli",
    readStatus: vi.fn().mockResolvedValue({
      outcome: { ok: true, detail: {} },
      accountLabel: null,
    }),
    version: vi.fn(),
    startLogin: vi.fn(),
    loginError: vi.fn(),
    runTest: vi.fn(),
    listModels: vi.fn(),
    logout: vi.fn(),
  };
  vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
  const execution = new CliPlanExecution({ store, locator, runner, runtime });
  current.execution.run.mockImplementation((input, signal) =>
    execution.run(input, signal),
  );
  return runner;
}

describe("A10.5 complete assignment-to-execution regression with real local children", () => {
  const getDatabase = useMigratedDatabase();
  let harness: ExecutionPlanHarness | undefined;
  let runner: CliProcessRunner | undefined;
  afterEach(async () => {
    await harness?.dispose();
    await runner?.shutdown();
    harness = undefined;
    runner = undefined;
  });

  it.each(["sequential", "parallel"] as const)(
    "executes %s task/wiki/workspace bindings using only the executor's personal access and actual cwd",
    async (mode) => {
      const current = await createExecutionPlanHarness(getDatabase());
      harness = current;
      runner = await localExecution(current);
      const authorConnection = await personalConnection(current, "Author CLI");
      const ownConnection = await personalConnection(current, "Executor CLI");
      const secondPage = await current.wiki.service.create(
        current.alice,
        pageInput({ title: "Second task", content: "Second wiki instruction" }),
      );
      const configuration = {
        ...emptyAgentConfiguration(),
        projectId: "project",
        markdown: "{{input}}\n{{branch}}\n{{root.path}}\n{{wiki.markdown}}",
        sharing: { isGlobal: true, targets: [] },
        directoryParameter: "root",
        parameters: [
          {
            name: "input",
            type: "text",
            description: "Task",
            isRequired: true,
            defaultValue: null,
          },
          {
            name: "branch",
            type: "text",
            description: "Branch",
            isRequired: true,
            defaultValue: null,
          },
          {
            name: "root",
            type: "workspace",
            description: "Directory",
            isRequired: true,
            defaultValue: null,
          },
          {
            name: "wiki",
            type: "wiki",
            description: "Wiki task",
            isRequired: true,
            defaultValue: null,
          },
        ],
      } as const;
      const templateId = await current.profiles.save(current.admin, null, {
        ...current.agentInput,
        name: "Shared template",
        connectionId: authorConnection,
        targets: [{ kind: "person", targetId: current.alice.id }],
        configuration,
      });
      const ownId = await current.profiles.save(current.admin, null, {
        ...current.agentInput,
        name: "Executor personal",
        connectionId: ownConnection,
        targets: [{ kind: "person", targetId: current.bob.id }],
        configuration: emptyAgentConfiguration(),
      });
      const before = (await current.profileRepository.list()).find(
        (profile) => profile.id === templateId,
      );
      const nodes = [current.workspaceId, current.secondWorkspaceId].map(
        (workspaceId, index) => ({
          ...executionStep(index === 0 ? "A" : "B", templateId, {
            input: { kind: "source", nodeId: index === 0 ? "task" : "subtask" },
            branch: { kind: "source", nodeId: "variable" },
            root: {
              kind: "literal",
              value: { type: "workspace", workspaceId },
            },
            wiki: {
              kind: "literal",
              value: {
                type: "wiki",
                pageId: index === 0 ? current.page.id : secondPage.id,
              },
            },
          }),
          personalAgentId: ownId,
        }),
      );
      const id = await current.service.save(
        current.bob.id,
        null,
        executionPlan(current.workspaceId, templateId, {
          globals: { branch: "task/test" },
          nodes: [
            ...nodes,
            { id: "task", type: "task", taskId: current.task.id, x: 0, y: 0 },
            {
              id: "subtask",
              type: "task",
              taskId: current.subtask.id,
              x: 0,
              y: 0,
            },
            { id: "variable", type: "variable", name: "branch", x: 0, y: 0 },
          ],
          edges: mode === "sequential" ? [{ from: "A", to: "B" }] : [],
        }),
      );
      const started = await current.service.play(current.bob.id, id, 1);
      await waitForPlan(async () => {
        const progress = await current.runRepository.find(started.id);
        expect(progress?.status, JSON.stringify(progress?.steps)).toBe(
          "succeeded",
        );
      });
      const completed = await current.service.run(current.bob.id, started.id);
      expect(completed.steps[0].output).toContain(
        `"directory":${JSON.stringify(path.join(current.root, "approved", "one"))}`,
      );
      expect(completed.steps[1].output).toContain(
        `"directory":${JSON.stringify(path.join(current.root, "approved", "two"))}`,
      );
      expect(completed.steps[0].output).toContain("Detailed task");
      expect(completed.steps[1].output).toContain("Detailed subtask");
      expect(completed.steps[0].output).toContain("Original page");
      expect(completed.steps[1].output).toContain("Second wiki instruction");
      for (const step of completed.steps) {
        expect(step.output).toContain("task/test");
        expect(step.output).toContain(
          path.join("test-credentials", "agents", ownConnection, "home"),
        );
        expect(step.output).not.toContain(authorConnection);
      }
      expect(
        (await current.profileRepository.list()).find(
          (profile) => profile.id === templateId,
        ),
      ).toEqual(before);
    },
  );
});

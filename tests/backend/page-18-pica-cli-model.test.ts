import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliTextExecution } from "@/backend/agents/cli/CliTextExecution";

import { completeCli, createCliSpawn } from "../helpers/agent-cli";
import { createCatalogModel } from "../helpers/agents";
import { chatProfile, useChatHarness } from "../helpers/chat-harness";

import type { CliToolAdapter } from "@/backend/agents/cli/CliContracts";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { ChatHarness } from "../helpers/chat-harness";

const MARKER = "PICA-CLI-MARKER-51C9";

/** What each CLI prints for a final answer with the marker. */
const CLI_ANSWERS: Readonly<Record<CliProviderId, string>> = {
  codex_cli: [
    { type: "item.completed", item: { type: "agent_message", text: MARKER } },
    { type: "turn.completed" },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n"),
  claude_code: JSON.stringify({
    is_error: false,
    subtype: "success",
    result: MARKER,
  }),
};

const createHarness = useChatHarness();
let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-pica-cli-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A signed-in CLI access with one model; its process start is faked. */
async function addCliAccess(
  harness: ChatHarness,
  provider: CliProviderId,
  model: string,
): Promise<string> {
  const id = randomUUID();
  await harness.connections.insert({
    id,
    name: `Synthetic ${provider}`,
    provider,
    secretEncrypted: null,
    testModel: "decoy-test-model",
    actorId: "admin",
  });
  await harness.database.execute(
    "UPDATE agent_connections SET cli_logged_in_at = '2026-10-12T08:00:00Z', reasoning_effort = 'low' WHERE id = $id;",
    { id },
  );
  await harness.connections.catalogs().save(
    id,
    {
      attemptedAt: "2026-10-12T08:00:00Z",
      errorCode: null,
      models: [
        createCatalogModel({
          id: model,
          reasoning: "levels",
          reasoningEfforts: ["low", "medium", "high"],
          defaultReasoningEffort: "low",
        }),
      ],
    },
    null,
  );
  return id;
}

function fakeCli(provider: CliProviderId) {
  const store = new AgentCredentialStore(directory);
  const locator = new CliLocator("/synthetic/none", "/synthetic/node");
  vi.spyOn(locator, "find").mockResolvedValue({
    found: true,
    path: "/synthetic/binary",
  });
  const fake = createCliSpawn();
  const runner = new CliProcessRunner(fake);
  const runtime = new AgentCliRuntime({ store, locator, runner });
  const adapter: CliToolAdapter = {
    provider,
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
  return {
    fake,
    execution: new CliTextExecution({ store, locator, runner, runtime }),
  };
}

/** The value that follows a flag in the argument list. */
function after(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("PAGE-18 AK-2: CLI accesses run exactly Pica's saved model and effort", () => {
  it.each([
    ["codex_cli", "gpt-6-luna", "medium"],
    ["claude_code", "claude-sonnet-5-5", "high"],
  ] as const)(
    "starts %s with model %s and effort %s",
    async (provider, model, effort) => {
      const harness = await createHarness();
      const connectionId = await addCliAccess(harness, provider, model);
      await harness.profiles.save(
        await harness.account("admin"),
        harness.agentId,
        chatProfile({ connectionId, model, reasoningEffort: effort }),
      );
      const { fake, execution } = fakeCli(provider);
      harness.execution.run.mockImplementation((input, signal) =>
        execution.run(input, signal),
      );

      const pending = harness.ask("writer", "Synthetische Frage an Pica.");
      await vi.waitFor(() => expect(fake.children).toHaveLength(1));
      const [, args] = fake.spawn.mock.calls[0];
      completeCli(fake.children[0], CLI_ANSWERS[provider]);
      const reply = await pending;

      expect(reply.answer.content).toBe(MARKER);
      if (provider === "codex_cli") {
        expect(after(args, "-m")).toBe(model);
        expect(args).toContain(`model_reasoning_effort="${effort}"`);
      } else {
        expect(after(args, "--model")).toBe(model);
        expect(after(args, "--effort")).toBe(effort);
      }
      // Neither the access's test model nor its test effort reaches the run.
      expect(args.join(" ")).not.toContain("decoy-test-model");
      expect(args.join(" ")).not.toMatch(/effort[="\s]+low/u);
      expect(fake.spawn).toHaveBeenCalledTimes(1);
    },
  );
});

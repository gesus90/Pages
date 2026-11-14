import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { AgentToolFiles } from "@/backend/service/agents/tools/AgentToolFiles";
import { agentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";

import { environmentFiles as memory } from "../page352-files";
import { deferred } from "../page81-resource-fixture";
import { TOOL_ADMIN, toolWorld } from "./page69-tool-world";

vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("../page352-files");
  return environmentFiles.module();
});

const ROOT = "/memory/tools";
const TOOL = agentToolDefinition("codex_acp");
const POINTER = `${ROOT}/${TOOL.id}/active.json`;
const RELEASES = `${ROOT}/${TOOL.id}/releases`;
const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => memory.reset());

function releaseNames(): string[] {
  return [...memory.entries.keys()].filter(
    (directory) => path.dirname(directory) === RELEASES,
  );
}

it("clears a legacy duplicate previous pointer and deletes every unretained generation", async () => {
  const current = `2.2.2-${FIRST_ID}`;
  const previous = `2.2.2-${SECOND_ID}`;
  memory.seed(
    POINTER,
    "file",
    JSON.stringify({ current, previous, approvedTarget: "2.2.2" }),
  );
  for (const name of [current, previous, `2.1.1-${THIRD_ID}`])
    memory.seed(`${RELEASES}/${name}/binary`, "file");

  const files = new AgentToolFiles(ROOT);
  await files.prune(TOOL);

  expect(releaseNames()).toEqual([`${RELEASES}/${current}`]);
  expect(JSON.parse(memory.entries.get(POINTER)?.content ?? "null")).toEqual({
    current,
    previous: null,
    approvedTarget: "2.2.2",
  });
  expect(await files.previous(TOOL)).toBeNull();
});

it("keeps the genuine previous version through repeated same-version repairs", async () => {
  const files = new AgentToolFiles(ROOT);
  const previous = await files.candidate({ ...TOOL, version: "2.1.1" });
  await files.activate(TOOL, previous);
  const original = await files.candidate(TOOL);
  await files.activate(TOOL, original);
  const repaired = await files.candidate(TOOL);
  await files.activate(TOOL, repaired);
  const repairedAgain = await files.candidate(TOOL);
  await files.activate(TOOL, repairedAgain);
  await files.prune(TOOL);

  expect((await files.previous(TOOL))?.release).toBe(previous.release);
  expect((await files.current(TOOL))?.release).toBe(repairedAgain.release);
  expect(new Set(releaseNames())).toEqual(
    new Set([previous.release, repairedAgain.release]),
  );
  expect(memory.entries.has(original.release ?? "")).toBe(false);
  expect(memory.entries.has(repaired.release ?? "")).toBe(false);
});

it("leaves previous null when repairing the first installed version", async () => {
  const files = new AgentToolFiles(ROOT);
  await files.activate(TOOL, await files.candidate(TOOL));
  const repaired = await files.candidate(TOOL);
  await files.activate(TOOL, repaired);
  await files.prune(TOOL);

  expect(await files.previous(TOOL)).toBeNull();
  expect(releaseNames()).toEqual([repaired.release]);
});

it("preserves distinct versions including a prerelease version absent from the registry", async () => {
  const files = new AgentToolFiles(ROOT);
  const previous = await files.candidate({ ...TOOL, version: "8.0.0-beta.1" });
  await files.activate(TOOL, previous);
  const oldCurrent = await files.candidate({
    ...TOOL,
    version: "8.0.0-beta.2",
  });
  await files.activate(TOOL, oldCurrent);
  const current = await files.candidate({ ...TOOL, version: "8.0.0-beta.2" });
  await files.activate(TOOL, current);
  await files.prune(TOOL);

  expect((await files.previous(TOOL))?.release).toBe(previous.release);
  expect(new Set(releaseNames())).toEqual(
    new Set([previous.release, current.release]),
  );
  await files.activate(TOOL, previous);
  expect((await files.previous(TOOL))?.release).toBe(current.release);
});

it("defers pruning until the installation of that tool has finished", async () => {
  const world = toolWorld();
  const prune = vi.fn(async () => undefined);
  world.storage.prune = prune;
  const entered = deferred<void>();
  const finish = deferred<void>();
  world.install.mockImplementation(async () => {
    entered.resolve();
    await finish.promise;
  });
  const installation = world.manager.manage(TOOL_ADMIN, "claude", "install");
  await entered.promise;
  await world.manager.runMaintenance();
  expect(prune.mock.calls).not.toContainEqual([agentToolDefinition("claude")]);
  finish.resolve();
  await installation;
  await world.manager.runMaintenance();
  expect(prune.mock.calls).toContainEqual([agentToolDefinition("claude")]);
});

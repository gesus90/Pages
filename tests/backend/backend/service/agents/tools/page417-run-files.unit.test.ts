import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { AgentToolFiles } from "@/backend/service/agents/tools/AgentToolFiles";
import { AgentToolRunFiles } from "@/backend/service/agents/tools/AgentToolRunFiles";

import { environmentFiles as memory } from "../page352-files";
import { deferred } from "../page81-resource-fixture";
import { toolWorld } from "./page69-tool-world";

vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("../page352-files");
  return environmentFiles.module();
});

const ROOT = "/memory/tools";
const CACHE = `${ROOT}/npm-cache`;
const PROBE = `${ROOT}/probe`;

beforeEach(() => memory.reset());

it("removes loose files, links, stale temporary trees and the npm cache before startup probes", async () => {
  const files = new AgentToolFiles(ROOT);
  const world = toolWorld();
  memory.seed(`${PROBE}/home/settings`, "file", "preserved");
  memory.seed(`${PROBE}/config/settings`, "file", "preserved");
  memory.seed(`${PROBE}/work/project`, "file", "preserved");
  memory.seed(`${PROBE}/other/subdirectory/keep`, "file");
  memory.seed(`${PROBE}/agy_acp_server.par.log.INFO.1`, "file");
  memory.seed(`${PROBE}/cacerts__py_binary_resource.txt`, "file");
  memory.seed(`${PROBE}/log-link`, "link", "/outside/keep");
  memory.seed("/outside/keep", "file");
  memory.seed(`${PROBE}/tmp/old/nested/output`, "file");
  memory.seed(`${PROBE}/tmp/link`, "link", "/outside/keep");
  memory.seed(`${CACHE}/nested/package`, "file");
  memory.seed(`${ROOT}/pica-native/keep`, "file");
  memory.seed("/memory/data/shared-env/keep", "file");
  world.storage.initialize = () => files.initialize();
  const cleanBeforeChecks: boolean[] = [];
  world.check.mockImplementation(async () => {
    cleanBeforeChecks.push(
      !memory.entries.has(CACHE) &&
        !memory.entries.has(`${PROBE}/agy_acp_server.par.log.INFO.1`) &&
        !memory.entries.has(`${PROBE}/tmp/old`),
    );
    return { status: "ready", diagnostic: "ready", version: "synthetic" };
  });

  await world.manager.start();

  expect(world.check).toHaveBeenCalled();
  expect(cleanBeforeChecks.every(Boolean)).toBe(true);
  expect(
    [...memory.entries.keys()].filter((entry) => path.dirname(entry) === PROBE),
  ).toEqual([
    `${PROBE}/home`,
    `${PROBE}/config`,
    `${PROBE}/work`,
    `${PROBE}/other`,
    `${PROBE}/tmp`,
  ]);
  expect(memory.entries.has(`${PROBE}/tmp/old`)).toBe(false);
  expect(memory.entries.has(`${PROBE}/tmp/link`)).toBe(false);
  for (const entry of [
    `${PROBE}/home/settings`,
    `${PROBE}/config/settings`,
    `${PROBE}/work/project`,
    `${PROBE}/other/subdirectory/keep`,
    "/outside/keep",
    `${ROOT}/pica-native/keep`,
    "/memory/data/shared-env/keep",
  ])
    expect(memory.entries.has(entry)).toBe(true);
});

it("creates persistent home, config and work directories on an empty startup", async () => {
  await new AgentToolFiles(ROOT).initialize();
  for (const name of ["home", "config", "work"])
    expect(memory.entries.get(`${PROBE}/${name}`)?.kind).toBe("directory");
});

it.each(["success", "failure", "abort"])(
  "removes a private run directory and all its output after %s",
  async (outcome) => {
    const runs = new AgentToolRunFiles(new AgentToolFiles(ROOT));
    let temporaryDirectory = "";
    const operation = runs.temporary(async (directory) => {
      temporaryDirectory = directory;
      expect(directory).toMatch(/^\/memory\/tools\/probe\/tmp\/[\da-f-]{36}$/u);
      expect(memory.entries.has(directory)).toBe(true);
      memory.seed(`${directory}/nested/log`, "file");
      if (outcome === "failure") throw new Error("synthetic failure");
      if (outcome === "abort") {
        const controller = new AbortController();
        controller.abort();
        controller.signal.throwIfAborted();
      }
      return "finished";
    });
    if (outcome === "success") await expect(operation).resolves.toBe("finished");
    else await expect(operation).rejects.toThrow();
    expect(memory.entries.has(temporaryDirectory)).toBe(false);
    expect(memory.entries.has(`${temporaryDirectory}/nested/log`)).toBe(false);
  },
);

it("preserves an active run while startup removes stale run directories", async () => {
  const files = new AgentToolFiles(ROOT);
  const runs = new AgentToolRunFiles(files);
  const entered = deferred<void>();
  const finish = deferred<void>();
  let activeDirectory = "";
  const running = runs.temporary(async (directory) => {
    activeDirectory = directory;
    memory.seed(`${directory}/log`, "file");
    entered.resolve();
    await finish.promise;
  });
  await entered.promise;
  memory.seed(`${PROBE}/tmp/abandoned/log`, "file");
  await files.initialize();
  expect(memory.entries.has(`${activeDirectory}/log`)).toBe(true);
  expect(memory.entries.has(`${PROBE}/tmp/abandoned`)).toBe(false);
  finish.resolve();
  await running;
  expect(memory.entries.has(activeDirectory)).toBe(false);
});

it("keeps a live installation's cache on startup and cleans it on completion", async () => {
  const files = new AgentToolFiles(ROOT);
  const entered = deferred<void>();
  const finish = deferred<void>();
  const installation = new AgentToolRunFiles(files).install(async () => {
    memory.seed(`${CACHE}/package`, "file");
    entered.resolve();
    await finish.promise;
  });
  await entered.promise;
  await files.initialize();
  expect(memory.entries.has(`${CACHE}/package`)).toBe(true);
  finish.resolve();
  await installation;
  expect(memory.entries.has(CACHE)).toBe(false);
});

it("serializes cache cleanup with a following installation even if the first fails", async () => {
  const first = new AgentToolRunFiles(new AgentToolFiles(ROOT));
  const second = new AgentToolRunFiles(new AgentToolFiles(ROOT));
  const entered = deferred<void>();
  const finish = deferred<void>();
  const work = first.install(async () => {
    memory.seed(`${CACHE}/first`, "file");
    entered.resolve();
    await finish.promise;
    throw new Error("first installation failed");
  });
  const rejected = expect(work).rejects.toThrow("first installation failed");
  await entered.promise;
  let hasSecondStarted = false;
  const next = second.install(async () => {
    hasSecondStarted = true;
    expect(memory.entries.has(CACHE)).toBe(false);
    memory.seed(`${CACHE}/second`, "file");
  });
  await Promise.resolve();
  expect(hasSecondStarted).toBe(false);
  expect(memory.entries.has(`${CACHE}/first`)).toBe(true);
  finish.resolve();
  await Promise.all([rejected, next]);
  expect(hasSecondStarted).toBe(true);
  expect(memory.entries.has(CACHE)).toBe(false);
});

it("refuses a symlinked temporary root without following its target", async () => {
  const files = new AgentToolFiles(ROOT);
  memory.seed(`${PROBE}/tmp`, "link", "/outside");
  memory.seed("/outside/keep", "file");
  await expect(
    new AgentToolRunFiles(files).temporary(async () => undefined),
  ).rejects.toThrow("Unsafe probe temporary directory");
  expect(memory.entries.has("/outside/keep")).toBe(true);
});

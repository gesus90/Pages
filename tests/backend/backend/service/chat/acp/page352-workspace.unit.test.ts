import { beforeEach, expect, it, vi } from "vitest";

import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";

import { environmentFiles as files } from "../../agents/page352-files";
import { FIRST, SECOND } from "../page48-chat-fixture";

vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("../../agents/page352-files");
  return environmentFiles.module();
});

beforeEach(() => files.reset());

it("removes a workspace after the last job, then recreates the same path empty", async () => {
  const workspace = new PicaAcpWorkspace("/memory/pica-sessions");
  const release = workspace.reserve(FIRST);
  const directory = await workspace.prepare(FIRST);
  files.seed(`${directory}/answer.pdf`, "file", "answer bytes");
  await release();
  expect(files.entries.has(directory)).toBe(false);
  const next = workspace.reserve(FIRST);
  expect(await workspace.prepare(FIRST)).toBe(directory);
  expect(
    [...files.entries.keys()].filter((entry) => entry.startsWith(directory)),
  ).toEqual([directory]);
  await next();
});

it("keeps running and waiting jobs during periodic cleanup, removes abandoned folders after a crash", async () => {
  const workspace = new PicaAcpWorkspace("/memory/pica-sessions");
  const first = workspace.reserve(FIRST);
  const waiting = workspace.reserve(FIRST);
  const directory = await workspace.prepare(FIRST);
  files.seed(`${directory}/answer.pdf`, "file");
  const abandoned = await workspace.prepare(SECOND);
  await workspace.sweep();
  expect(files.entries.has(directory)).toBe(true);
  expect(files.entries.has(abandoned)).toBe(false);
  await first();
  await workspace.sweep();
  expect(files.entries.has(`${directory}/answer.pdf`)).toBe(true);
  await waiting();
  expect(files.entries.has(directory)).toBe(false);
  await waiting();
});

import { beforeEach, expect, it, vi } from "vitest";

import {
  createScriptResources,
  removeScriptResources,
  scriptEnvironment,
} from "@/backend/service/agents/AgentPlanScriptResources";

const boundary = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  readFile: vi.fn(),
  lstat: vi.fn(async () => ({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.(),
  })),
  preparePlanTemporaryDirectory: vi.fn(async () => "/disk/run/step"),
  planTemporaryDirectory: () => "/disk/run/step",
}));
vi.mock("node:fs/promises", () => boundary);
vi.mock("@/backend/agents/PlanRunTemporaryDirectory", () => boundary);

const INSTANCE = "00000000-0000-4000-8000-000000000001";
const SCOPE = { runId: INSTANCE, stepId: "checks" };
const DIRECTORY = `/disk/run/step/resources-${INSTANCE}`;

beforeEach(() => {
  vi.clearAllMocks();
  boundary.writeFile.mockResolvedValue(undefined);
  boundary.readFile.mockResolvedValue(INSTANCE);
});

it("places script source and its marker in the same private disk scope as /tmp", async () => {
  await expect(
    createScriptResources(INSTANCE, "print('ok')", SCOPE),
  ).resolves.toBe(DIRECTORY);
  expect(boundary.preparePlanTemporaryDirectory).toHaveBeenCalledWith(SCOPE);
  expect(boundary.writeFile).toHaveBeenCalledWith(
    `${DIRECTORY}/owner`,
    INSTANCE,
    { mode: 0o600, flag: "wx" },
  );
});

it("removes partially written source when preparation fails before any process starts", async () => {
  boundary.writeFile.mockRejectedValueOnce(new Error("disk full"));
  await expect(
    createScriptResources(INSTANCE, "source", SCOPE),
  ).rejects.toThrow("disk full");
  expect(boundary.rm).toHaveBeenCalledWith(DIRECTORY, {
    recursive: true,
    force: true,
  });
});

it("recovers only the script resource directory with the matching owner marker", async () => {
  await removeScriptResources(INSTANCE, SCOPE);
  expect(boundary.rm).toHaveBeenCalledWith(DIRECTORY, { recursive: true });
  boundary.rm.mockClear();
  boundary.readFile.mockResolvedValue("another-instance");
  await expect(removeScriptResources(INSTANCE, SCOPE)).rejects.toThrow(
    "marker",
  );
  expect(boundary.rm).not.toHaveBeenCalled();
});

it("preserves the temporary environment of automation callers outside plan isolation", () => {
  const environment = scriptEnvironment({
    directory: "/automation",
    interpreter: "/usr/bin/node",
    instanceId: INSTANCE,
  });
  expect(environment.TMPDIR).toBe("/automation");
  expect(environment).not.toHaveProperty("NODE_COMPILE_CACHE");
});

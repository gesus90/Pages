import { beforeEach, expect, it, vi } from "vitest";

import type * as RunsModeExports from "./RunsMode";

const sessionOwner = vi.hoisted(() => ({ isOwner: false }));

vi.mock("@/backend/agents/local/LocalSessionMode", () => ({
  isLocalSessionOwner: (): boolean => sessionOwner.isOwner,
}));

type RunsModeModule = typeof RunsModeExports;

// The flags are module state, so every test starts from a fresh module.
async function loadRunsMode(): Promise<RunsModeModule> {
  vi.resetModules();

  return import("./RunsMode");
}

beforeEach(() => {
  sessionOwner.isOwner = false;
});

it("starts as the API process without any ownership", async () => {
  const mode = await loadRunsMode();

  expect(mode.isPagesRunsProcess()).toBe(false);
  expect(mode.canProcessRuns()).toBe(false);
  expect(mode.hasRunServiceOwnership()).toBe(false);
  expect(mode.hasRunApiOwnership()).toBe(false);
  expect(mode.canProcessApiWork()).toBe(false);
});

it("marks the standalone runs process", async () => {
  const mode = await loadRunsMode();
  mode.enterRunsProcess();

  expect(mode.isPagesRunsProcess()).toBe(true);
});

it("lets the elected scheduler process runs and releases that right again", async () => {
  const mode = await loadRunsMode();
  mode.setRunsOwnership(true);

  expect(mode.canProcessRuns()).toBe(true);
  expect(mode.hasRunServiceOwnership()).toBe(true);

  mode.setRunsOwnership(false);

  expect(mode.canProcessRuns()).toBe(false);
  expect(mode.hasRunServiceOwnership()).toBe(false);
});

it("refuses run processing in a local session owner even with ownership", async () => {
  const mode = await loadRunsMode();
  mode.setRunsOwnership(true);
  sessionOwner.isOwner = true;

  expect(mode.canProcessRuns()).toBe(false);
  expect(mode.hasRunServiceOwnership()).toBe(true);
});

it("records API bridge ownership as service and API ownership", async () => {
  const mode = await loadRunsMode();
  mode.setRunApiOwnership();

  expect(mode.hasRunApiOwnership()).toBe(true);
  expect(mode.hasRunServiceOwnership()).toBe(true);
  expect(mode.canProcessRuns()).toBe(false);
});

it("allows API work for an owner through the bridge", async () => {
  const mode = await loadRunsMode();
  mode.setRunApiOwnership();

  expect(mode.canProcessApiWork()).toBe(true);
});

it("allows API work for an owner through run ownership", async () => {
  const mode = await loadRunsMode();
  mode.setRunsOwnership(true);

  expect(mode.canProcessApiWork()).toBe(true);
});

it("refuses API work in the standalone runs process", async () => {
  const mode = await loadRunsMode();
  mode.setRunApiOwnership();
  mode.enterRunsProcess();

  expect(mode.canProcessApiWork()).toBe(false);
});

it("refuses API work in a local session owner", async () => {
  const mode = await loadRunsMode();
  mode.setRunApiOwnership();
  sessionOwner.isOwner = true;

  expect(mode.canProcessApiWork()).toBe(false);
});

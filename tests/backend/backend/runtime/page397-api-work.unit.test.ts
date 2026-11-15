import { expect, it, vi } from "vitest";

it("schedules application work only in the elected API, also when the engine is separate", async () => {
  vi.resetModules();
  const mode = await import("@/backend/runtime/RunsMode");
  expect(mode.canProcessApiWork()).toBe(false);
  mode.setRunApiOwnership();
  expect(mode.canProcessApiWork()).toBe(true);
  expect(mode.canProcessRuns()).toBe(false);
  mode.enterRunsProcess();
  mode.setRunsOwnership(true);
  expect(mode.canProcessRuns()).toBe(true);
  expect(mode.canProcessApiWork()).toBe(false);
});

it("keeps application scheduling in the combined server and out of native owners", async () => {
  vi.resetModules();
  const mode = await import("@/backend/runtime/RunsMode");
  const owner = await import("@/backend/agents/local/LocalSessionMode");
  mode.setRunsOwnership(true);
  expect(mode.canProcessApiWork()).toBe(true);
  owner.enterLocalSessionOwner("/synthetic/owner");
  expect(mode.canProcessApiWork()).toBe(false);
  expect(mode.canProcessRuns()).toBe(false);
});

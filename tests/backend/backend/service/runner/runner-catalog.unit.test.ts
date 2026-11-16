import { afterEach, expect, it, vi } from "vitest";

import {
  compatibleRunnerCatalog,
  isRunnerCatalogCurrent,
  mergeRunnerCatalog,
} from "@/backend/service/runner/RunnerCatalog";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunnerCatalog, RunnerMessage } from "@/definition/RunnerProtocol";

const OLD = partial<RunnerCatalog>({
  generation: 1,
  isComplete: true,
  checkedAt: "2026-01-01T00:00:00Z",
  interpreters: [{ id: "old" }],
  tools: [{ tool: "antigravity" }],
  removedInterpreterIds: [],
});

it("retains the previous catalog for absent or replayed inventory", () => {
  expect(
    mergeRunnerCatalog(
      OLD,
      partial<Extract<RunnerMessage, { type: "reconcile" }>>({}),
    ),
  ).toMatchObject({ isComplete: false });
  expect(
    mergeRunnerCatalog(
      OLD,
      partial<Extract<RunnerMessage, { type: "catalog" }>>({ catalog: OLD }),
    ),
  ).toBe(OLD);
  expect(
    mergeRunnerCatalog(
      undefined,
      partial<Extract<RunnerMessage, { type: "reconcile" }>>({}),
    ),
  ).toBeUndefined();
});

it("retains omitted interpreters and marks removals only after complete probes", () => {
  const incoming = partial<RunnerCatalog>({
    generation: 2,
    isComplete: true,
    areToolsComplete: false,
    interpreters: [{ id: "new" }],
    tools: [],
  });
  const merged = mergeRunnerCatalog(
    OLD,
    partial<Extract<RunnerMessage, { type: "catalog" }>>({ catalog: incoming }),
  );
  expect(merged).toMatchObject({
    interpreters: [{ id: "new" }, { id: "old" }],
    removedInterpreterIds: ["old"],
    tools: OLD.tools,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

it("requires recent inventory and removes incompatible runner capabilities", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
  expect(isRunnerCatalogCurrent(OLD)).toBe(true);
  vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
  expect(isRunnerCatalogCurrent(OLD)).toBe(false);
  expect(isRunnerCatalogCurrent({ ...OLD, isComplete: false })).toBe(false);
  expect(compatibleRunnerCatalog(OLD, undefined)).toMatchObject({
    tools: [{ tool: "antigravity", acp: { status: "incompatible" } }],
  });
});

import { expect, it } from "vitest";

import {
  requireRunnerOutputExecutor,
  supportsRunnerAntigravity,
} from "@/backend/service/runner/RunnerOutputCapabilities";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunnerExecution } from "@/definition/RunnerExecution";

const INPUT = {
  execution: partial<RunnerExecution>({
    program: { kind: "cli", route: { tool: "codex" } },
    resultPayloadVersion: 1,
  }),
  executionLeaseVersion: 1 as const,
  isOnline: true,
  hasCommunication: true,
  hasExactPayload: true,
  hasOutputJournal: true,
  hasLiveHistory: true,
};

it("requires connectivity, leases and the complete CLI result contract", () => {
  expect(() => requireRunnerOutputExecutor(INPUT)).not.toThrow();
  expect(() =>
    requireRunnerOutputExecutor({ ...INPUT, isOnline: false }),
  ).toThrow();
  expect(() =>
    requireRunnerOutputExecutor({ ...INPUT, hasCommunication: false }),
  ).toThrow();
  expect(() =>
    requireRunnerOutputExecutor({ ...INPUT, hasExactPayload: false }),
  ).toThrow();
  expect(() =>
    requireRunnerOutputExecutor({ ...INPUT, hasOutputJournal: false }),
  ).toThrow();
  expect(() =>
    requireRunnerOutputExecutor({ ...INPUT, hasLiveHistory: false }),
  ).toThrow();
});

it("requires a compatible runner version for Antigravity", () => {
  expect(supportsRunnerAntigravity(undefined)).toBe(false);
  expect(supportsRunnerAntigravity("1.13.9")).toBe(false);
  expect(supportsRunnerAntigravity("1.14.0")).toBe(true);
  expect(supportsRunnerAntigravity("2.0.0")).toBe(true);
  const execution = partial<RunnerExecution>({
    ...INPUT.execution,
    program: { kind: "cli", route: { tool: "antigravity" } },
  });
  expect(() =>
    requireRunnerOutputExecutor({
      ...INPUT,
      execution,
      runnerVersion: "1.13.9",
    }),
  ).toThrow();
  expect(() =>
    requireRunnerOutputExecutor({
      ...INPUT,
      execution,
      runnerVersion: "1.14.0",
    }),
  ).not.toThrow();
});

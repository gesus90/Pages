import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanEndedRuns } from "@/backend/service/agents/AgentPlanEndedRuns";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { EndedRunPorts } from "@/backend/service/agents/AgentPlanEndedRuns";
import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";

const resumeEnded = vi.fn();
const stopRun = vi.fn();
const findRun = vi.fn();
const readRun = vi.fn();
const control = vi.fn();
const isActive = vi.fn();
const sleep = vi.fn();
const ports = partial<EndedRunPorts>({
  advisor: { current: { resumeEnded, stopRun } },
  engine: { isActive },
  findRun,
  readRun,
  control,
  sleep,
});
const service = new AgentPlanEndedRuns(ports);
const run = partial<AgentPlanRun>({
  id: "run",
  planId: "plan",
  status: "failed",
});
const plan = partial<AgentPlanView>({ revision: 4 });

beforeEach(() => {
  vi.resetAllMocks();
  control.mockResolvedValue({ runId: "run", canResume: true });
  resumeEnded.mockResolvedValue({ runId: "new" });
  readRun.mockResolvedValue({ id: "new" });
});

it("resumes only the run approved by current controls", async () => {
  expect(await service.resume("user", run, plan)).toEqual({ id: "new" });
  expect(resumeEnded).toHaveBeenCalledWith("user", "run", 4, undefined);
  control.mockResolvedValueOnce({ runId: "other", canResume: false });
  await expect(service.resume("user", run, plan)).rejects.toThrow();
});

it("settles resumable endings and forces only stuck or unowned runs", async () => {
  expect(await service.settleEnded("user", run)).toBe(true);
  expect(
    await service.settleEnded("user", { ...run, status: "succeeded" }),
  ).toBe(false);
  isActive.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await service.forceStuck("user", { ...run, status: "running" });
  await service.forceStuck("user", { ...run, status: "running" });
  expect(stopRun).toHaveBeenCalledTimes(2);
});

it("waits for an open run to close and refuses after the bounded poll limit", async () => {
  const stop = vi.fn();
  findRun
    .mockResolvedValueOnce({ ...run, status: "running" })
    .mockResolvedValueOnce({ ...run, status: "failed" });
  await service.endOpenRun("user", "run", stop);
  expect(stop).toHaveBeenCalledOnce();
  expect(sleep).toHaveBeenCalledOnce();
  findRun.mockResolvedValue({ ...run, status: "running" });
  await expect(service.endOpenRun("user", "run", stop)).rejects.toThrow();
  expect(sleep).toHaveBeenCalledTimes(41);
});

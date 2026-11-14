import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { PlanRunCommandRepository } from "@/backend/database/repositories/agent/PlanRunCommandRepository";
import { AgentPlanStartResources } from "@/backend/service/agents/AgentPlanStartResources";
import { QueuedPlanRunEngine } from "@/backend/service/agents/runs/QueuedPlanRunEngine";
import { releaseRunsStartResources } from "@/backend/service/agents/runs/RunsSocket";
import { pagesRunsStartResourcesSchema } from "@/definition/PagesRuns";

import { RecoveryDatabase } from "./page84-recovery-database";
import { parameterRunFixture } from "./page55-run-fixture";

vi.mock("@/backend/service/agents/runs/RunsSocket", () => ({
  releaseRunsStartResources: vi.fn(), notifyRuns: vi.fn(async () => true), queryRunOwnership: vi.fn(),
}));

beforeEach(() => {
  vi.spyOn(AgentPlanRunRepository.prototype, "prepareSnapshot").mockResolvedValue();
  vi.spyOn(AgentPlanRunRepository.prototype, "insert").mockResolvedValue();
  vi.spyOn(PlanRunCommandRepository.prototype, "insert").mockResolvedValue();
});

it("asks the elected native owner to force cleanup before the separate API reserves the new run", async () => {
  const fixture = await parameterRunFixture();
  const order: string[] = [];
  vi.mocked(releaseRunsStartResources).mockImplementation(async () => { order.push("cleanup"); return ["uncertain-old-run"]; });
  vi.mocked(AgentPlanRunRepository.prototype.insert).mockImplementation(async () => { order.push("reserve"); });
  const engine = new QueuedPlanRunEngine(new RecoveryDatabase(fixture.snapshot).asDatabase(), "/synthetic/engine.sock");
  const next = await engine.start("owner", fixture.snapshot);
  expect(order).toEqual(["cleanup", "reserve"]);
  expect(next.startCleanupUnconfirmed).toEqual(["uncertain-old-run"]);
  expect(next.command?.action).toBe("start");
  expect(PlanRunCommandRepository.prototype.insert).toHaveBeenCalledOnce();
});

it("an unreachable elected process uses durable forced release and still admits the new run", async () => {
  const fixture = await parameterRunFixture();
  vi.mocked(releaseRunsStartResources).mockRejectedValue(new Error("Owner offline"));
  const release = vi.spyOn(AgentPlanStartResources.prototype, "release").mockResolvedValue(["old-run"]);
  const engine = new QueuedPlanRunEngine(new RecoveryDatabase(fixture.snapshot).asDatabase(), "/synthetic/engine.sock");
  const next = await engine.start("owner", fixture.snapshot);
  expect(release).toHaveBeenCalledOnce();
  expect(next.startCleanupUnconfirmed).toEqual(["old-run"]);
  expect(AgentPlanRunRepository.prototype.insert).toHaveBeenCalledOnce();
});

it("keeps the start cleanup protocol restricted to identities and resource keys", () => {
  const request = { version: 1, operation: "start_resources", start: { id: "new-run", planId: "plan", userId: "owner" }, resourceKeys: ["local-directory:/synthetic"] };
  expect(pagesRunsStartResourcesSchema.safeParse(request).success).toBe(true);
  expect(pagesRunsStartResourcesSchema.safeParse({ ...request, snapshot: { privatePrompt: "never sent" } }).success).toBe(false);
});

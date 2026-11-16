import { expect, it, vi } from "vitest";

import { PagesPicaMobilePlans } from "@/backend/service/mobile/plans/PagesPicaMobilePlans";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AuthService } from "@/backend/auth/AuthService";
import type { AgentPlanOverviewService } from "@/backend/service/agents/AgentPlanOverview";
import type { PicaMobileSessionIdentity } from "@/backend/service/mobile/PicaMobileDashboardProvider";

const session = partial<PicaMobileSessionIdentity>({
  userId: "user",
  sessionToken: "token",
});

it("rechecks the session on every read before requesting plan data", async () => {
  const getAuthenticatedUser = vi
    .fn<AuthService["getAuthenticatedUser"]>()
    .mockResolvedValue(null);
  const read = vi.fn();
  const readPlan = vi.fn();
  const provider = new PagesPicaMobilePlans({
    resolveServices: async () =>
      partial({
        authService: { getAuthenticatedUser },
        agentPlanOverviewService: { read, readPlan },
      }),
    observer: { watch: vi.fn() },
  });
  const reader = provider.open();
  await expect(
    reader.readPlans(session, { withState: false }),
  ).resolves.toEqual({ kind: "sessionEnded" });
  await expect(
    reader.readPlan(session, "plan", { withFlow: false }),
  ).resolves.toEqual({ kind: "sessionEnded" });
  expect(getAuthenticatedUser).toHaveBeenCalledTimes(2);
  expect(read).not.toHaveBeenCalled();
  expect(readPlan).not.toHaveBeenCalled();
});

it("returns gone and empty plans without exposing another account", async () => {
  const getAuthenticatedUser = vi
    .fn<AuthService["getAuthenticatedUser"]>()
    .mockResolvedValue(
      partial({ id: "user", isActive: true, mustChangePassword: false }),
    );
  const read = vi.fn<AgentPlanOverviewService["read"]>().mockResolvedValue([]);
  const readPlan = vi
    .fn<AgentPlanOverviewService["readPlan"]>()
    .mockResolvedValueOnce({ kind: "gone" })
    .mockResolvedValueOnce(partial({ kind: "ok", run: null }));
  const stop = vi.fn();
  const watch = vi.fn(() => stop);
  const provider = new PagesPicaMobilePlans({
    resolveServices: async () =>
      partial({
        authService: { getAuthenticatedUser },
        agentPlanOverviewService: { read, readPlan },
      }),
    observer: { watch },
  });
  const reader = provider.open();
  await expect(
    reader.readPlans(session, { withState: false }),
  ).resolves.toEqual({ kind: "ready", rows: [] });
  await expect(
    reader.readPlan(session, "plan", { withFlow: false }),
  ).resolves.toEqual({
    kind: "ready",
    payload: { planId: "plan", access: "gone" },
  });
  await expect(
    reader.readPlan(session, "plan", { withFlow: false }),
  ).resolves.toEqual({
    kind: "ready",
    payload: { planId: "plan", access: "ok", run: null },
  });
  expect(readPlan).toHaveBeenCalledWith("user", "plan");
  expect(provider.watch("user", () => undefined)).toBe(stop);
});

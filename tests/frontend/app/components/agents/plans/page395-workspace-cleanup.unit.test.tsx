import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanWorkspaceCleanup } from "@/app/components/agents/plans/plan-workspace-cleanup";

import { i18n, renderTranslated } from "./plan-panel-fixture";

import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";

const ENTRY: AgentWorkspaceCleanup = {
  workspaceId: "workspace",
  workspaceName: "Synthetic workspace",
  runId: "run-395",
  ownerId: "owner",
  state: "needs_decision",
  blocker: "process_scan_unavailable",
  updatedAt: "2026-11-14T12:00:00Z",
};

it("shows the stopped automatic check with its blocker and submits an explicit retry", async () => {
  const request = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 200 }),
  );
  vi.stubGlobal("fetch", request);
  renderTranslated(
    <PlanWorkspaceCleanup entries={[ENTRY]} planId="plan-395" />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    i18n.t("plans.recovery.cleanupNeedsDecision"),
  );
  expect(screen.getByRole("status").textContent).toContain(
    i18n.t("plans.recovery.cleanupBlocker.process_scan_unavailable"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.recovery.cleanupRetry") }),
  );
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0]?.[0]).toBe("/agent-api/plan-runs");
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
    action: "retry",
    runId: ENTRY.runId,
    workspaceId: ENTRY.workspaceId,
    planId: "plan-395",
  });
});

it("requires the person's process-end attestation before releasing an obligation", async () => {
  const request = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 200 }),
  );
  vi.stubGlobal("fetch", request);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderTranslated(
    <PlanWorkspaceCleanup entries={[ENTRY]} planId="plan-395" />,
  );
  const release = screen.getByRole("button", {
    name: i18n.t("plans.recovery.cleanupRelease"),
  });
  fireEvent.click(release);
  expect(request).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(release);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
    action: "release",
    processEndVerified: true,
  });
});

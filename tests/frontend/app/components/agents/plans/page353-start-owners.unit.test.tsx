import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanOpenRunStartDialog } from "@/app/components/agents/plans/plan-open-run-start-dialog";
import { PlanResourceReleases } from "@/app/components/agents/plans/plan-resource-releases";
import { usePlanStartOwners } from "@/app/components/agents/plans/use-plan-start-owners";
import { PlanRecoveryResumeDialog } from "@/app/components/agents/plans/plan-recovery/plan-recovery-resume-dialog";

import {
  i18n,
  recoveryState,
  recoveryView,
  renderTranslated,
} from "./plan-panel-fixture";
import { syntheticRun } from "../page72-run-fixture";

const OWNERS = [
  {
    runId: "old-run",
    planName: "Another plan on this directory",
    startedAt: "2026-11-13T11:11:00.000Z",
  },
];

it("names the active run of another plan and sends nothing until its stop is confirmed", () => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  renderTranslated(
    <PlanOpenRunStartDialog
      owners={OWNERS}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  expect(
    screen.getByText(/Another plan on this directory · old-run/u),
  ).toBeDefined();
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.openRun.confirm") }),
  );
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it("also names affected owners in the existing restart confirmation", () => {
  renderTranslated(
    <PlanRecoveryResumeDialog
      owners={OWNERS}
      recovery={recoveryState({
        view: recoveryView({ restart: { available: true, reason: null } }),
      })}
      onClose={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/Another plan on this directory · old-run/u),
  ).toBeDefined();
  expect(
    screen
      .getByRole("button", { name: i18n.t("plans.recovery.restartAction") })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("reads affected owners for the saved revision without issuing a start request", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ owners: OWNERS }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => usePlanStartOwners("plan", 3));
  await act(async () => {
    expect(await result.current.inspect()).toEqual(OWNERS);
  });
  expect(result.current.owners).toEqual(OWNERS);
  const fields = fetchMock.mock.calls[0]?.[1]?.body;
  expect(fields).toBeInstanceOf(FormData);
  if (!(fields instanceof FormData)) throw new Error("Missing form");
  expect(Object.fromEntries(fields)).toEqual({
    intent: "inspect-plan-start",
    planId: "plan",
    revision: "3",
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("shows unconfirmed cleanup as an informational hint and old-run release details as history", () => {
  const run = {
    ...syntheticRun(),
    startCleanupUnconfirmed: ["old-run"],
    resourceReleases: [
      {
        id: "release",
        userId: "Igor",
        targetRunId: "new-run",
        createdAt: "2026-11-13T13:44:00.000Z",
        resources: ["local-directory:/synthetic", "local-git-branch:branch"],
        confirmed: false,
        processes: [
          {
            instanceId: "old-process",
            processId: 1234,
            kind: "local_session" as const,
            confirmed: false,
          },
        ],
      },
    ],
  };
  renderTranslated(<PlanResourceReleases run={run} />);
  expect(screen.getByRole("status").textContent).toContain(
    "new run starts anyway",
  );
  expect(screen.getByRole("status").textContent).toContain("Igor");
  expect(screen.getByRole("status").textContent).toContain(
    "local-directory:/synthetic",
  );
  expect(screen.getByRole("status").textContent).toContain(
    "old-process · 1234",
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PlanRunCommunication } from "@/app/components/agents/plans/plan-run-communication";

import {
  i18n,
  REMOTE_TARGET,
  remoteProgress,
  renderTranslated,
  runStep,
  stepExecution,
} from "./plan-panel-fixture";

import type { AgentPlanRemoteProgress } from "@/definition/AgentPlanExecution";

const REQUESTED = "2026-10-15T10:00:00.000Z";

function renderRemote(
  remote: AgentPlanRemoteProgress | undefined,
): HTMLElement {
  return renderTranslated(
    <PlanRunCommunication
      step={runStep("step", {
        execution: stepExecution(REMOTE_TARGET),
        remote,
      })}
    />,
  ).container;
}

function notes(): readonly (string | null)[] {
  return [...screen.getByRole("status").querySelectorAll(":scope > p")].map(
    (note) => note.textContent,
  );
}

function value(name: string): string | null | undefined {
  return screen.getByText(i18n.t(`plans.communication.${name}`))
    .nextElementSibling?.textContent;
}

it("says nothing about a local step", () => {
  const { container } = renderTranslated(
    <PlanRunCommunication
      step={runStep("step", { execution: stepExecution() })}
    />,
  );
  expect(container.textContent).toBe("");
  const unbound = renderTranslated(
    <PlanRunCommunication step={runStep("x")} />,
  );

  expect(unbound.container.textContent).toBe("");
});

it("says that the state of a remote step without a report is unknown", () => {
  renderRemote(undefined);

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("plans.communication.unknown"),
  );
});

it("separates the confirmed state, the connection and the identifiers", () => {
  renderRemote(
    remoteProgress({
      status: "completed",
      contact: { state: "connected", lastContactAt: REQUESTED },
      observedAt: REQUESTED,
      queueReason: "capacity",
      historyPending: 3,
    }),
  );

  expect(value("confirmed")).toBe(
    i18n.t("plans.communication.status.completed"),
  );
  expect(value("connection")).toBe(
    i18n.t("plans.communication.connectionState.connected"),
  );
  expect(value("contact")).toBe(REQUESTED);
  expect(value("observed")).toBe(REQUESTED);
  expect(value("job")).toBe("00000000-0000-4000-8000-000000000002");
  expect(value("attempt")).toBe("00000000-0000-4000-8000-000000000001");
  expect(value("session")).toBe("00000000-0000-4000-8000-000000000003");
  expect(notes()).toEqual([
    i18n.t("plans.communication.queue.capacity"),
    i18n.t("plans.communication.stopPolicy"),
    i18n.t("plans.communication.historyDeferred", { count: 3 }),
  ]);
});

it("names unknown contact facts and a lost channel of an active job", () => {
  renderRemote(remoteProgress());

  expect(value("connection")).toBe(
    i18n.t("plans.communication.connectionState.unknown"),
  );
  expect(value("contact")).toBe(i18n.t("plans.communication.unknown"));
  expect(value("observed")).toBe(i18n.t("plans.communication.unknown"));
  expect(notes()).toEqual([
    i18n.t("plans.communication.stopPolicy"),
    i18n.t("plans.communication.disconnected"),
  ]);
});

it("names a quiet worker on a live channel", () => {
  renderRemote(
    remoteProgress({
      contact: { state: "connected", lastContactAt: null },
      isObservationStale: true,
    }),
  );

  expect(notes()).toContain(i18n.t("plans.communication.workerStale"));
});

it.each<[string, Partial<AgentPlanRemoteProgress>, readonly string[]]>([
  [
    "a failed stop with its cause",
    {
      cancellation: {
        requestedAt: REQUESTED,
        closeout: "failed",
        failure: "signal_denied",
      },
    },
    [
      `${i18n.t("plans.communication.stopFailed")} ${i18n.t("plans.communication.stopFailure.signal_denied")}`,
    ],
  ],
  [
    "a failed closeout after a stop",
    { cancellation: { requestedAt: REQUESTED }, closeout: "failed" },
    [`${i18n.t("plans.communication.stopFailed")} `],
  ],
  [
    "a confirmed stop",
    { cancellation: { requestedAt: REQUESTED, closeout: "confirmed" } },
    [i18n.t("plans.communication.stopConfirmed")],
  ],
  [
    "a delivered stop",
    { cancellation: { requestedAt: REQUESTED, receivedAt: REQUESTED } },
    [i18n.t("plans.communication.stopReceived")],
  ],
  [
    "a stored stop",
    { cancellation: { requestedAt: REQUESTED } },
    [i18n.t("plans.communication.stopPending")],
  ],
])("names %s", (name, overrides, expected) => {
  renderRemote(
    remoteProgress({
      contact: { state: "connected", lastContactAt: REQUESTED },
      ...overrides,
    }),
  );

  expect(notes().slice(1)).toEqual(expected);
});

it.each([
  ["confirmed", "plans.communication.stopConfirmed"],
  ["pending", "plans.communication.stopUnconfirmed"],
] as const)("names an interrupted job whose end is %s", (closeout, key) => {
  renderRemote(remoteProgress({ status: "interrupted", closeout }));

  expect(notes().slice(1)).toEqual([i18n.t(key)]);
});

it("says nothing more about a stop or a lost channel of an ended job", () => {
  renderRemote(
    remoteProgress({
      status: "completed",
      contact: { state: "lost", lastContactAt: null },
      cancellation: { requestedAt: REQUESTED },
    }),
  );

  expect(notes()).toEqual([i18n.t("plans.communication.stopPolicy")]);
});

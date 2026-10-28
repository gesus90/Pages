import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, it, vi } from "vitest";

import { PlanStartHistory } from "@/app/components/agents/plans/plan-start-history";

import { i18n } from "./plan-panel-fixture";

import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";

const REJECTION: AgentPlanStartRejection = {
  id: "older",
  createdAt: "2026-10-28T12:00:00Z",
  action: "play",
  planRevision: 2,
  isSavedRevision: true,
  error: "plan_invalid",
  conflict: null,
  reservation: "not_requested",
  targetResolution: "unknown",
};

it("pages explicitly, retries a failed page at the same cursor and marks completion", async () => {
  const queries: string[] = [];
  const response = vi
    .fn<() => unknown>()
    .mockReturnValueOnce({
      ok: true,
      planId: "plan",
      history: { entry: REJECTION, nextBefore: "older" },
    })
    .mockReturnValueOnce({ ok: false })
    .mockReturnValueOnce({
      ok: true,
      planId: "plan",
      history: { entry: null, nextBefore: null },
    });
  const router = createMemoryRouter([
    {
      path: "/",
      element: <PlanStartHistory planId="plan" latestId="newest" />,
    },
    {
      path: "/agent-api/plan-runs",
      loader: ({ request }) => {
        queries.push(new URL(request.url).search);
        return Response.json(response());
      },
    },
  ]);
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  expect(queries).toEqual([]);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText(
    i18n.t("plans.panel.historicalStartRejection", {
      time: new Date(REJECTION.createdAt).toLocaleString(),
      revision: 2,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText(i18n.t("plans.panel.historyEnd"));
  expect(queries).toEqual([
    "?planId=plan&startRejections=true&before=newest",
    "?planId=plan&startRejections=true&before=older",
    "?planId=plan&startRejections=true&before=older",
  ]);
  expect(screen.queryByRole("button")).toBeNull();
});

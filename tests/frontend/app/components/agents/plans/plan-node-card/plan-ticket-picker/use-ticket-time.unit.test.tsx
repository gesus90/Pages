import { renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RegionProvider } from "@/app/components/common/region-provider";
import { useTicketTime } from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/use-ticket-time";

import { i18n } from "../../plan-flow-fixture";
import { ticket } from "./ticket-picker-fixture";

import type { TicketTime } from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/use-ticket-time";
import type { AgentPlanTask } from "@/definition/AgentPlan";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function describeTime(
  task: AgentPlanTask,
  sort: "title" | "created" | "updated",
): TicketTime {
  const { result } = renderHook(() => useTicketTime(), {
    wrapper: ({ children }) => (
      <I18nextProvider i18n={i18n}>
        <RegionProvider
          region={{ timezone: "Europe/London", dateFormat: "DD.MM.YYYY" }}
        >
          {children}
        </RegionProvider>
      </I18nextProvider>
    ),
  });
  return result.current(task, sort);
}

const TASK = ticket("1", {
  createdAt: "2026-03-09 18:40:00",
  updatedAt: "2026-03-10 09:15:00",
});
const EXACT = i18n.t("plans.ticketPicker.time.exact", {
  created: "09.03.2026 18:40",
  updated: "10.03.2026 09:15",
});

it("shows the change time of today for every order but creation", () => {
  for (const sort of ["updated", "title"] as const)
    expect(describeTime(TASK, sort)).toEqual({
      text: i18n.t("plans.ticketPicker.time.updated.today", { time: "09:15" }),
      dateTime: "2026-03-10T09:15:00.000Z",
      exact: EXACT,
    });
});

it("shows the creation time of yesterday when ordered by creation", () => {
  expect(describeTime(TASK, "created")).toEqual({
    text: i18n.t("plans.ticketPicker.time.created.yesterday", {
      time: "18:40",
    }),
    dateTime: "2026-03-09T18:40:00.000Z",
    exact: EXACT,
  });
});

it("shows the date of an older time", () => {
  const old = ticket("2", {
    createdAt: "2026-01-05 07:05:00",
    updatedAt: "2026-01-05 07:05:00",
  });
  expect(describeTime(old, "updated").text).toBe(
    i18n.t("plans.ticketPicker.time.updated.other", {
      date: "05.01.2026",
      time: "07:05",
    }),
  );
});

it("says that a time is missing or unreadable instead of borrowing the current time", () => {
  const missing = ticket("3", { createdAt: "2026-03-01", updatedAt: "" });
  const created = describeTime(missing, "created");
  expect(created).toEqual({
    text: i18n.t("plans.ticketPicker.time.created.missing"),
    dateTime: undefined,
    exact: i18n.t("plans.ticketPicker.time.exact", {
      created: "01.03.2026",
      updated: "---",
    }),
  });
  expect(describeTime(missing, "updated").text).toBe(
    i18n.t("plans.ticketPicker.time.updated.missing"),
  );
  expect(describeTime(ticket("4", { createdAt: "" }), "created").text).toBe(
    i18n.t("plans.ticketPicker.time.created.missing"),
  );
});

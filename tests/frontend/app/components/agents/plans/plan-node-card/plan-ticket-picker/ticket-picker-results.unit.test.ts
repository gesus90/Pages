import { expect, it } from "vitest";

import {
  DEFAULT_TICKET_QUERY,
  findTickets,
  isFilteredTicketQuery,
  phaseTone,
} from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/ticket-picker-results";

import { ticket } from "./ticket-picker-fixture";

import type { TicketQuery } from "@/app/components/agents/plans/plan-node-card/plan-ticket-picker/ticket-picker-results";
import type { AgentPlanTask } from "@/definition/AgentPlan";

const COLLATOR = new Intl.Collator("de", {
  numeric: true,
  sensitivity: "base",
});

function ids(
  tasks: readonly AgentPlanTask[],
  query: Partial<TicketQuery>,
): readonly string[] {
  return findTickets(
    tasks,
    { ...DEFAULT_TICKET_QUERY, ...query },
    COLLATOR,
  ).map((task) => task.id);
}

it("matches every search word in key or title, in any case, and phases with OR", () => {
  const tasks = [
    ticket("1", { title: "Fix login page" }),
    ticket("2", { title: "Login audit", statusKey: "review" }),
    ticket("3", { title: "Other", statusKey: "done" }),
  ];
  expect(ids(tasks, { text: "  LOGIN   fix " })).toEqual(["1"]);
  expect(ids(tasks, { text: "syn-3" })).toEqual(["3"]);
  expect(ids(tasks, { phases: ["review", "done"] })).toEqual(["2", "3"]);
  expect(ids(tasks, { text: "login", phases: ["done"] })).toEqual([]);
});

it("orders titles alphabetically in both directions, then by key and identifier", () => {
  const tasks = [
    ticket("b", { key: "SYN-2", title: "beta" }),
    ticket("a", { key: "SYN-10", title: "Alpha" }),
    ticket("c", { key: "SYN-2", title: "Beta" }),
    ticket("d", { key: "SYN-1", title: "beta" }),
  ];
  expect(ids(tasks, { sort: "title", direction: "asc" })).toEqual([
    "a",
    "d",
    "b",
    "c",
  ]);
  expect(ids(tasks, { sort: "title", direction: "desc" })).toEqual([
    "d",
    "b",
    "c",
    "a",
  ]);
});

it("keeps one stable order of equal tickets by their identifier, also for a listed duplicate", () => {
  const same = { key: "SYN-1", title: "Same" };
  const tasks = [
    ticket("z", same),
    ticket("x", same),
    ticket("y", same),
    ticket("x", same),
  ];
  expect(ids(tasks, { sort: "title", direction: "asc" })).toEqual([
    "x",
    "x",
    "y",
    "z",
  ]);
});

it("orders by creation or change time and keeps tickets without a readable time last", () => {
  const tasks = [
    ticket("old", {
      createdAt: "2026-01-01 08:00:00",
      updatedAt: "2026-03-01 08:00:00",
    }),
    ticket("new", {
      createdAt: "2026-02-01 08:00:00",
      updatedAt: "2026-01-01 08:00:00",
    }),
    ticket("none", { createdAt: "", updatedAt: "" }),
    ticket("date", { createdAt: "2026-02-03", updatedAt: "garbage" }),
  ];
  expect(ids(tasks, { sort: "created", direction: "desc" })).toEqual([
    "new",
    "old",
    "date",
    "none",
  ]);
  expect(ids(tasks, { sort: "created", direction: "asc" })).toEqual([
    "old",
    "new",
    "date",
    "none",
  ]);
  expect(ids(tasks, { sort: "updated", direction: "desc" })).toEqual([
    "old",
    "new",
    "date",
    "none",
  ]);
});

it("reports whether a search word or a phase hides tickets", () => {
  expect(isFilteredTicketQuery(DEFAULT_TICKET_QUERY)).toBe(false);
  expect(isFilteredTicketQuery({ ...DEFAULT_TICKET_QUERY, text: "   " })).toBe(
    false,
  );
  expect(isFilteredTicketQuery({ ...DEFAULT_TICKET_QUERY, text: "x" })).toBe(
    true,
  );
  expect(
    isFilteredTicketQuery({ ...DEFAULT_TICKET_QUERY, phases: ["todo"] }),
  ).toBe(true);
});

it("colors finished, ongoing and review phases and keeps every other phase neutral", () => {
  expect(phaseTone({ key: "custom", isDone: true })).toBe("done");
  expect(phaseTone({ key: "in_progress", isDone: false })).toBe("progress");
  expect(phaseTone({ key: "review", isDone: false })).toBe("review");
  expect(phaseTone({ key: "todo", isDone: false })).toBe("neutral");
});

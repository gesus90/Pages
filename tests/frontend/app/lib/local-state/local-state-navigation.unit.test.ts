import { expect, it } from "vitest";

import { isLocalStateNavigation } from "@/app/lib/local-state/local-state-navigation";

import type { ShouldRevalidateFunctionArgs } from "react-router";

function navigation(
  current: string,
  next: string,
  extra: Partial<ShouldRevalidateFunctionArgs> = {},
): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL(`http://pages.invalid${current}`),
    nextUrl: new URL(`http://pages.invalid${next}`),
    currentParams: {},
    nextParams: {},
    defaultShouldRevalidate: true,
    ...extra,
  };
}

it.each([
  "/agents/plans",
  "/agents/workspaces",
  "/agents/agents",
  "/dashboard",
  "/users",
  "/settings",
  "/settings/system",
  "/settings/connections/access",
  "/aufgaben",
  "/aufgaben/ZP-1",
  "/tasks",
  "/tasks/ZP-1",
  "/projekte",
  "/projekte/zp",
  "/wiki",
  "/wiki/home",
  "/wiki/home/child",
])("opens %s from the browser's local state", (path) => {
  expect(isLocalStateNavigation(navigation("/elsewhere", path))).toBe(true);
});

it.each([
  "/",
  "/agents",
  "/agents/other",
  "/settings/a/b/c",
  "/aufgaben/a/b",
  "/projekte/a/b",
  "/wiki/a/b/c",
  "/login",
])("does not treat %s as a local-state route", (path) => {
  expect(isLocalStateNavigation(navigation("/elsewhere", path))).toBe(false);
});

it("ignores the query when matching the route", () => {
  expect(
    isLocalStateNavigation(navigation("/tasks", "/tasks?view=kanban")),
  ).toBe(true);
});

it("reads again when a form was submitted", () => {
  expect(
    isLocalStateNavigation(
      navigation("/elsewhere", "/tasks", { formMethod: "POST" }),
    ),
  ).toBe(false);
});

it("reads again after an action answered", () => {
  expect(
    isLocalStateNavigation(
      navigation("/elsewhere", "/tasks", { actionResult: { ok: true } }),
    ),
  ).toBe(false);
});

it("reads again when the address did not change", () => {
  expect(isLocalStateNavigation(navigation("/tasks?a=1", "/tasks?a=1"))).toBe(
    false,
  );
});

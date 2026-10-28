// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import TasksLayout, {
  loader,
  shouldRevalidate,
} from "@/app/routes/tasks-layout";

import {
  ACTOR,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

import type { ShouldRevalidateFunctionArgs } from "react-router";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const tree = vi.hoisted(() => ({
  findEntries: vi.fn(),
  findExpandedKeys: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    ticketTreeService: tree,
  }),
}));

const BOARD = "http://pages.invalid/aufgaben";

/**
 * Revalidation arguments for a move between two addresses.
 *
 * @param nextUrl - Address the visitor moves to.
 * @param formData - The submitted form, if any.
 */
function revalidation(
  nextUrl: string,
  formData?: FormData,
): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL(BOARD),
    currentParams: {},
    nextUrl: new URL(nextUrl),
    nextParams: {},
    formData,
    defaultShouldRevalidate: true,
  };
}

/**
 * A form that carries one intent.
 *
 * @param intent - The submitted intent.
 */
function intentForm(intent: string): FormData {
  const form = new FormData();
  form.set("intent", intent);
  return form;
}

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/aufgaben"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("loads the visible tree and its opened branches", async () => {
  tree.findEntries.mockResolvedValue([{ key: "PAGE-1" }]);
  tree.findExpandedKeys.mockResolvedValue(["PAGE-1"]);

  await expect(
    loader(routeArguments(pagesRequest("/aufgaben"), { user: ACTOR })),
  ).resolves.toEqual({
    entries: [{ key: "PAGE-1" }],
    expandedKeys: ["PAGE-1"],
  });
});

it("keeps the tree for changes that do not affect it", () => {
  expect(
    shouldRevalidate(revalidation(BOARD, intentForm("set-tree-expanded"))),
  ).toBe(false);
  expect(
    shouldRevalidate(revalidation(BOARD, intentForm("save-board-preferences"))),
  ).toBe(false);
});

it("reloads the tree after other changes and on refresh", () => {
  expect(shouldRevalidate(revalidation(BOARD, intentForm("update-task")))).toBe(
    true,
  );
  expect(shouldRevalidate(revalidation(BOARD))).toBe(true);
});

it("keeps the tree when the visitor only moves between ticket pages", () => {
  expect(shouldRevalidate(revalidation(`${BOARD}/PAGE-1`))).toBe(false);
});

it("renders the ticket page inside the layout", () => {
  renderRoute(TasksLayout, {
    loaderData: { entries: [], expandedKeys: [] },
    children: [
      { index: true, Component: (): React.ReactElement => <p>ticket</p> },
    ],
  });

  expect(screen.getByText("ticket")).toBeTruthy();
});

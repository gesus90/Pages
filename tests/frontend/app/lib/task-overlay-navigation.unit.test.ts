import { expect, it } from "vitest";

import {
  isTaskOverlayMutation,
  isTaskOverlayNavigation,
} from "@/app/lib/task-overlay-navigation";

import type { ShouldRevalidateFunctionArgs } from "react-router";

function navigation(
  current: string,
  next: string,
  formData?: FormData,
): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL(`http://pages.invalid${current}`),
    nextUrl: new URL(`http://pages.invalid${next}`),
    currentParams: {},
    nextParams: {},
    defaultShouldRevalidate: true,
    formData,
  };
}

it("recognizes only opening or closing a detail on the same board", () => {
  expect(
    isTaskOverlayNavigation(
      navigation("/aufgaben?view=kanban", "/aufgaben?view=kanban&item=ZP-1"),
    ),
  ).toBe(true);
  expect(
    isTaskOverlayNavigation(navigation("/tasks?item=ZP-1", "/tasks")),
  ).toBe(true);
  expect(
    isTaskOverlayNavigation(
      navigation("/aufgaben?view=kanban", "/aufgaben?view=list&item=ZP-1"),
    ),
  ).toBe(false);
  expect(
    isTaskOverlayNavigation(navigation("/aufgaben", "/tasks?item=ZP-1")),
  ).toBe(false);
  expect(
    isTaskOverlayNavigation(
      navigation("/aufgaben", "/aufgaben?item=ZP-1", new FormData()),
    ),
  ).toBe(false);
  expect(
    isTaskOverlayNavigation(
      navigation("/aufgaben?item=ZP-1", "/aufgaben?item=ZP-1"),
    ),
  ).toBe(false);
});

it("keeps shell data only after a successful ticket change in the overlay", () => {
  const form = new FormData();
  form.set("intent", "change-parent");
  const args = navigation("/aufgaben?item=ZP-1", "/aufgaben?item=ZP-1", form);
  expect(isTaskOverlayMutation({ ...args, actionResult: { ok: true } })).toBe(
    true,
  );
  expect(isTaskOverlayMutation({ ...args, actionResult: { ok: false } })).toBe(
    false,
  );
  form.set("intent", "save-settings");
  expect(isTaskOverlayMutation({ ...args, actionResult: { ok: true } })).toBe(
    false,
  );
});

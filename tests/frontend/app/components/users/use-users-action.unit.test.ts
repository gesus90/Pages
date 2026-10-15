import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useBlockingAgents,
  useIsSubmitting,
  useUsersError,
} from "@/app/components/users/use-users-action";

import type { UsersActionData } from "@/app/lib/user-actions/user-action-support.server";

const router = vi.hoisted(() => ({
  actionData: undefined as UsersActionData | undefined,
  state: "idle",
  formData: undefined as FormData | undefined,
}));
vi.mock("react-router", () => ({
  useActionData: () => router.actionData,
  useNavigation: () => router,
}));
beforeEach(() => {
  router.actionData = undefined;
  router.state = "idle";
  router.formData = undefined;
});

it("shows failures and blocking agents only for the requested intent", () => {
  const { result, rerender } = renderHook(() => ({
    error: useUsersError("delete-group"),
    agents: useBlockingAgents("delete-group"),
  }));
  expect(result.current).toEqual({ error: null, agents: [] });
  router.actionData = {
    ok: false,
    intent: "delete-department",
    error: "agentInUse",
    agents: ["Other agent"],
  };
  rerender();
  expect(result.current).toEqual({ error: null, agents: [] });
  router.actionData = {
    ok: false,
    intent: "delete-group",
    error: "agentInUse",
    agents: ["Assigned agent"],
  };
  rerender();
  expect(result.current).toEqual({
    error: "agentInUse",
    agents: ["Assigned agent"],
  });
  router.actionData = { ok: false, intent: "delete-group", error: "inUse" };
  rerender();
  expect(result.current.agents).toEqual([]);
  router.actionData = { ok: true, intent: "delete-group" };
  rerender();
  expect(result.current).toEqual({ error: null, agents: [] });
});

it("marks only the submitting form's intent as pending", () => {
  const { result, rerender } = renderHook(() =>
    useIsSubmitting("delete-group"),
  );
  expect(result.current).toBe(false);
  router.state = "submitting";
  rerender();
  expect(result.current).toBe(false);
  router.formData = new FormData();
  router.formData.set("intent", "delete-department");
  rerender();
  expect(result.current).toBe(false);
  router.formData.set("intent", "delete-group");
  rerender();
  expect(result.current).toBe(true);
  router.state = "loading";
  rerender();
  expect(result.current).toBe(false);
});

it("closes only for a fresh matching success and never replays it on reopen", () => {
  const close = vi.fn();
  router.actionData = { ok: true, intent: "delete-group" };
  const { rerender, unmount } = renderHook(() =>
    useCloseAfterAction("delete-group", close),
  );
  expect(close).not.toHaveBeenCalled();
  router.actionData = { ok: false, intent: "delete-group", error: "inUse" };
  rerender();
  router.actionData = { ok: true, intent: "delete-department" };
  rerender();
  expect(close).not.toHaveBeenCalled();
  router.actionData = { ok: true, intent: "delete-group" };
  rerender();
  rerender();
  expect(close).toHaveBeenCalledTimes(1);
  unmount();
  renderHook(() => useCloseAfterAction("delete-group", close));
  expect(close).toHaveBeenCalledTimes(1);
});

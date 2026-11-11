import { act, renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { useAgentProfileForm } from "@/app/components/settings/agents/use-agent-profile-form";
import { createI18n } from "@/app/lib/i18n";

import type { AgentActionResult } from "@/app/lib/settings-actions/settings-agents-response.server";
import type { ReactNode } from "react";

const fetcher = vi.hoisted(
  (): {
    state: "idle" | "submitting";
    data: AgentActionResult | undefined;
  } => ({
    state: "idle",
    data: undefined,
  }),
);
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
const i18n = createI18n("en");

function wrapper({ children }: { children: ReactNode }): React.ReactElement {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

function setup(
  onSaved = vi.fn(),
): ReturnType<
  typeof renderHook<ReturnType<typeof useAgentProfileForm>, unknown>
> {
  return renderHook(
    () =>
      useAgentProfileForm({
        profile: null,
        connections: [],
        catalogs: {},
        directory: { persons: [], groups: [], departments: [] },
        onSaved,
      }),
    { wrapper },
  );
}

beforeEach(() => {
  fetcher.state = "idle";
  fetcher.data = undefined;
});

it("starts incomplete and closes an unchanged draft immediately", () => {
  const onSaved = vi.fn();
  const { result } = setup(onSaved);
  expect(result.current.isInvalid).toBe(true);
  expect(result.current.input).toMatchObject({
    name: "",
    connectionId: "",
    model: "",
  });
  act(() => result.current.dismissal.requestClose());
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(result.current.dismissal.shouldConfirmClose).toBe(false);
});

it("guards a dirty draft and removes the unload warning when restored", () => {
  const onSaved = vi.fn();
  const { result } = setup(onSaved);
  act(() => result.current.draft.setName("Changed"));
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  const dismiss = { preventDefault: vi.fn() };
  act(() => result.current.dismissal.guardDismiss(dismiss));
  expect(dismiss.preventDefault).toHaveBeenCalledTimes(1);
  expect(result.current.dismissal.shouldConfirmClose).toBe(true);
  expect(onSaved).not.toHaveBeenCalled();
  act(() => {
    result.current.dismissal.setConfirmClose(false);
    result.current.draft.setName("");
  });
  const restored = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(restored);
  expect(restored.defaultPrevented).toBe(false);
});

it("prevents closing while saving and calls back after success", () => {
  fetcher.state = "submitting";
  const onSaved = vi.fn();
  const { result, rerender } = setup(onSaved);
  expect(result.current.isPending).toBe(true);
  act(() => result.current.dismissal.requestClose());
  expect(onSaved).not.toHaveBeenCalled();
  fetcher.state = "idle";
  fetcher.data = { ok: true, intent: "save-speech" };
  rerender();
  expect(onSaved).toHaveBeenCalledTimes(1);
});

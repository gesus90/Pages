import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { AutomationPanel } from "@/app/components/automations/automation-panel";
import { useAutomationsPage } from "@/app/components/automations/use-automations-page";
import { createI18n } from "@/app/lib/i18n";

import { automation, now, options } from "./automation-fixture";

import type * as ReactI18next from "react-i18next";

import type { AutomationActionHandlers } from "@/app/components/automations/use-automation-actions";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  dismiss: vi.fn(),
  toast: vi.fn(),
  handlers: { current: null as AutomationActionHandlers | null },
}));
vi.mock("react-router", () => ({
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: createI18n("en").t, i18n: { language: "en" } }),
}));
vi.mock("@/app/components/common/region-provider", () => ({
  useRegionFormat: () => ({ timeZone: "UTC" }),
}));
vi.mock("@/app/components/ui/toast", () => ({ showSuccessToast: mocks.toast }));
vi.mock("@/app/components/automations/use-now", () => ({ useNow: () => now }));
vi.mock("@/app/components/automations/use-automation-actions", () => ({
  useAutomationActions: (handlers: AutomationActionHandlers) => {
    mocks.handlers.current = handlers;
    return {
      submit: mocks.submit,
      dismissFailure: mocks.dismiss,
      busyIntent: null,
      failure: null,
    };
  },
}));

const pageData = {
  automations: [automation],
  history: [],
  options,
  names: { agent: "Ada" },
  readAt: now.toISOString(),
};
const t = createI18n("en").t;

beforeEach(() => {
  vi.clearAllMocks();
});

it("opens an expired one-time automation for editing before activation", () => {
  const { result } = renderHook(() => useAutomationsPage(pageData));
  const expired = {
    ...automation,
    isActive: false,
    trigger: { type: "once" as const, at: null, timeZone: "UTC" },
  };
  act(() => result.current.toggleActive(expired));
  expect(result.current.editor.mode).toBe("edit");
  expect(result.current.editor.timeAlert).toBe("activate");
  expect(result.current.editor.draft?.isActive).toBe(true);
  expect(mocks.submit).not.toHaveBeenCalled();
  act(() => result.current.closeDetail());
  expect(result.current.editor.mode).toBe("view");
  expect(result.current.isDetailOpen).toBe(false);
});

it("submits changes with revisions and handles run and deletion responses", () => {
  const { result } = renderHook(() => useAutomationsPage(pageData));
  act(() => result.current.toggleActive(automation));
  expect(mocks.submit).toHaveBeenCalledWith(
    "setActive",
    expect.objectContaining({
      automationId: automation.id,
      expectedRevision: 4,
      isActive: false,
    }),
  );
  act(() => result.current.runNow(automation));
  expect(mocks.submit).toHaveBeenCalledWith(
    "run",
    expect.objectContaining({
      automationId: automation.id,
      expectedRevision: 4,
    }),
  );
  act(() =>
    mocks.handlers.current?.onSuccess({
      ok: true,
      intent: "run",
      runStatus: "queued",
    }),
  );
  expect(mocks.toast).toHaveBeenCalledWith(t("automations.toast.queued"));
  act(() => result.current.askDelete(automation));
  expect(result.current.deleteTarget).toEqual(automation);
  act(() => result.current.confirmDelete());
  expect(mocks.submit).toHaveBeenCalledWith(
    "delete",
    expect.objectContaining({ automationId: automation.id, confirmed: true }),
  );
  act(() => mocks.handlers.current?.onSuccess({ ok: true, intent: "delete" }));
  expect(result.current.deleteTarget).toBeNull();
});

it("shows the selected automation and invokes its panel actions", () => {
  function Panel(): React.ReactElement {
    const page = useAutomationsPage(pageData);
    return <AutomationPanel page={page} />;
  }
  render(<Panel />);
  expect(screen.getByRole("heading", { name: "Saved" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: t("automations.panel.runNow") }),
  );
  expect(mocks.submit).toHaveBeenCalledWith(
    "run",
    expect.objectContaining({ automationId: automation.id }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("automations.panel.edit") }),
  );
  const name = screen.getByLabelText(t("automations.fields.name"));
  fireEvent.change(name, { target: { value: "Changed" } });
  expect(name).toHaveProperty("value", "Changed");
  fireEvent.click(
    screen.getByRole("button", { name: t("automations.panel.cancel") }),
  );
  expect(screen.getByRole("heading", { name: "Saved" })).toBeTruthy();
});

it("reopens a rejected activation and clears the deletion choice", () => {
  const { result } = renderHook(() => useAutomationsPage(pageData));
  const paused = { ...automation, isActive: false };
  act(() => result.current.toggleActive(paused));
  act(() =>
    mocks.handlers.current?.onFailure({
      intent: "setActive",
      code: "invalid",
      reason: "time_required",
      problems: [],
      currentRevision: null,
    }),
  );
  expect(result.current.editor.mode).toBe("edit");
  expect(result.current.editor.timeAlert).toBe("activate");
  act(() => result.current.askDelete(automation));
  act(() => result.current.cancelDelete());
  expect(result.current.deleteTarget).toBeNull();
  act(() => result.current.selectRow(automation));
  expect(result.current.editor.mode).toBe("view");
  expect(result.current.isDetailOpen).toBe(true);
});

import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { AcpLeaseCleanup } from "@/app/components/settings/agents/acp-resources/acp-lease-cleanup";
import { AcpObserverHealth } from "@/app/components/settings/agents/acp-resources/acp-observer-health";
import { createI18n } from "@/app/lib/i18n";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";
import type {
  AcpLeaseCleanupEntry,
  AcpLeaseCleanupReport,
} from "@/definition/AcpResource";

const fetcher = vi.hoisted(() => {
  const handle: {
    data: SettingsActionData | undefined;
    state: "idle" | "submitting";
    submit: ReturnType<
      typeof vi.fn<(formData: FormData, options: { method: string }) => void>
    >;
  } = {
    data: undefined,
    state: "idle",
    submit: vi.fn<(formData: FormData, options: { method: string }) => void>(),
  };
  return handle;
});

vi.mock("react-router", () => ({
  useFetcher: () => ({
    data: fetcher.data,
    state: fetcher.state,
    submit: fetcher.submit,
  }),
}));

function entry(
  instanceId: string,
  category: AcpLeaseCleanupEntry["category"],
  reason: AcpLeaseCleanupEntry["reason"],
): AcpLeaseCleanupEntry {
  return {
    instanceId,
    provider: "claude_code",
    runId: null,
    state: "cleanup_failed",
    since: "2026-11-12T13:00:00.000Z",
    category,
    reason,
  };
}

function report(
  mode: AcpLeaseCleanupReport["mode"],
  entries: readonly AcpLeaseCleanupEntry[],
): AcpLeaseCleanupReport {
  const counts = {
    releasable: 0,
    released: 0,
    kept_active: 0,
    kept_unproven: 0,
    check_failed: 0,
  };
  for (const item of entries) counts[item.category] += 1;
  return {
    mode,
    scope: "all",
    at: "2026-11-12T20:00:00.000Z",
    counts,
    entries,
  };
}

function renderCleanup(onCleaned = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AcpLeaseCleanup onCleaned={onCleaned} />
    </I18nextProvider>,
  );
  return onCleaned;
}

beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
  fetcher.submit.mockReset();
});

it("starts only a preview and offers no release before it", () => {
  renderCleanup();

  fireEvent.click(screen.getByRole("button", { name: "Prüfen (Vorschau)" }));

  expect(fetcher.submit).toHaveBeenCalledExactlyOnceWith(
    { intent: "check-acp-leases", mode: "preview" },
    { method: "post", action: "/settings/system" },
  );
  expect(screen.queryByRole("button", { name: /freigeben/u })).toBeNull();
});

it("shows the preview per category and confirms exactly the releasable reservations", () => {
  fetcher.data = {
    intent: "check-acp-leases",
    ok: true,
    report: report("preview", [
      entry("ended", "releasable", "unit_ended"),
      entry("live", "kept_active", "session_open"),
      entry("unproven", "kept_unproven", "start_unconfirmed"),
    ]),
  };
  renderCleanup();

  expect(
    screen.getByText(
      "Nachweislich beendet, freigebbar: 1 · Aktiv oder pausiert, erhalten: 1 · Nicht sicher nachweisbar, erhalten: 1",
    ),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "1 nachweislich beendete Reservierung(en) freigeben",
    }),
  );

  const [submitted] = fetcher.submit.mock.calls[0] ?? [];
  expect(submitted).toBeInstanceOf(FormData);
  if (!(submitted instanceof FormData)) throw new Error("no form submitted");
  const form = submitted;
  expect(form.get("intent")).toBe("check-acp-leases");
  expect(form.get("mode")).toBe("cleanup");
  expect(form.getAll("instanceId")).toEqual(["ended"]);
});

it("reloads the stored state after a confirmed cleanup and shows the result", () => {
  fetcher.data = {
    intent: "check-acp-leases",
    ok: true,
    report: report("cleanup", [
      entry("ended", "released", "unit_ended"),
      entry("broken", "check_failed", "check_failed"),
    ]),
  };
  const onCleaned = renderCleanup();

  expect(onCleaned).toHaveBeenCalledOnce();
  expect(
    screen.getByText("Freigegeben: 1 · Prüfung fehlgeschlagen, erhalten: 1"),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /freigeben/u })).toBeNull();
});

it("explains a refused or failed check", () => {
  fetcher.data = { intent: "check-acp-leases", ok: false, error: "general" };
  renderCleanup();

  expect(screen.getByRole("alert").textContent).toContain(
    "Es wurde keine Reservierung ohne Nachweis freigegeben",
  );
});

it("shows a failing group observer with its cause", () => {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AcpObserverHealth
        observer={{
          since: "2026-11-11T20:00:00.000Z",
          succeeded: 0,
          failed: 71,
          refused: 0,
          lastSuccessAt: null,
          lastFailure: {
            kind: "routing",
            state: "failed",
            code: "antigravity_acp_session_failed",
            at: "2026-11-12T18:00:00.000Z",
          },
        }}
      />
    </I18nextProvider>,
  );

  expect(screen.getByText(/Fehlgeschlagen: 71/u)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain(
    "Die Antigravity-Sitzung des Beobachters ist vor einer Antwort beendet worden.",
  );
});

import { act, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AcpResourcesCard } from "@/app/components/settings/agents/acp-resources-card";
import { createI18n } from "@/app/lib/i18n";

import type { AcpResourceDiagnostics } from "@/definition/AcpResource";

const fetcher = vi.hoisted(() => ({
  resources: undefined as AcpResourceDiagnostics | undefined,
  load: vi.fn(async () => {}),
}));
vi.mock("react-router", () => ({
  useFetcher: () => ({ data: fetcher.resources, load: fetcher.load }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  fetcher.resources = undefined;
  fetcher.load.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

function renderCard(): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={createI18n("de")}>
      <AcpResourcesCard />
    </I18nextProvider>,
  );
}

it("polls the authorized endpoint and stops polling on unmount", async () => {
  const view = renderCard();
  expect(screen.getByText("ACP-Ressourcen")).toBeTruthy();
  expect(fetcher.load).toHaveBeenCalledExactlyOnceWith("/agent-api/resources");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetcher.load).toHaveBeenCalledTimes(2);
  view.unmount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher.load).toHaveBeenCalledTimes(2);
});

it("shows occupied slots, FIFO wait reasons, memory and failed cleanup without private prompts", () => {
  fetcher.resources = {
    options: {
      maxConcurrentAcpSessions: 1,
      memoryAwareScheduling: true,
      minimumAvailableMemory: 2048,
      acpIdleTimeout: 300000,
      queueDiscipline: "fifo",
    },
    limitSource: "config",
    availableMemory: 1024,
    problem: "storage",
    active: [
      {
        instanceId: "a",
        userId: "owner",
        provider: "codex_cli",
        runId: "run-a",
        stepId: "step",
        state: "cleanup_failed",
        isPaused: true,
        since: "today",
      },
    ],
    waiting: [
      {
        instanceId: "b",
        userId: "other",
        provider: "claude_code",
        runId: "run-b",
        stepId: "step",
        reason: "memory",
        since: "today",
      },
    ],
    leftovers: [],
  };
  const view = renderCard();
  expect(
    screen.getByText("Belegt: 1 · Limit: 1 · Warteschlange: 1"),
  ).toBeTruthy();
  expect(screen.getByText(/Verfügbarer RAM: 1024 MiB/)).toBeTruthy();
  expect(
    screen.getByText(/Bereinigung fehlgeschlagen oder unbestätigt/),
  ).toBeTruthy();
  expect(screen.getByText(/Wartet auf ausreichend RAM/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("blockiert");
  expect(view.container.textContent).not.toContain("owner");
  view.unmount();
});

import { act, fireEvent, render, screen } from "@testing-library/react";
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
  for (const button of screen.getAllByRole("button", {
    name: "Technische Details",
  }))
    fireEvent.click(button);
  expect(
    screen.getByText(
      "Reservierte Plätze: 1 (davon Bereinigung unbestätigt: 1) · Limit: 1 · Wartende Anfragen: 1",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(/Gemessener verfügbarer Host-RAM: 1024 MiB/),
  ).toBeTruthy();
  expect(
    screen.getByText(
      /Bereinigung unbestätigt – Platz bleibt vorsorglich reserviert/,
    ),
  ).toBeTruthy();
  expect(screen.getByText(/Wartet auf ausreichend RAM/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("blockiert");
  expect(view.container.textContent).not.toContain("owner");
  view.unmount();
});

it("lists the chat sessions each agent holds with conversation and last activity (PAGE-335)", () => {
  fetcher.resources = {
    options: {
      maxConcurrentAcpSessions: 4,
      memoryAwareScheduling: false,
      minimumAvailableMemory: 0,
      queueDiscipline: "fifo",
    },
    limitSource: "default",
    availableMemory: 4096,
    problem: null,
    active: [
      {
        instanceId: "chat-a",
        userId: "agent-1",
        provider: "claude_code",
        runId: null,
        stepId: null,
        state: "idle",
        isPaused: false,
        since: "2026-11-12T14:00:00.000Z",
      },
    ],
    waiting: [],
    leftovers: [],
    chatSessions: [
      {
        instanceId: "chat-a",
        agentId: "agent-1",
        agentName: "Ed",
        conversation: "Gruppe „A-Team“",
        state: "idle",
        lastActivityAt: "2026-11-12T14:00:00.000Z",
      },
      {
        instanceId: "chat-b",
        agentId: "agent-1",
        agentName: "Ed",
        conversation: "Chat mit Igor",
        state: "busy",
        lastActivityAt: "2026-11-12T14:05:00.000Z",
      },
    ],
  };
  renderCard();
  expect(screen.getByText("Chat-Sitzungen der Agents")).toBeTruthy();
  expect(screen.getByText("Ed · 2 Sitzungen")).toBeTruthy();
  expect(
    screen.getByText("Chat mit Igor · antwortet gerade", { exact: false }),
  ).toBeTruthy();
  expect(
    screen.getByText("Gruppe „A-Team“ · ruht bis zur nächsten Runde", {
      exact: false,
    }),
  ).toBeTruthy();
  expect(
    screen.getByText("Chat-Sitzung von Ed · Gruppe „A-Team“"),
  ).toBeTruthy();
});

it("says when no agent holds a chat session", () => {
  fetcher.resources = {
    options: {
      maxConcurrentAcpSessions: 4,
      memoryAwareScheduling: false,
      minimumAvailableMemory: 0,
      queueDiscipline: "fifo",
    },
    limitSource: "default",
    availableMemory: 4096,
    problem: null,
    active: [],
    waiting: [],
    leftovers: [],
    chatSessions: [],
  };
  renderCard();
  expect(
    screen.getByText("Kein Agent hält gerade eine Chat-Sitzung offen."),
  ).toBeTruthy();
});

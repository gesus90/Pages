import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { ChatLauncher } from "@/app/components/chat/chat-launcher";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { createI18n } from "@/app/lib/i18n";

import {
  ChatServerFixture,
  FIRST_SESSION,
  installLayoutShims,
  renderChatPanel,
  typeChatMessage,
  waitForSession,
} from "./chat-fixture";

import type { ChatJob, ChatJobUpdate } from "@/definition/ChatJob";

let removeShims = (): void => undefined;
beforeAll(() => {
  removeShims = installLayoutShims();
});
afterAll(() => removeShims());

function mockRunningJob(
  getUpdate?: (job: ChatJob, after: number) => ChatJobUpdate,
): ChatServerFixture {
  const server = new ChatServerFixture();
  const job: ChatJob = {
    id: "12345678-1234-4234-8234-123456789abc",
    sessionId: FIRST_SESSION,
    state: "running",
    createdAt: new Date().toISOString(),
    endedAt: null,
    errorCode: null,
    usage: { context: { used: 4300, size: 10000 }, tokens: null, cost: null },
  };
  vi.stubGlobal(
    "fetch",
    async (
      url: RequestInfo | URL,
      init: RequestInit = {},
    ): Promise<Response> => {
      const input = readAgentObject(JSON.parse(String(init.body)));
      if (input.intent === "context")
        return Response.json({
          ok: true,
          context: {
            tokens: 4300,
            limit: 10000,
            isEstimated: false,
            source: "adapter",
          },
        });
      if (input.intent === "job")
        return Response.json({
          ok: true,
          update: getUpdate?.(job, Number(input.after ?? 0)) ?? {
            job,
            events: [],
            cursor: 0,
            hasMore: false,
          },
        });
      const response = await server.fetch(url, init);
      const payload = readAgentObject(await response.json());
      if (input.intent === "open") {
        const overview = readAgentObject(payload.overview);
        return Response.json({
          ...payload,
          overview: {
            ...overview,
            activity: { job, steers: [], selections: [] },
          },
        });
      }
      return Response.json(payload);
    },
  );
  return server;
}

it("removes only the attachment caption and orders one context control immediately before Stop", async () => {
  const server = mockRunningJob();
  server.hold();
  renderChatPanel();
  await waitForSession(FIRST_SESSION);
  await screen.findByRole("button", { name: "Gesprächskontext: 4300 Tokens" });
  const add = screen.getByRole("button", { name: "Anhang hinzufügen" });
  const actions = add.parentElement;
  if (!actions) throw new Error("Missing composer actions");
  expect(
    within(actions)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent),
  ).toEqual([
    "Anhang hinzufügen",
    "Gesprächskontext: 4300 Tokens",
    "Stoppen",
    "Abschicken",
  ]);
  expect(screen.queryByText(/Anhänge bis/)).toBeNull();
  expect(screen.getByLabelText("Datei auswählen").getAttribute("type")).toBe(
    "file",
  );
  const ring = screen.getByRole("button", {
    name: "Gesprächskontext: 4300 Tokens",
  });
  expect(ring.textContent).toBe("43 %");
  fireEvent.click(ring);
  expect(screen.getByRole("tooltip").textContent).toContain("43 %");
  await typeChatMessage("Steering");
  expect(
    screen.getByRole("button", { name: "Abschicken" }).hasAttribute("disabled"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
  expect(
    screen.getAllByRole("status", { name: "Pica bearbeitet deine Anfrage" }),
  ).toHaveLength(1);
  expect(
    screen.getAllByRole("button", { name: /Gesprächskontext/ }),
  ).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
  await act(async () => server.release({ kind: "steer" }));
});

it("keeps one context control beside Send while idle and preserves the input and upload controls", async () => {
  vi.stubGlobal("fetch", new ChatServerFixture().fetch);
  renderChatPanel();
  await waitForSession(FIRST_SESSION);
  expect(
    screen.getAllByRole("button", { name: /Gesprächskontext/ }),
  ).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Stoppen" })).toBeNull();
  expect(screen.queryByText(/Anhänge bis/)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Anhang hinzufügen" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("keeps hidden partial updates still, then scrolls the expanded failure and retained text into view", async () => {
  let eventCount = 0;
  let deliveredCount = -1;
  mockRunningJob((job, after) => {
    deliveredCount = eventCount;
    const events: ChatJobUpdate["events"] = [
      {
        sequence: 1,
        event: { kind: "text", turn: 1, isReset: true, delta: "Retained text" },
      },
      {
        sequence: 2,
        event: { kind: "end", state: "failed", errorCode: "providerFailed" },
      },
    ];
    return {
      job,
      events: events.filter(
        (entry) => entry.sequence > after && entry.sequence <= eventCount,
      ),
      cursor: eventCount,
      hasMore: false,
    };
  });
  renderChatPanel();
  await waitForSession(FIRST_SESSION);
  await waitFor(() => expect(deliveredCount).toBe(0));
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  eventCount = 1;
  await waitFor(() => expect(deliveredCount).toBe(1));
  expect(screen.queryByText("Retained text")).toBeNull();
  expect(scroll).not.toHaveBeenCalled();
  eventCount = 2;
  await screen.findByRole("alert");
  expect(screen.getByText("Retained text")).toBeTruthy();
  expect(scroll).toHaveBeenCalledWith({ block: "end" });
});

it("keeps the launcher filled, centered and operable with distinct open, active and keyboard focus states", async () => {
  vi.stubGlobal("fetch", new ChatServerFixture().fetch);
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <ChatLauncher />
    </I18nextProvider>,
  );
  const launcher = screen.getByRole("button", { name: "Pica öffnen" });
  for (const token of [
    "bg-surface",
    "hover:bg-surface-hover",
    "active:bg-muted",
    "shadow-floating",
    "focus-visible:outline-primary",
    "size-14",
    "rounded-full",
    "items-center",
    "justify-center",
  ])
    expect(launcher.classList.contains(token)).toBe(true);
  fireEvent.click(launcher);
  await waitForSession(FIRST_SESSION);
  expect(launcher.getAttribute("aria-expanded")).toBe("true");
  expect(launcher.classList.contains("ring-2")).toBe(true);
  fireEvent.click(launcher);
  expect(launcher.getAttribute("aria-expanded")).toBe("false");
  expect(document.getElementById("pica-chat")?.hidden).toBe(true);
  fireEvent.click(launcher);
  const panel = document.getElementById("pica-chat");
  if (!panel) throw new Error("Missing panel");
  fireEvent.keyDown(panel, { key: "Escape" });
  expect(document.activeElement).toBe(launcher);
  act(() => launcher.blur());
});

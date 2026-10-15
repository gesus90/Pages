import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { useChat } from "@/app/components/chat/use-chat";

import {
  installLayoutShims,
  renderChatPanel,
  typeChatMessage,
  waitForSession,
} from "./chat-fixture";
import { ACTIVE, OTHER, NEW, ManagementServer } from "./page48-server";

let server = new ManagementServer();
let removeShims: () => void = () => undefined;

beforeAll(() => {
  removeShims = installLayoutShims();
});
afterAll(() => {
  removeShims();
});
beforeEach(() => {
  server = new ManagementServer();
  vi.stubGlobal("fetch", server.fetch);
});

async function openDeletion(): Promise<void> {
  renderChatPanel();
  await waitForSession(ACTIVE);
  await typeChatMessage("/delete");
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
  await screen.findByRole("heading", { name: "Sessions löschen" });
}

function selectAll(): void {
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Alle eigenen Sessions auswählen/u }),
  );
}

it("opens /delete with a counted multi-selection, no confirmation textbox and a disabled empty action", async () => {
  await openDeletion();
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  expect(screen.queryByText(/Tippe.*LÖSCHEN/u)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "0 Sessions endgültig löschen" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: new RegExp(ACTIVE, "u") }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: new RegExp(OTHER, "u") }),
  );
  expect(
    screen.getByText("2 Sessions ausgewählt. Die Löschung ist endgültig."),
  ).toBeTruthy();
  expect(server.selections).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
  expect(
    screen.queryByRole("heading", { name: "Sessions löschen" }),
  ).toBeNull();
  expect(server.selections).toHaveLength(0);
});

it("deletes all selected own sessions by button, refreshes the list and recovers to an empty usable chat", async () => {
  await openDeletion();
  selectAll();
  fireEvent.click(
    screen.getByRole("button", { name: "2 Sessions endgültig löschen" }),
  );
  await waitForSession(NEW);
  expect(server.selections).toEqual([
    { intent: "delete", sessionIds: [ACTIVE, OTHER] },
  ]);
  expect(
    screen.queryByRole("heading", { name: "Sessions löschen" }),
  ).toBeNull();
  await screen.findByText("Ausgewählte Sessions endgültig gelöscht.");
  await typeChatMessage("/sessions");
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
  await screen.findByRole("heading", { name: "Deine Sessions" });
  expect(
    screen.getByRole("button", { name: new RegExp(NEW, "u") }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: new RegExp(ACTIVE, "u") }),
  ).toBeNull();
});

it("keeps unselected sessions and the active session when only another session is deleted", async () => {
  await openDeletion();
  fireEvent.click(
    screen.getByRole("checkbox", { name: new RegExp(OTHER, "u") }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "1 Sessions endgültig löschen" }),
  );
  await screen.findByText("Ausgewählte Sessions endgültig gelöscht.");
  expect(server.sessions.has(ACTIVE)).toBe(true);
  expect(server.sessions.has(OTHER)).toBe(false);
  expect(screen.getByDisplayValue(ACTIVE)).toBeTruthy();
});

it("retains failed IDs and the updated session list after partial deletion, then allows a targeted retry", async () => {
  server.failedId = OTHER;
  await openDeletion();
  selectAll();
  fireEvent.click(
    screen.getByRole("button", { name: "2 Sessions endgültig löschen" }),
  );
  await screen.findByText(
    new RegExp(`Nicht gelöscht bzw. Ergebnis unbestätigt: ${OTHER}`, "u"),
  );
  await waitForSession(OTHER);
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(screen.getByText("1 Sessions gelöscht.")).toBeTruthy();
  expect(
    screen.queryByRole("checkbox", { name: new RegExp(ACTIVE, "u") }),
  ).toBeNull();
  server.failedId = null;
  fireEvent.click(
    screen.getByRole("button", { name: "1 Sessions endgültig löschen" }),
  );
  await waitForSession(NEW);
  expect(server.selections).toEqual([
    { intent: "delete", sessionIds: [ACTIVE, OTHER] },
    { intent: "delete", sessionIds: [OTHER] },
  ]);
});

it("keeps the deletion outcome on refresh failure and offers recovery when the active session was deleted", async () => {
  await openDeletion();
  server.failRefresh = true;
  selectAll();
  fireEvent.click(
    screen.getByRole("button", { name: "2 Sessions endgültig löschen" }),
  );
  await screen.findByText(
    "Pages ist gerade nicht erreichbar. Bitte prüf die Verbindung und versuch es noch einmal.",
  );
  expect(screen.getByText("2 Sessions gelöscht.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Neue Session starten" }));
  await waitForSession(NEW);
});

it("shows compaction progress and result, refreshes context, and retains the transcript", async () => {
  server.isHeld = true;
  server.sessions.set(ACTIVE, [
    {
      id: "kept",
      role: "user",
      content: "Erhaltener Verlauf",
      createdAt: "today",
      attachments: [],
    },
  ]);
  renderChatPanel();
  await waitForSession(ACTIVE);
  await screen.findByRole("button", {
    name: "Gesprächskontext: Schätzung: 2400 Tokens",
  });
  await typeChatMessage("/compact");
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
  await waitFor(() => expect(server.compactCalls).toBe(1));
  expect(
    screen.getAllByText("Der Gesprächskontext wird komprimiert …").length,
  ).toBeGreaterThan(0);
  expect(screen.getByText("Erhaltener Verlauf")).toBeTruthy();
  act(() => {
    server.finishCompaction();
  });
  await screen.findByText(
    "Kontext komprimiert. Der vollständige Gesprächsverlauf bleibt erhalten.",
  );
  await screen.findByRole("button", {
    name: "Gesprächskontext: Schätzung: 400 Tokens",
  });
  expect(screen.getByText("Erhaltener Verlauf")).toBeTruthy();
});

it.each(["notNeeded", "providerFailed"])(
  "explains a compaction outcome without changing messages: %s",
  async (outcome) => {
    if (outcome === "notNeeded") server.compactStatus = "notNeeded";
    else server.compactError = outcome;
    renderChatPanel();
    await waitForSession(ACTIVE);
    await typeChatMessage("/compact");
    fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
    const expected =
      outcome === "notNeeded"
        ? /Keine Komprimierung erforderlich/u
        : /Der Anbieter hat nicht geantwortet/u;
    await screen.findByText(expected);
    expect(server.sessions.get(ACTIVE)).toEqual([]);
  },
);

it("rejects repeat /compact submissions in the same render without a second request", async () => {
  server.isHeld = true;
  const { result } = renderHook(() => useChat(true));
  await waitFor(() => expect(result.current.view.session?.id).toBe(ACTIVE));
  let first: Promise<unknown> = Promise.resolve();
  let second: Promise<unknown> = Promise.resolve();
  act(() => {
    first = result.current.submit("/compact");
    second = result.current.submit("/compact");
  });
  await act(() => second);
  expect(server.compactCalls).toBe(1);
  act(() => {
    server.finishCompaction();
  });
  await act(() => first);
});

it("deletes a full selection above the old list limit in explicit batches", async () => {
  for (let index = 0; index < 201; index += 1) {
    const suffix = String.fromCharCode(
      97 + Math.floor(index / 26),
      97 + (index % 26),
    );
    server.sessions.set(`session-own-chat-test-${suffix}`, []);
  }
  const { result } = renderHook(() => useChat(true));
  await waitFor(() => expect(result.current.view.session?.id).toBe(ACTIVE));
  await act(() => result.current.submit("/delete"));
  expect(result.current.commands.picker?.sessions).toHaveLength(203);
  const ids =
    result.current.commands.picker?.sessions.map(({ id }) => id) ?? [];
  await act(() => result.current.commands.remove(ids));
  expect(server.selections).toEqual([
    { intent: "delete", sessionIds: ids.slice(0, 200) },
    { intent: "delete", sessionIds: ids.slice(200) },
  ]);
  expect(result.current.view.session?.id).toBe(NEW);
});

it("updates the active context estimate after a normal message changes the conversation", async () => {
  renderChatPanel();
  await waitForSession(ACTIVE);
  await screen.findByRole("button", {
    name: "Gesprächskontext: Schätzung: 2400 Tokens",
  });
  await typeChatMessage("Neue Nachricht");
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
  await screen.findByText("Antwort");
  await screen.findByRole("button", {
    name: "Gesprächskontext: Schätzung: 2600 Tokens",
  });
});

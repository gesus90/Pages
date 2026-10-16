import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  ChatServerFixture,
  FIRST_SESSION,
  findChatInput,
  installLayoutShims,
  renderChatPanel,
  typeChatMessage,
  waitForSession,
} from "./chat-fixture";

const THINKING = "Pica antwortet …";

const MARKDOWN_ANSWER = [
  "## Ergebnis",
  "",
  "Das ist **wichtig**.",
  "",
  "```ts",
  "const answer = 42;",
  "```",
].join("\n");

let removeShims: () => void = () => undefined;
let server = new ChatServerFixture();

beforeAll(() => {
  removeShims = installLayoutShims();
});

afterAll(() => {
  removeShims();
});

beforeEach(() => {
  server = new ChatServerFixture();
  vi.stubGlobal("fetch", server.fetch);
});

function messageLog(): HTMLElement {
  return screen.getByRole("log", { name: "Unterhaltung mit Pica" });
}

function picaAnswers(): HTMLElement[] {
  return within(messageLog()).queryAllByRole("article", { name: "Pica" });
}

function ownMessages(): HTMLElement[] {
  return within(messageLog()).queryAllByRole("article", {
    name: "Deine Nachricht",
  });
}

async function openPanel(): Promise<ReturnType<typeof renderChatPanel>> {
  const panel = renderChatPanel();
  await waitForSession(FIRST_SESSION);
  return panel;
}

async function send(text: string): Promise<void> {
  await typeChatMessage(text);
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));
}

async function inputText(): Promise<string> {
  return (await findChatInput()).textContent;
}

it("shows the sent message and exactly one rendered answer that stays", async () => {
  const panel = await openPanel();
  server.hold();
  await send("Wie sieht Code aus?");

  expect(ownMessages().map((message) => message.textContent)).toEqual([
    "Wie sieht Code aus?",
  ]);
  act(() => {
    server.release({ kind: "answer", content: MARKDOWN_ANSWER });
  });
  const answer = await within(messageLog()).findByRole("article", {
    name: "Pica",
  });

  expect(within(answer).getByRole("heading").textContent).toContain("Ergebnis");
  expect(within(answer).getByText("wichtig").tagName).toBe("STRONG");
  expect(answer.querySelector("pre code")?.textContent).toContain(
    "const answer = 42;",
  );
  expect(screen.queryByText(THINKING)).toBeNull();
  expect(await inputText()).toBe("");

  panel.setOpen(false);
  panel.setOpen(true);

  expect(picaAnswers()).toHaveLength(1);
  expect(ownMessages()).toHaveLength(1);
});

it("shows the loading state with Abbrechen and sends only once", async () => {
  await openPanel();
  server.hold();
  await send("Erste Frage");

  expect(screen.getByText(THINKING).closest('[role="status"]')).not.toBeNull();
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Abschicken" })).toBeNull();

  await typeChatMessage("Zweite Frage");
  fireEvent.keyDown(await findChatInput(), { key: "Enter" });

  expect(server.sent.map(({ text }) => text)).toEqual(["Erste Frage"]);
  act(() => {
    server.release({ kind: "answer", content: "Fertig." });
  });

  expect(await within(messageLog()).findByText("Fertig.")).toBeTruthy();
  expect(screen.queryByText(THINKING)).toBeNull();
  expect(screen.getByRole("button", { name: "Abschicken" })).toBeTruthy();
});

it("ends the loading state on Abbrechen and returns the text to the input", async () => {
  await openPanel();
  server.hold();
  await send("Bitte abbrechen");

  fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

  expect(
    await screen.findByText("Die Antwort wurde abgebrochen."),
  ).toBeTruthy();
  expect(server.cancelled).toEqual(
    server.sent.map(({ requestId }) => requestId),
  );
  expect(screen.queryByText(THINKING)).toBeNull();
  expect(ownMessages()).toHaveLength(0);
  expect(await inputText()).toBe("Bitte abbrechen");
});

it("shows a provider failure and keeps the message the server stored", async () => {
  await openPanel();
  server.outcome = {
    kind: "failure",
    status: 502,
    code: "providerFailed",
    storesQuestion: true,
  };
  await send("Frage mit Anbieterfehler");

  const alert = await screen.findByRole("alert");

  expect(alert.textContent).toBe(
    "Der Anbieter hat nicht geantwortet. Bitte versuch es noch einmal.",
  );
  expect(ownMessages().map((message) => message.textContent)).toEqual([
    "Frage mit Anbieterfehler",
  ]);
  expect(picaAnswers()).toHaveLength(0);
  expect(screen.queryByText(THINKING)).toBeNull();
  expect(await inputText()).toBe("");
});

it("shows the server timeout as an understandable error", async () => {
  await openPanel();
  server.outcome = {
    kind: "failure",
    status: 504,
    code: "timeout",
    storesQuestion: true,
  };
  await send("Frage ohne Antwort");

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Die Antwort hat zu lange gedauert. Bitte versuch es noch einmal.",
  );
  expect(ownMessages()).toHaveLength(1);
  expect(screen.queryByText(THINKING)).toBeNull();
});

it("reads a gateway timeout without JSON as a timeout and keeps the unsent text", async () => {
  await openPanel();
  server.outcome = { kind: "gateway", status: 504 };
  await send("Frage hinter einem Proxy");

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Die Antwort hat zu lange gedauert. Bitte versuch es noch einmal.",
  );
  expect(ownMessages()).toHaveLength(0);
  expect(await inputText()).toBe("Frage hinter einem Proxy");
});

it("shows a network failure and keeps the unsent text", async () => {
  await openPanel();
  server.outcome = { kind: "network" };
  await send("Frage ohne Verbindung");

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Pages ist gerade nicht erreichbar. Bitte prüf die Verbindung und versuch es noch einmal.",
  );
  expect(ownMessages()).toHaveLength(0);
  expect(screen.queryByText(THINKING)).toBeNull();
  expect(await inputText()).toBe("Frage ohne Verbindung");
});

it("sends on plain intranet HTTP, where crypto.randomUUID is missing", async () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal("crypto", { getRandomValues });
  await openPanel();
  await send("Frage über HTTP");

  expect(await within(messageLog()).findByText("Antwort")).toBeTruthy();
  expect(server.sent[0]?.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
});

it("closes the session list on sending so the progress stays visible", async () => {
  await openPanel();
  await send("/sessions");
  expect(await screen.findByText("Deine Sessions")).toBeTruthy();
  server.hold();

  await send("Frage bei offener Liste");

  expect(screen.queryByText("Deine Sessions")).toBeNull();
  expect(screen.getByText(THINKING)).toBeTruthy();
  expect(ownMessages().map((message) => message.textContent)).toEqual([
    "Frage bei offener Liste",
  ]);
});

it("keeps a running answer through closing and reopening the panel", async () => {
  const panel = await openPanel();
  server.hold();
  await send("Frage vor dem Schließen");

  panel.setOpen(false);
  panel.setOpen(true);

  expect(screen.getByText(THINKING)).toBeTruthy();

  panel.setOpen(false);
  act(() => {
    server.release({ kind: "answer", content: "Antwort im Hintergrund" });
  });
  expect(await screen.findByText("Antwort im Hintergrund")).toBeTruthy();
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  panel.setOpen(true);

  expect(picaAnswers()).toHaveLength(1);
  expect(ownMessages()).toHaveLength(1);
  expect(screen.queryByText(THINKING)).toBeNull();
  expect(scroll).toHaveBeenCalledWith({ block: "end" });
});

it("sends once and keeps the input empty when Enter and Abschicken arrive before the panel updates", async () => {
  await openPanel();
  server.hold();
  await typeChatMessage("Nur einmal senden");
  const input = await findChatInput();
  const button = screen.getByRole("button", { name: "Abschicken" });

  act(() => {
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(button);
  });

  expect(server.sent.map(({ text }) => text)).toEqual(["Nur einmal senden"]);
  act(() => {
    server.release({ kind: "answer", content: "Einmal beantwortet." });
  });
  expect(
    await within(messageLog()).findByText("Einmal beantwortet."),
  ).toBeTruthy();
  expect(await inputText()).toBe("");
  expect(ownMessages()).toHaveLength(1);
});

it("sends a message only after its attachment finished uploading, with the attachment", async () => {
  await openPanel();
  server.holdUploads();
  server.outcome = { kind: "steer" };
  const fileInput = document.querySelector('input[type="file"]');
  if (!(fileInput instanceof HTMLInputElement))
    throw new Error("The chat has no file input.");
  fireEvent.change(fileInput, {
    target: { files: [new File(["Marker"], "steer.txt")] },
  });
  await typeChatMessage("Zusatz: Bitte beachte den Anhang.");

  expect(await screen.findByText("1 Anhang wird hochgeladen …")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Abschicken" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.keyDown(await findChatInput(), { key: "Enter" });
  expect(server.sent).toHaveLength(0);

  act(() => {
    server.releaseUpload();
  });
  expect(await screen.findByText("steer.txt")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));

  expect(
    await within(messageLog()).findByRole("link", { name: "steer.txt" }),
  ).toBeTruthy();
  expect(server.sent.map(({ attachmentIds }) => attachmentIds)).toEqual([
    ["attachment-1"],
  ]);
  expect(await inputText()).toBe("");
});

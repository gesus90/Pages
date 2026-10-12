// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const application = vi.hoisted(() => ({ services: undefined as unknown }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => application.services,
}));

import { ChatLauncher } from "@/app/components/chat/chat-launcher";
import { createI18n } from "@/app/lib/i18n";

import { installEditorGeometry, pressKey, typeText } from "../helpers/editor";
import {
  PICA_DUMMY_MARKER,
  PICA_SYNTHETIC_KEY,
  usePicaApplication,
} from "../helpers/pica-chat-path";

import type { Editor } from "@tiptap/core";

const createApplication = usePicaApplication();

beforeAll(installEditorGeometry);

afterEach(() => {
  application.services = undefined;
});

async function openPanel() {
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <MemoryRouter>
        <ChatLauncher />
      </MemoryRouter>
    </I18nextProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Pica öffnen" }));
  const panel = await screen.findByRole("region", { name: "Pica" });
  // A message can only be sent once the session is open.
  await waitFor(
    () =>
      expect(
        within(panel).getByRole("textbox", { name: "Session-ID" }),
      ).not.toHaveValue(""),
    { timeout: 10_000 },
  );
  const input = await within(panel).findByRole("textbox", {
    name: "Nachricht an Pica",
  });
  const editor = (input as HTMLElement & { editor?: Editor }).editor;
  if (!editor) throw new Error("The input field has no editor.");
  return { panel, editor };
}

/** Sends a message and waits until the panel no longer waits for Pica. */
async function submit(
  panel: HTMLElement,
  editor: Editor,
  text: string,
): Promise<void> {
  await act(async () => {
    typeText(editor, text);
  });
  await act(async () => {
    pressKey(editor, "Enter");
  });
  await waitFor(
    () => expect(within(panel).queryByRole("status")).not.toBeInTheDocument(),
    { timeout: 10_000 },
  );
}

describe("PAGE-18 AK-3: Pica shows the answer of the saved model in the chat", () => {
  it("shows the dummy provider's marker after the administrator saved the selection", async () => {
    const app = await createApplication();
    application.services = app.services;
    const connectionId = await app.connectOpenRouter();
    const saved = await app.savePica({
      connectionId,
      model: "vendor/pica-chat",
      reasoningEffort: "high",
    });
    expect(saved.status).toBe(200);
    app.signIn(app.writer);

    const { panel, editor } = await openPanel();
    await submit(panel, editor, "Synthetische Frage an Pica.");

    const log = within(panel).getByRole("log");
    await waitFor(() => expect(log).toHaveTextContent(PICA_DUMMY_MARKER), {
      timeout: 10_000,
    });
    expect(log).toHaveTextContent("Synthetische Frage an Pica.");
    const calls = app.provider.completions();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      model: "vendor/pica-chat",
      reasoning: { effort: "high" },
    });
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a translated failure and no answer when the provider fails", async () => {
    const app = await createApplication();
    application.services = app.services;
    const connectionId = await app.connectOpenRouter();
    await app.savePica({
      connectionId,
      model: "vendor/pica-chat",
      reasoningEffort: "high",
    });
    app.signIn(app.writer);
    app.provider.complete = () =>
      Response.json(
        { error: { message: `Invalid key ${PICA_SYNTHETIC_KEY}` } },
        { status: 401 },
      );

    const { panel, editor } = await openPanel();
    await submit(panel, editor, "Synthetische Frage an Pica.");

    const alert = await within(panel).findByRole(
      "alert",
      {},
      { timeout: 10_000 },
    );
    expect(alert).toHaveTextContent(
      "Der Anbieter hat nicht geantwortet. Bitte versuch es noch einmal.",
    );
    // The question was stored before the provider failed; the panel reloads it.
    const log = within(panel).getByRole("log");
    expect(log).toHaveTextContent("Synthetische Frage an Pica.");
    expect(editor.getText()).toBe("");
    expect(log).not.toHaveTextContent(PICA_DUMMY_MARKER);
    expect(panel).not.toHaveTextContent(PICA_SYNTHETIC_KEY);
  });

  it("shows that no chat agent is assigned instead of an empty answer", async () => {
    const app = await createApplication();
    application.services = app.services;
    app.signIn(app.writer);

    const { panel, editor } = await openPanel();
    await submit(panel, editor, "Synthetische Frage an Pica.");

    const alert = await within(panel).findByRole(
      "alert",
      {},
      { timeout: 10_000 },
    );
    expect(alert).toHaveTextContent(
      "Für den Chat ist noch kein Agent zugewiesen.",
    );
    // Nothing was stored, so the text returns to the input field.
    await waitFor(() =>
      expect(editor.getText()).toBe("Synthetische Frage an Pica."),
    );
    expect(app.provider.completions()).toHaveLength(0);
  });
});

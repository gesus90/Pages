// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ChatLauncher } from "@/app/components/chat/chat-launcher";
import { createI18n } from "@/app/lib/i18n";

import { installEditorGeometry, pressKey, typeText } from "../helpers/editor";

import type { Editor } from "@tiptap/core";

const SESSION = {
  id: "haus-baum-zelt-rabe-mond",
  createdAt: "2026-10-12T08:00:00Z",
  lastMessageAt: "2026-10-12T08:00:00Z",
  preview: "",
};
const OTHER = {
  ...SESSION,
  id: "boot-dach-eule-fass-gold",
  preview: "Alter Plan",
};

function message(id: string, role: "user" | "assistant", content: string) {
  return {
    id,
    role,
    content,
    createdAt: "2026-10-12T08:01:00Z",
    attachments: [],
  };
}

type Intent = Readonly<Record<string, unknown>>;

let requests: Intent[] = [];
let uploads: string[] = [];
let respond: (body: Intent) => unknown = () => ({});

function answer(body: Intent): unknown {
  switch (body.intent) {
    case "open":
      return {
        overview: {
          session: SESSION,
          messages: [],
          pending: [],
          attachmentLimitBytes: 16 * 1024 * 1024,
          confirmationWord: "LÖSCHEN",
        },
      };
    case "new":
      return { view: { session: OTHER, messages: [], pending: [] } };
    case "sessions":
      return { sessions: [SESSION, OTHER] };
    case "session":
      return {
        view:
          body.sessionId === OTHER.id
            ? {
                session: OTHER,
                messages: [message("m0", "user", "Alter Plan")],
                pending: [],
              }
            : { session: SESSION, messages: [], pending: [] },
      };
    default:
      return respond(body);
  }
}

beforeAll(installEditorGeometry);

beforeEach(() => {
  requests = [];
  uploads = [];
  respond = () => ({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith("/chat-api/attachments")) {
        uploads.push(url);
        return Response.json({
          ok: true,
          attachment: {
            id: "file-1",
            fileName: "notes.txt",
            contentType: "text/plain",
            size: 5,
          },
        });
      }
      const body = JSON.parse(String(init.body)) as Intent;
      requests.push(body);
      const result = answer(body);
      return result instanceof Response
        ? result
        : Response.json({ ok: true, ...(result as object) });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  const launcher = screen.getByRole("button", { name: "Pica öffnen" });
  await user.click(launcher);
  const panel = await screen.findByRole("region", { name: "Pica" });
  await waitFor(() =>
    expect(
      within(panel).getByRole("textbox", { name: "Session-ID" }),
    ).toHaveValue(SESSION.id),
  );
  const input = await within(panel).findByRole("textbox", {
    name: "Nachricht an Pica",
  });
  const editor = (input as HTMLElement & { editor?: Editor }).editor;
  if (!editor) throw new Error("The input field has no editor.");
  return { user, launcher, panel, editor };
}

async function submit(editor: Editor, text: string): Promise<void> {
  await act(async () => {
    typeText(editor, text);
  });
  await act(async () => {
    pressKey(editor, "Enter");
  });
}

it("shows administrator passwords separately from the conversation and clears them on close or dismissal", async () => {
  let replyNumber = 0;
  respond = () => {
    replyNumber += 1;
    return {
      reply: {
        session: SESSION,
        question: message(
          `secret-question-${replyNumber}`,
          "user",
          "Benutzer anlegen. LÖSCHEN",
        ),
        answer: message(
          `secret-answer-${replyNumber}`,
          "assistant",
          "Der Benutzer ist angelegt.",
        ),
        temporaryPasswords: [
          {
            userId: "new-person",
            username: "new-person",
            temporaryPassword: "temporary-password-123",
          },
        ],
      },
    };
  };
  const { user, panel, editor, launcher } = await openPanel();
  await submit(editor, "Benutzer anlegen. LÖSCHEN");
  const password = await within(panel).findByRole("textbox", {
    name: "Temporäres Passwort für new-person",
  });
  expect(password).toHaveValue("temporary-password-123");
  expect(password).toHaveAttribute("readonly");
  expect(within(panel).getByRole("log")).not.toHaveTextContent(
    "temporary-password-123",
  );
  await user.click(
    within(panel).getByRole("button", { name: "Pica schließen" }),
  );
  await user.click(launcher);
  await waitFor(() =>
    expect(
      within(panel).queryByRole("textbox", {
        name: "Temporäres Passwort für new-person",
      }),
    ).not.toBeInTheDocument(),
  );
  await submit(editor, "Benutzer anlegen. LÖSCHEN");
  await within(panel).findByRole("textbox", {
    name: "Temporäres Passwort für new-person",
  });
  await user.click(
    within(panel).getByRole("button", { name: "Passwort ausblenden" }),
  );
  expect(
    within(panel).queryByRole("textbox", {
      name: "Temporäres Passwort für new-person",
    }),
  ).not.toBeInTheDocument();
});

describe("A11.4 AK-07: the floating chat panel", () => {
  it("shows Pica at the bottom right and opens a floating panel with session ID, input, + and Abschicken", async () => {
    const { launcher, panel } = await openPanel();
    expect(launcher.className).toContain("fixed");
    expect(launcher.className).toContain("right-4");
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    expect(panel.className).toContain("fixed");
    const session = within(panel).getByRole("textbox", { name: "Session-ID" });
    expect(session).toHaveAttribute("readonly");
    expect(
      within(panel).getByRole("button", { name: "Anhang hinzufügen" }),
    ).toBeEnabled();
    expect(
      within(panel).getByRole("button", { name: "Abschicken" }),
    ).toBeDisabled();
    expect(within(panel).getByText("Anhänge bis 16 MB")).toBeInTheDocument();
    expect(requests).toEqual([{ intent: "open" }]);
  });

  it("sends with Enter and shows Markdown and code blocks in question and answer", async () => {
    respond = (body) => ({
      reply: {
        session: SESSION,
        question: message("q", "user", String((body.message as Intent).text)),
        answer: message(
          "a",
          "assistant",
          "Hier ist `code`:\n\n```ts\nconst a = 1;\n```",
        ),
      },
    });
    const { panel, editor } = await openPanel();
    await submit(editor, "Zeig mir **Code**");
    await waitFor(() =>
      expect(within(panel).getByText("const a = 1;")).toBeInTheDocument(),
    );
    expect(requests[1]).toMatchObject({
      intent: "send",
      message: {
        sessionId: SESSION.id,
        text: "Zeig mir **Code**",
        attachmentIds: [],
      },
    });
    expect(within(panel).getByText("Code").tagName).toBe("STRONG");
    expect(within(panel).getByText("code").tagName).toBe("CODE");
    expect(
      within(panel).getByText("const a = 1;").closest("pre"),
    ).not.toBeNull();
    expect(editor.getText()).toBe("");
  });

  it("starts, lists, switches and deletes own sessions with the chat commands", async () => {
    const { user, panel, editor } = await openPanel();
    await submit(editor, "/new");
    await waitFor(() =>
      expect(
        within(panel).getByRole("textbox", { name: "Session-ID" }),
      ).toHaveValue(OTHER.id),
    );
    expect(
      within(panel).getByText("Neue Session gestartet."),
    ).toBeInTheDocument();

    await submit(editor, "/sessions");
    await user.click(
      await within(panel).findByRole("button", {
        name: /boot-dach-eule-fass-gold/u,
      }),
    );
    await waitFor(() =>
      expect(
        within(panel).getByText("Session gewechselt."),
      ).toBeInTheDocument(),
    );
    expect(requests.at(-1)).toEqual({ intent: "session", sessionId: OTHER.id });

    await submit(editor, "/delete");
    await user.click(
      await within(panel).findByRole("button", {
        name: /haus-baum-zelt-rabe-mond/u,
      }),
    );
    const remove = within(panel).getByRole("button", {
      name: "Endgültig löschen",
    });
    expect(remove).toBeDisabled();
    const confirmation = within(panel).getByRole("textbox", {
      name: "Tippe LÖSCHEN, um das Löschen zu bestätigen.",
    });
    await user.type(confirmation, "löschen");
    expect(remove).toBeDisabled();
    await user.clear(confirmation);
    await user.type(confirmation, "LÖSCHEN");
    await user.click(remove);
    await waitFor(() =>
      expect(
        within(panel).getByText("Session endgültig gelöscht."),
      ).toBeInTheDocument(),
    );
    expect(requests).toContainEqual({
      intent: "delete",
      sessionId: SESSION.id,
      confirmation: "LÖSCHEN",
    });
  });

  it("keeps an unknown command in the input and explains the commands", async () => {
    const { panel, editor } = await openPanel();
    await submit(editor, "/hilfe");
    expect(
      await within(panel).findByText(
        "Unbekannter Chat-Befehl. Verfügbar sind /new, /sessions und /delete.",
      ),
    ).toBeInTheDocument();
    expect(editor.getText()).toBe("/hilfe");
    expect(
      within(panel).getByText(/Chat-Befehle: \/new neue Session/u),
    ).toBeInTheDocument();
    expect(requests).toEqual([{ intent: "open" }]);
  });

  it("closes with Escape and returns the focus to Pica", async () => {
    const { user, launcher, panel } = await openPanel();
    within(panel).getByRole("textbox", { name: "Session-ID" }).focus();
    await user.keyboard("{Escape}");
    expect(panel).not.toBeVisible();
    expect(launcher).toHaveFocus();
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    await user.click(launcher);
    expect(panel).toBeVisible();
  });

  it("refuses too large files at once and uploads and removes allowed ones", async () => {
    const { user, panel } = await openPanel();
    const picker = panel.querySelector<HTMLInputElement>('input[type="file"]');
    if (!picker) throw new Error("Missing file input.");
    await user.upload(
      picker,
      new File([new Uint8Array(16 * 1024 * 1024 + 1)], "gross.pdf"),
    );
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Die Datei ist größer als die erlaubte Grenze.",
    );
    expect(uploads).toEqual([]);

    await user.upload(
      picker,
      new File(["Notiz"], "notes.txt", { type: "text/plain" }),
    );
    await within(panel).findByText("notes.txt");
    expect(uploads[0]).toBe(
      `/chat-api/attachments?session=${SESSION.id}&name=notes.txt`,
    );
    expect(
      within(panel).getByRole("button", { name: "Abschicken" }),
    ).toBeEnabled();
    await user.click(
      within(panel).getByRole("button", { name: "Anhang notes.txt entfernen" }),
    );
    await waitFor(() =>
      expect(within(panel).queryByText("notes.txt")).toBeNull(),
    );
    expect(requests.at(-1)).toEqual({
      intent: "discard",
      attachmentId: "file-1",
    });
  });

  it("shows server failures and gives back a message that was not stored", async () => {
    respond = (body) =>
      body.intent === "send"
        ? Response.json({ ok: false, error: "roleMissing" }, { status: 400 })
        : {};
    const { panel, editor } = await openPanel();
    await submit(editor, "Hallo Pica");
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Für den Chat ist noch kein Agent zugewiesen.",
    );
    await waitFor(() => expect(editor.getText()).toBe("Hallo Pica"));
  });
});

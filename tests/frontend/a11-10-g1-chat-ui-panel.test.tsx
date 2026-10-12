// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
const REPORT = {
  id: "att-1",
  fileName: "bericht.pdf",
  contentType: "application/pdf",
  size: 2048,
};

interface Message {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly attachments: readonly (typeof REPORT)[];
}

function message(
  id: string,
  role: "user" | "assistant",
  content: string,
  attachments: readonly (typeof REPORT)[] = [],
): Message {
  return {
    id,
    role,
    content,
    createdAt: "2026-10-12T08:01:00Z",
    attachments,
  };
}

type Intent = Readonly<Record<string, unknown>>;
type Answer = Intent | Response;
type Handler = (
  body: Intent,
  signal: AbortSignal | null | undefined,
) => Answer | Promise<Answer>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function defer<T>(): Deferred<T> {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    settle = done;
  });
  return { promise, resolve: (value) => settle(value) };
}

function failure(error: string, status = 400): Response {
  return Response.json({ ok: false, error }, { status });
}

function reply(question: string, answer: string): Intent {
  return {
    reply: {
      session: SESSION,
      question: message("q", "user", question),
      answer: message("a", "assistant", answer),
    },
  };
}

let requests: Intent[] = [];
let uploads: string[] = [];
let handlers: Partial<Record<string, Handler>> = {};
let uploadAnswer: (name: string) => Response = () => failure("general", 500);
let openedMessages: readonly Message[] = [];

function overview(session: typeof SESSION): Intent {
  return {
    overview: {
      session,
      messages: openedMessages,
      pending: [],
      attachmentLimitBytes: 16 * 1024 * 1024,
      confirmationWord: "LÖSCHEN",
    },
  };
}

const DEFAULTS: Readonly<Record<string, Handler>> = {
  open: () => overview(SESSION),
  new: () => ({ view: { session: OTHER, messages: [], pending: [] } }),
  sessions: () => ({ sessions: [SESSION, OTHER] }),
  session: () => ({ view: { session: SESSION, messages: [], pending: [] } }),
};

beforeAll(installEditorGeometry);

beforeEach(() => {
  requests = [];
  uploads = [];
  handlers = {};
  openedMessages = [];
  let uploadNumber = 0;
  uploadAnswer = (name) => {
    uploadNumber += 1;
    return Response.json({
      ok: true,
      attachment: {
        id: `file-${uploadNumber}`,
        fileName: name,
        contentType: "text/plain",
        size: 5,
      },
    });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith("/chat-api/attachments")) {
        uploads.push(url);
        return uploadAnswer(
          new URL(url, "https://pages.invalid").searchParams.get("name") ?? "",
        );
      }
      const body = JSON.parse(String(init.body)) as Intent;
      requests.push(body);
      const handler =
        handlers[String(body.intent)] ?? DEFAULTS[String(body.intent)];
      const result = handler ? await handler(body, init.signal) : {};
      return result instanceof Response
        ? result
        : Response.json({ ok: true, ...result });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderLauncher(): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <MemoryRouter>
        <ChatLauncher />
      </MemoryRouter>
    </I18nextProvider>,
  );
  return user;
}

async function openPanel() {
  const user = renderLauncher();
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

function sentMessages(): Intent[] {
  return requests.filter((request) => request.intent === "send");
}

function fileInput(panel: HTMLElement): HTMLInputElement {
  const picker = panel.querySelector<HTMLInputElement>('input[type="file"]');
  if (!picker) throw new Error("Missing file input.");
  return picker;
}

function paste(editor: Editor, text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
      types: ["text/plain"],
    },
  });
  act(() => {
    editor.view.dom.dispatchEvent(event);
  });
}

describe("A11.10 g1: chat commands", () => {
  it("closes the session list with Escape or the back button and keeps the panel open", async () => {
    const { user, panel, editor } = await openPanel();
    const title = { name: "Deine Sessions" };

    await submit(editor, "/sessions");
    expect(await within(panel).findByRole("heading", title)).toBeVisible();
    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() =>
      expect(within(panel).queryByRole("heading", title)).toBeNull(),
    );
    expect(panel).toBeVisible();

    await submit(editor, "/sessions");
    await user.click(
      await within(panel).findByRole("button", { name: "Zurück zum Chat" }),
    );
    expect(within(panel).queryByRole("heading", title)).toBeNull();
    expect(within(panel).getByRole("log")).toBeVisible();
  });

  it("deletes the open session and continues in the most recent remaining one", async () => {
    let opened = 0;
    handlers.open = () => {
      opened += 1;
      return overview(opened === 1 ? SESSION : OTHER);
    };
    const { user, panel, editor } = await openPanel();

    await submit(editor, "/delete");
    const current = await within(panel).findByRole("button", {
      name: /haus-baum-zelt-rabe-mond · aktuell/u,
    });
    await user.click(current);
    await user.type(
      within(panel).getByRole("textbox", {
        name: "Tippe LÖSCHEN, um das Löschen zu bestätigen.",
      }),
      "LÖSCHEN",
    );
    await user.click(
      within(panel).getByRole("button", { name: "Endgültig löschen" }),
    );

    await waitFor(() =>
      expect(
        within(panel).getByRole("textbox", { name: "Session-ID" }),
      ).toHaveValue(OTHER.id),
    );
    expect(requests.map((request) => request.intent)).toEqual([
      "open",
      "sessions",
      "delete",
      "open",
    ]);
    expect(
      within(panel).getByText("Session endgültig gelöscht."),
    ).toBeInTheDocument();
  });

  it("shows the code of a command that the server refused", async () => {
    handlers.sessions = () => failure("accessDenied", 403);
    const { user, panel, editor } = await openPanel();

    await submit(editor, "/sessions");
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Dafür fehlen dir die Rechte.",
    );
    expect(editor.getText()).toBe("");

    handlers.sessions = DEFAULTS.sessions;
    handlers.session = () => failure("sessionMissing", 404);
    await submit(editor, "/sessions");
    await user.click(
      await within(panel).findByRole("button", { name: /boot-dach-eule/u }),
    );
    await user.click(
      await within(panel).findByRole("button", { name: "Zurück zum Chat" }),
    );
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Diese Session gibt es nicht mehr.",
    );
    expect(
      within(panel).getByRole("textbox", { name: "Session-ID" }),
    ).toHaveValue(SESSION.id);

    handlers.delete = () => failure("confirmationRequired", 403);
    await submit(editor, "/delete");
    await user.click(
      await within(panel).findByRole("button", { name: /boot-dach-eule/u }),
    );
    await user.type(
      within(panel).getByRole("textbox", {
        name: "Tippe LÖSCHEN, um das Löschen zu bestätigen.",
      }),
      "LÖSCHEN",
    );
    await user.click(
      within(panel).getByRole("button", { name: "Endgültig löschen" }),
    );
    await user.click(
      await within(panel).findByRole("button", { name: "Zurück zum Chat" }),
    );
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Das Bestätigungswort stimmt nicht.",
    );
  });
});

describe("A11.10 g1: chat input", () => {
  it("sends nothing for an empty input and opens the file dialog with the plus button", async () => {
    const { user, panel, editor } = await openPanel();

    await act(async () => {
      pressKey(editor, "Enter");
    });
    expect(requests).toEqual([{ intent: "open" }]);
    expect(
      within(panel).getByRole("button", { name: "Abschicken" }),
    ).toBeDisabled();

    const dialog = vi
      .spyOn(fileInput(panel), "click")
      .mockImplementation(() => undefined);
    await user.click(
      within(panel).getByRole("button", { name: "Anhang hinzufügen" }),
    );
    expect(dialog).toHaveBeenCalledTimes(1);
  });

  it("sends with the button and takes no file from a change without a file list", async () => {
    handlers.send = (body) =>
      reply(String((body.message as Intent).text), "Gern.");
    const { user, panel, editor } = await openPanel();
    const picker = fileInput(panel);

    Object.defineProperty(picker, "files", { configurable: true, value: null });
    fireEvent.change(picker);
    expect(uploads).toEqual([]);
    expect(within(panel).queryByRole("alert")).toBeNull();

    await act(async () => {
      typeText(editor, "Hallo Pica");
    });
    await user.click(within(panel).getByRole("button", { name: "Abschicken" }));
    await within(panel).findByText("Gern.");
    expect(sentMessages()).toHaveLength(1);
    expect(sentMessages()[0]).toMatchObject({
      message: { text: "Hallo Pica", attachmentIds: [] },
    });
    expect(editor.getText()).toBe("");
  });

  it("sends only on Enter outside code and on Mod+Enter inside code", async () => {
    handlers.send = (body) =>
      reply(String((body.message as Intent).text), "Erledigt.");
    const { panel, editor } = await openPanel();

    await act(async () => {
      typeText(editor, "Hallo");
    });
    await act(async () => {
      pressKey(editor, "a");
      pressKey(editor, "Enter", { shift: true });
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          isComposing: true,
          key: "Enter",
        }),
      );
    });
    expect(sentMessages()).toEqual([]);

    act(() => {
      editor.chain().setCodeBlock().run();
    });
    await act(async () => {
      pressKey(editor, "Enter");
    });
    expect(sentMessages()).toEqual([]);

    await act(async () => {
      pressKey(editor, "Enter", { mod: true });
    });
    await within(panel).findByText("Erledigt.");
    expect(sentMessages()).toHaveLength(1);
    expect(sentMessages()[0]).toMatchObject({
      message: { text: expect.stringContaining("Hallo") },
    });
  });

  it("reads pasted, dropped and copied text as Markdown", async () => {
    handlers.send = (body) =>
      reply(String((body.message as Intent).text), "Gesehen.");
    const { panel, editor } = await openPanel();

    paste(editor, "- [ ] Aufgabe\n\n![Bild](/aufgaben/attachments/x)");
    expect(panel.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(
      await within(panel).findByText("Bild wird nicht angezeigt: Bild"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Abschicken" }),
    ).toBeEnabled();

    act(() => {
      editor.view.pasteText("**fett**");
    });
    const copied = editor.view.serializeForClipboard(
      editor.state.doc.slice(0, editor.state.doc.content.size),
    );
    expect(copied.text).toContain("- [ ] Aufgabe");
    expect(copied.text).toContain("**fett**");

    await act(async () => {
      pressKey(editor, "Enter");
    });
    await within(panel).findByText("Gesehen.");
    expect(sentMessages()[0]).toMatchObject({
      message: {
        text: expect.stringContaining("![Bild](/aufgaben/attachments/x)"),
      },
    });
  });
});

describe("A11.10 g1: sending and cancelling", () => {
  it("sends the uploaded attachments with the message and clears them afterwards", async () => {
    handlers.send = (body) =>
      reply(String((body.message as Intent).text), "Ich lese sie.");
    const { user, panel, editor } = await openPanel();

    await user.upload(
      fileInput(panel),
      new File(["Notiz"], "notes.txt", { type: "text/plain" }),
    );
    await within(panel).findByText("notes.txt");
    await submit(editor, "Siehe Anhang");

    await within(panel).findByText("Ich lese sie.");
    expect(sentMessages()[0]).toMatchObject({
      message: { text: "Siehe Anhang", attachmentIds: ["file-1"] },
    });
    expect(
      within(panel).queryByRole("button", {
        name: "Anhang notes.txt entfernen",
      }),
    ).toBeNull();
  });

  it("cancels a running answer, aborts the request and returns the text", async () => {
    let aborted = false;
    handlers.send = (_, signal) =>
      new Promise<Answer>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const { user, panel, editor } = await openPanel();

    await submit(editor, "Lange Frage");
    await user.click(
      await within(panel).findByRole("button", { name: "Abbrechen" }),
    );

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Die Antwort wurde abgebrochen.",
    );
    expect(aborted).toBe(true);
    const sent = sentMessages()[0]?.message as Intent;
    expect(requests).toContainEqual({
      intent: "cancel",
      requestId: sent.requestId,
    });
    await waitFor(() => expect(editor.getText()).toBe("Lange Frage"));
  });

  it("shows the refusal of a cancellation while the answer is still running", async () => {
    const answer = defer<Answer>();
    handlers.send = () => answer.promise;
    handlers.cancel = () => failure("requestBusy", 409);
    const { user, panel, editor } = await openPanel();

    await submit(editor, "Lange Frage");
    await user.click(
      await within(panel).findByRole("button", { name: "Abbrechen" }),
    );
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Pica beantwortet gerade schon eine Nachricht von dir.",
    );

    await act(async () => {
      answer.resolve(reply("Lange Frage", "Fertig."));
      await answer.promise;
    });
    await within(panel).findByText("Fertig.");
  });

  it("keeps a message that the server stored although the answer failed", async () => {
    handlers.send = () => failure("providerFailed", 502);
    handlers.session = () => ({
      view: {
        session: SESSION,
        messages: [message("q", "user", "Hallo Pica")],
        pending: [],
      },
    });
    const { panel, editor } = await openPanel();

    await submit(editor, "Hallo Pica");

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Der Anbieter hat nicht geantwortet.",
    );
    expect(await within(panel).findByText("Hallo Pica")).toBeInTheDocument();
    expect(editor.getText()).toBe("");
  });

  it("returns the text when the failed message cannot be looked up either", async () => {
    handlers.send = () => failure("timeout", 504);
    handlers.session = () => failure("general", 500);
    const { panel, editor } = await openPanel();

    await submit(editor, "Hallo Pica");

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Die Antwort hat zu lange gedauert.",
    );
    await waitFor(() => expect(editor.getText()).toBe("Hallo Pica"));
  });
});

describe("A11.10 g1: loading the panel", () => {
  it("shows why the session could not be opened and tries again on the next opening", async () => {
    handlers.open = () => failure("accessDenied", 403);
    const user = renderLauncher();
    const launcher = screen.getByRole("button", { name: "Pica öffnen" });

    await user.click(launcher);
    const panel = await screen.findByRole("region", { name: "Pica" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Dafür fehlen dir die Rechte.",
    );
    expect(
      within(panel).getByRole("textbox", { name: "Session-ID" }),
    ).toHaveValue("");
    expect(
      within(panel).getByRole("button", { name: "Anhang hinzufügen" }),
    ).toBeDisabled();

    delete handlers.open;
    await user.click(
      within(panel).getByRole("button", { name: "Pica schließen" }),
    );
    await user.click(launcher);
    await waitFor(() =>
      expect(
        within(panel).getByRole("textbox", { name: "Session-ID" }),
      ).toHaveValue(SESSION.id),
    );
  });

  it("ignores an answer that arrives after the panel was closed and asks again later", async () => {
    const answers = [defer<Answer>(), defer<Answer>()];
    handlers.open = () => {
      const next = answers.shift();
      return next ? next.promise : overview(SESSION);
    };
    const [late, lateFailure] = [...answers];
    const user = renderLauncher();
    const launcher = screen.getByRole("button", { name: "Pica öffnen" });

    await user.click(launcher);
    const panel = await screen.findByRole("region", { name: "Pica" });
    await user.click(
      within(panel).getByRole("button", { name: "Pica schließen" }),
    );
    await act(async () => {
      late?.resolve(overview(OTHER));
      await late?.promise;
    });
    expect(
      screen.getByRole("textbox", { name: "Session-ID", hidden: true }),
    ).toHaveValue("");

    await user.click(launcher);
    await user.click(
      within(panel).getByRole("button", { name: "Pica schließen" }),
    );
    await act(async () => {
      lateFailure?.resolve(failure("accessDenied", 403));
      await lateFailure?.promise;
    });
    expect(panel.textContent).not.toContain("Dafür fehlen dir die Rechte.");

    await user.click(launcher);
    await waitFor(() =>
      expect(
        within(panel).getByRole("textbox", { name: "Session-ID" }),
      ).toHaveValue(SESSION.id),
    );
    expect(requests.map((request) => request.intent)).toEqual([
      "open",
      "open",
      "open",
    ]);
  });
});

describe("A11.10 g1: messages and attachments", () => {
  it("shows no images of a message and links the attachments of sent messages", async () => {
    openedMessages = [
      message(
        "m1",
        "assistant",
        "Das Bild ![Plan](/aufgaben/attachments/x) zeigt.",
      ),
      message("m2", "user", "", [REPORT]),
    ];
    const { panel } = await openPanel();

    const log = within(panel).getByRole("log");
    expect(await within(log).findByText(/Das Bild/u)).toBeInTheDocument();
    expect(log.querySelector('img[src*="attachments/x"]')).toBeNull();
    const link = within(log).getByRole("link", { name: "bericht.pdf" });
    expect(link).toHaveAttribute("href", "/chat/attachments/att-1");
    expect(link).toHaveAttribute("download");
    expect(
      within(log).queryByRole("button", { name: /entfernen/u }),
    ).toBeNull();
  });
});

describe("A11.10 g1: attachments of the next message", () => {
  it("shows the code of a refused upload and keeps no chip", async () => {
    uploadAnswer = () => failure("fileTypeNotAllowed");
    const { user, panel } = await openPanel();

    await user.upload(fileInput(panel), new File(["MZ"], "tool.exe"));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Dieser Dateityp ist nicht erlaubt",
    );
    expect(within(panel).queryByRole("status")).toBeNull();
    expect(
      within(panel).getByRole("button", { name: "Abschicken" }),
    ).toBeDisabled();
  });

  it("takes at most ten attachments per message", async () => {
    const { user, panel } = await openPanel();
    const files = Array.from(
      { length: 11 },
      (_, index) => new File(["x"], `datei-${index}.txt`),
    );

    await user.upload(fileInput(panel), files);

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Pro Nachricht sind höchstens 10 Anhänge möglich.",
    );
    expect(uploads).toHaveLength(10);
    expect(
      within(panel).getByRole("list", { name: "Anhänge" }).children,
    ).toHaveLength(10);
  }, 60_000);

  it("keeps an attachment that the server could not discard", async () => {
    handlers.discard = () => failure("attachmentMissing", 404);
    const { user, panel } = await openPanel();

    await user.upload(fileInput(panel), new File(["x"], "notes.txt"));
    await user.click(
      await within(panel).findByRole("button", {
        name: "Anhang notes.txt entfernen",
      }),
    );

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Der Anhang ist nicht mehr vorhanden.",
    );
    expect(within(panel).getByText("notes.txt")).toBeInTheDocument();
  });
});

describe("A11.10 g1: session ID in the header", () => {
  it("copies the session ID", async () => {
    const { user, panel } = await openPanel();

    await user.click(
      within(panel).getByRole("button", { name: "Session-ID kopieren" }),
    );

    expect(await navigator.clipboard.readText()).toBe(SESSION.id);
  });

  it("offers no copy action before a session is open", async () => {
    handlers.open = () => failure("general", 500);
    const user = renderLauncher();

    await user.click(screen.getByRole("button", { name: "Pica öffnen" }));
    const panel = await screen.findByRole("region", { name: "Pica" });
    await within(panel).findByRole("alert");

    expect(
      within(panel).getByRole("button", { name: "Session-ID kopieren" }),
    ).toBeDisabled();
  });
});

// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { TicketAttachmentsSection } from "@/app/components/tasks/description/ticket-attachments-section";
import { TicketDescription } from "@/app/components/tasks/description/ticket-description";
import { useTicketUploads } from "@/app/components/tasks/description/use-ticket-uploads";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import { installEditorGeometry } from "../helpers/editor";

import type { Editor } from "@tiptap/core";
import type { WorkItemAttachment } from "@/definition/Task";

const ATTACHMENT: WorkItemAttachment = {
  contentType: "image/png",
  createdAt: "2026-10-09 06:00:00",
  fileName: "plan.png",
  id: "a1",
  isEmbeddable: true,
  kind: "media",
  size: 2048,
  uploadedBy: "user-1",
  uploadedByName: "Ada",
  workItemId: "item-1",
};

/** Answers of the shared ticket action, one per request, in order. */
let answers: unknown[] = [];
let submissions: Record<string, FormDataEntryValue>[] = [];

class FakeRequest {
  public static next: { status: number; body: string } | "error" | "throw" = {
    body: JSON.stringify({ attachment: ATTACHMENT }),
    status: 200,
  };

  public url = "";
  public status = 0;
  public responseText = "";
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };

  public open(_method: string, url: string): void {
    this.url = url;
  }

  public send(): void {
    if (FakeRequest.next === "throw") {
      throw new TypeError("send failed");
    }

    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 1,
      total: 2,
    } as ProgressEvent);

    const answer = FakeRequest.next;

    queueMicrotask(() => {
      if (typeof answer === "string") {
        this.onerror?.();

        return;
      }

      this.status = answer.status;
      this.responseText = answer.body;
      this.onload?.();
    });
  }
}

interface Props {
  readonly description?: string;
  readonly canEdit?: boolean;
  readonly attachments?: readonly WorkItemAttachment[];
  readonly variant?: "page" | "panel";
}

function Harness({
  description = "Hello **world**",
  canEdit = true,
  attachments = [],
  variant = "page",
}: Props): React.ReactElement {
  const uploads = useTicketUploads("item-1", () => undefined);

  return (
    <>
      <Link to="/elsewhere">Weg</Link>
      <Link to="/?tab=2">Andere Ansicht</Link>
      <TicketDescription
        canEdit={canEdit}
        ticket={{ description, id: "item-1", key: "PAGE-1" }}
        uploads={uploads}
        variant={variant}
      />
      <TicketAttachmentsSection
        attachments={attachments}
        canEdit={canEdit}
        uploads={uploads}
      />
    </>
  );
}

function renderDescription(props: Props = {}): void {
  const router = createMemoryRouter(
    [
      { element: <Harness {...props} />, path: "/" },
      { element: <p>Anderswo</p>, path: "/elsewhere" },
      {
        async action({ request }) {
          submissions.push(Object.fromEntries(await request.formData()));

          return answers.shift() ?? { intent: "update-description", ok: true };
        },
        path: "/aufgaben",
      },
    ],
    { initialEntries: ["/"] },
  );

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

async function openEditor(): Promise<Editor> {
  await userEvent.click(
    screen.getByRole("button", { name: "Beschreibung bearbeiten" }),
  );

  const element = await screen.findByRole("textbox", {
    name: "Beschreibung von PAGE-1",
  });

  return (element as unknown as { editor: Editor }).editor;
}

function typeAtEnd(editor: Editor, text: string): void {
  act(() => {
    editor.chain().focus("end").insertContent(text).run();
  });
}

beforeAll(installEditorGeometry);

beforeEach(() => {
  answers = [];
  submissions = [];
  FakeRequest.next = {
    body: JSON.stringify({ attachment: ATTACHMENT }),
    status: 200,
  };
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TicketDescription", () => {
  it("shows the rendered description to readers with ticket images only", () => {
    renderDescription({
      canEdit: false,
      description:
        "## Plan\n\n![ok](/aufgaben/attachments/a1) ![wiki](/wiki/attachments/w1) ![no](https://example.invalid/x.png)",
    });

    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ok" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "wiki" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "no" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Beschreibung bearbeiten" }),
    ).not.toBeInTheDocument();
  });

  it("tells readers that there is no description and offers writers to add one", async () => {
    renderDescription({ canEdit: false, description: "" });
    expect(screen.getByText("Noch keine Beschreibung.")).toBeInTheDocument();

    renderDescription({ description: "", variant: "panel" });
    await userEvent.click(
      screen.getByRole("button", { name: "Beschreibung hinzufügen …" }),
    );

    expect(
      await screen.findByRole("textbox", { name: "Beschreibung von PAGE-1" }),
    ).toBeInTheDocument();
  });

  it("starts editing on a click into the text but follows links", async () => {
    renderDescription({ description: "See [docs](/elsewhere) here" });

    await userEvent.click(screen.getByText(/here/));
    expect(
      await screen.findByRole("textbox", { name: "Beschreibung von PAGE-1" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    await userEvent.click(screen.getByRole("link", { name: "docs" }));
    expect(await screen.findByText("Anderswo")).toBeInTheDocument();
  });

  it("keeps the caret where the person types", async () => {
    renderDescription({ description: "Text" });
    const editor = await openEditor();

    for (const character of "abc") {
      act(() => {
        const { from, to } = editor.view.state.selection;

        editor.view.dispatch(
          editor.view.state.tr.insertText(character, from, to),
        );
      });
      await waitFor(() =>
        expect(screen.getByText("Ungespeicherte Änderungen")).toBeVisible(),
      );
    }

    expect(editor.getText()).toBe("abcText");
  });

  it("cancels without saving and restores the saved text", async () => {
    renderDescription();
    const editor = await openEditor();

    expect(screen.getByRole("toolbar", { name: "Formatierung" })).toBeVisible();
    typeAtEnd(editor, " und mehr");
    expect(
      await screen.findByText("Ungespeicherte Änderungen"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.getByText("world")).toBeInTheDocument();
    expect(screen.queryByText(/und mehr/)).not.toBeInTheDocument();
    expect(submissions).toEqual([]);
  });

  it("saves with the text it started from and with Ctrl+Enter", async () => {
    renderDescription();
    let editor = await openEditor();

    typeAtEnd(editor, "!");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(screen.getByText("Gespeichert")).toBeVisible());
    expect(submissions[0]).toEqual({
      baseDescription: "Hello **world**",
      description: "Hello **world!**",
      id: "item-1",
      intent: "update-description",
    });

    editor = await openEditor();
    typeAtEnd(editor, "?");
    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "Enter",
        }),
      );
    });

    await waitFor(() => expect(submissions).toHaveLength(2));
    expect(submissions[1]).toMatchObject({ description: "Hello **world?**" });
    await screen.findByRole("button", { name: "Beschreibung bearbeiten" });

    editor = await openEditor();
    typeAtEnd(editor, ";");
    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "a" }),
      );
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          metaKey: true,
        }),
      );
    });
    await waitFor(() => expect(submissions).toHaveLength(3));
  });

  it("keeps the draft on a conflict and saves or drops it on request", async () => {
    answers = [
      { error: "descriptionConflict", intent: "update-description", ok: false },
      { error: "descriptionConflict", intent: "update-description", ok: false },
    ];
    renderDescription();
    const editor = await openEditor();

    typeAtEnd(editor, " mine");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "Die Beschreibung wurde inzwischen geändert",
    );
    await userEvent.click(
      within(alert).getByRole("button", { name: "Meine Fassung speichern" }),
    );
    await waitFor(() => expect(submissions).toHaveLength(2));
    expect(submissions[1]).toMatchObject({
      baseDescription: "Hello **world**",
      description: submissions[0]?.description,
    });
    expect(String(submissions[1]?.description)).toContain("mine");

    await userEvent.click(
      within(await screen.findByRole("alert")).getByRole("button", {
        name: "Neueste Fassung laden",
      }),
    );
    expect(editor.getText()).toBe("Hello world");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names why saving failed and keeps the editor open", async () => {
    answers = [
      { error: "forbidden", intent: "update-description", ok: false },
      { intent: "update-description", ok: false },
    ];
    renderDescription();
    const editor = await openEditor();

    typeAtEnd(editor, "!");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        "Nicht gespeichert: Du bist nicht berechtigt, diese Aktion auszuführen.",
      ),
    ).toHaveClass("text-destructive");

    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(
        "Nicht gespeichert: Bitte überprüfe deine Eingaben.",
      ),
    ).toBeVisible();
  });

  it("counts the characters near the limit", async () => {
    renderDescription({ description: "x".repeat(60_000) });
    await openEditor();

    expect(screen.getByText("60000 / 65536 Zeichen")).not.toHaveClass(
      "text-destructive",
    );
  }, 30_000);

  it("marks a description above the limit", async () => {
    renderDescription({ description: "x".repeat(65_537) });
    await openEditor();

    expect(screen.getByText("65537 / 65536 Zeichen")).toHaveClass(
      "text-destructive",
    );
  }, 30_000);

  it("asks before leaving with unsaved changes", async () => {
    renderDescription();
    const editor = await openEditor();

    typeAtEnd(editor, "!");

    const unload = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole("link", { name: "Weg" }));
    let dialog = await screen.findByRole("dialog", {
      name: "Ungespeicherte Beschreibung",
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Weiter bearbeiten" }),
    );
    expect(screen.queryByText("Anderswo")).not.toBeInTheDocument();

    answers = [
      { error: "descriptionConflict", intent: "update-description", ok: false },
    ];
    await userEvent.click(screen.getByRole("link", { name: "Weg" }));
    dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Speichern" }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText("Anderswo")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Weg" }));
    dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Speichern" }),
    );
    expect(await screen.findByText("Anderswo")).toBeInTheDocument();
  });

  it("also asks when only the address query changes, such as closing a panel", async () => {
    renderDescription();
    const editor = await openEditor();

    typeAtEnd(editor, "!");
    await userEvent.click(screen.getByRole("link", { name: "Andere Ansicht" }));

    expect(
      await screen.findByRole("dialog", {
        name: "Ungespeicherte Beschreibung",
      }),
    ).toBeVisible();
  });

  it("uploads files from the editor and inserts them", async () => {
    renderDescription({ description: "Bild:" });
    const editor = await openEditor();
    const input = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].find((element) => element.parentElement?.tagName !== "SECTION");

    await userEvent.upload(
      input as HTMLInputElement,
      new File(["x"], "plan.png"),
    );

    await waitFor(() =>
      expect(editor.getHTML()).toContain("/aufgaben/attachments/a1"),
    );
  });

  it("runs the commands of the toolbar above the text", async () => {
    renderDescription({ description: "Absatz" });
    const editor = await openEditor();
    const toolbar = screen.getByRole("toolbar", { name: "Formatierung" });
    const press = async (name: string): Promise<void> => {
      await userEvent.click(within(toolbar).getByRole("button", { name }));
    };
    const click = vi.spyOn(HTMLInputElement.prototype, "click");

    act(() => {
      editor.commands.selectAll();
    });
    await press("Überschrift 1 (Ctrl+Alt+1)");
    expect(editor.isActive("heading", { level: 1 })).toBe(true);
    await press("Überschrift 2 (Ctrl+Alt+2)");
    await press("Überschrift 3 (Ctrl+Alt+3)");
    await press("Text (Ctrl+Alt+0)");
    expect(editor.isActive("paragraph")).toBe(true);
    act(() => {
      editor.commands.selectAll();
    });
    for (const name of [
      "Fett (Ctrl+B)",
      "Kursiv (Ctrl+I)",
      "Durchgestrichen (Ctrl+Shift+S)",
      "Code (Ctrl+E)",
    ]) {
      await press(name);
    }
    expect(editor.isActive("code")).toBe(true);
    for (const name of [
      "Aufzählung (Ctrl+Shift+8)",
      "Nummerierte Liste (Ctrl+Shift+7)",
      "Aufgabenliste (Ctrl+Shift+9)",
      "Zitat (Ctrl+Shift+B)",
      "Codeblock (Ctrl+Alt+C)",
    ]) {
      await press(name);
    }
    await press("Tabelle");
    expect(editor.isActive("table")).toBe(true);
    await press("Rückgängig (Ctrl+Z)");
    await press("Wiederholen (Ctrl+Shift+Z)");
    await press("Bild oder Datei");
    expect(click).toHaveBeenCalled();
    await press("Emoji einfügen");
    expect(
      await screen.findByRole("textbox", { name: "Emoji suchen" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await press("Link (Ctrl+K)");
    expect(await screen.findByRole("dialog", { name: "Link" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await press("Editormenü (Shift+F10)");
    expect(await screen.findByRole("menu")).toBeVisible();
  });

  it("drops the draft when the person leaves without saving", async () => {
    renderDescription();
    const editor = await openEditor();

    typeAtEnd(editor, "!");
    await userEvent.click(screen.getByRole("link", { name: "Weg" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Verwerfen",
      }),
    );

    expect(await screen.findByText("Anderswo")).toBeInTheDocument();
    expect(submissions).toEqual([]);
  });

  it("closes the leave question with Escape and stays", async () => {
    renderDescription();
    const editor = await openEditor();

    typeAtEnd(editor, "!");
    await userEvent.click(screen.getByRole("link", { name: "Weg" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Anderswo")).not.toBeInTheDocument();
  });
});

describe("TicketAttachmentsSection", () => {
  it("lists attachments with download and removal for writers", async () => {
    renderDescription({
      attachments: [
        ATTACHMENT,
        { ...ATTACHMENT, id: "a2", uploadedByName: null },
      ],
    });

    expect(
      screen.getAllByRole("link", { name: "plan.png" })[0],
    ).toHaveAttribute("href", "/aufgaben/attachments/a1");
    expect(
      screen.getAllByRole("link", { name: "plan.png herunterladen" })[0],
    ).toHaveAttribute("href", "/aufgaben/attachments/a1?download=1");
    expect(screen.getByText("2.0 KB · Ada")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB · —")).toBeInTheDocument();

    await userEvent.click(
      screen.getAllByRole("button", {
        name: "plan.png entfernen",
      })[0] as HTMLElement,
    );
    await waitFor(() =>
      expect(submissions[0]).toEqual({
        attachmentId: "a1",
        intent: "remove-attachment",
      }),
    );
  });

  it("offers neither upload nor removal to readers", () => {
    renderDescription({ attachments: [ATTACHMENT], canEdit: false });

    expect(
      screen.queryByRole("button", { name: "Datei anhängen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "plan.png entfernen" }),
    ).not.toBeInTheDocument();
  });

  it("uploads chosen files and names a refusal", async () => {
    renderDescription();
    const input = document.querySelector<HTMLInputElement>(
      'section input[type="file"]',
    );
    const file = new File(["x"], "plan.png");

    await userEvent.upload(input as HTMLInputElement, file);
    await waitFor(() =>
      expect(screen.queryByText(/wird hochgeladen/)).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    FakeRequest.next = {
      body: JSON.stringify({ error: "attachmentTooLarge" }),
      status: 413,
    };
    await userEvent.upload(input as HTMLInputElement, file);
    expect(
      await screen.findByText(
        "Hochladen fehlgeschlagen: Die Datei ist größer als erlaubt.",
      ),
    ).toBeVisible();

    FakeRequest.next = "throw";
    await userEvent.upload(input as HTMLInputElement, file);
    expect(
      await screen.findByText(
        "Hochladen fehlgeschlagen: Der Server ist nicht erreichbar.",
      ),
    ).toBeVisible();
  });

  it("ignores a change without files", async () => {
    renderDescription();
    const input = document.querySelector<HTMLInputElement>(
      'section > input[type="file"]',
    );

    Object.defineProperty(input, "files", { configurable: true, value: null });
    act(() => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(submissions).toEqual([]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the running upload", async () => {
    renderDescription();
    const input = document.querySelector<HTMLInputElement>(
      'section input[type="file"]',
    );

    FakeRequest.next = "error";
    await userEvent.click(
      screen.getByRole("button", { name: "Datei anhängen" }),
    );
    await userEvent.upload(input as HTMLInputElement, new File(["x"], "a.txt"));

    expect(
      await screen.findByText(
        "Hochladen fehlgeschlagen: Der Server ist nicht erreichbar.",
      ),
    ).toBeVisible();
  });
});
